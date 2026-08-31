import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { posix } from 'node:path'
import { parse } from 'smol-toml'
import { resolveSafeProjectPath, statPath } from '../fs-safety.mjs'

const MAX_PROJECTS = 32
const packageName = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)
const canonical = value => value.toLowerCase().replace(/[-_.]+/g, '-')
const under = (directory, name) => directory === '.' ? name : directory + '/' + name
const parent = path => posix.dirname(path)
const pytest = values => Array.isArray(values) && values.some(value => typeof value === 'string' && /^pytest(?:\[[^\]]+\])?(?:\s|[<>=!~;]|$)/i.test(value))

export async function readPythonMetadata(root, path, maxBytes = 1024 * 1024) {
  const absolute = await resolveSafeProjectPath(root, path)
  const entry = await statPath(absolute)
  if (!entry) return null
  if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('Python metadata must be a regular file.')
  const handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const before = await handle.stat()
    if (!before.isFile() || before.size > maxBytes) throw new Error('Python metadata exceeds its bounded file budget.')
    const bytes = Buffer.alloc(before.size + 1)
    let length = 0
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length - length, length)
      if (!result.bytesRead) break
      length += result.bytesRead
    }
    const after = await handle.stat()
    if (length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error('Python metadata changed during read.')
    const content = bytes.subarray(0, length)
    try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(content), bytes: content } }
    catch { throw new Error('Python metadata is not valid UTF-8.') }
  } finally { await handle.close() }
}

export function parsePythonToml(text) {
  try { return parse(text, { maxDepth: 32 }) }
  catch { throw new Error('Python metadata is not valid bounded TOML.') }
}

function testSelection(document) {
  if (pytest(document.project?.dependencies) || pytest(document.tool?.uv?.['dev-dependencies'])) return { testGroups: [], testExtras: [] }
  for (const [key, field] of [['testGroups', document['dependency-groups']], ['testExtras', document.project?.['optional-dependencies']]]) {
    const names = Object.keys(field ?? {}).sort((a, b) => (a === 'dev' ? -1 : b === 'dev' ? 1 : a.localeCompare(b)))
    if (names.length > MAX_PROJECTS) throw new Error('Too many Python dependency groups.')
    const name = names.find(name => pytest(field[name]))
    if (name && packageName(name)) return { testGroups: [], testExtras: [], [key]: [name] }
  }
  // Legacy Poetry projects can use an already-provisioned venv. This is not an
  // instruction to install Poetry packages or translate its lock into uv.
  const poetry = document.tool?.poetry
  const poetryGroups = Object.values(poetry?.group ?? {})
  if (poetryGroups.length > MAX_PROJECTS) throw new Error('Too many Python dependency groups.')
  if ([poetry?.dependencies, poetry?.['dev-dependencies'], ...poetryGroups.map(group => group?.dependencies)]
    .some(table => table && typeof table === 'object' && !Array.isArray(table) &&
      Object.entries(table).some(([name, value]) => name.toLowerCase() === 'pytest' &&
        (typeof value === 'string' || (value && typeof value === 'object' && !Array.isArray(value)))))) return { testGroups: [], testExtras: [] }
  return null
}

function safePattern(value) {
  if (typeof value !== 'string' || !value || value.length > 256 || /[\\:\0\[\]{}()!]/.test(value) || value.startsWith('/') ||
      value.split('/').some(part => !part || part === '..' || (part === '.' && value !== '.'))) throw new Error('Unsupported or escaping uv workspace member pattern.')
  return value.split('/')
}

function segmentMatches(pattern, value) {
  let p = 0, v = 0, star = -1, retry = 0
  while (v < value.length) {
    if (pattern[p] === '?' || pattern[p] === value[v]) { p++; v++ }
    else if (pattern[p] === '*') { star = p++; retry = v }
    else if (star >= 0) { p = star + 1; v = ++retry }
    else return false
  }
  while (pattern[p] === '*') p++
  return p === pattern.length
}

function memberMatches(pattern, path) {
  const parts = path.split('/'), memo = new Map()
  if (parts.length > 64 || parts.some(part => part.length > 512)) throw new Error('Workspace path exceeds matching budget.')
  function visit(p, v) {
    const key = p + ':' + v
    if (memo.has(key)) return memo.get(key)
    const result = p === pattern.length ? v === parts.length : pattern[p] === '**'
      ? visit(p + 1, v) || (v < parts.length && visit(p, v + 1))
      : v < parts.length && segmentMatches(pattern[p], parts[v]) && visit(p + 1, v + 1)
    memo.set(key, result)
    return result
  }
  return visit(0, 0)
}

export async function inspectPythonTestProjects(root, manifest) {
  const paths = manifest.files.filter(path => path === 'pyproject.toml' || path.endsWith('/pyproject.toml'))
  if (paths.length > MAX_PROJECTS) return [{ system: 'python-pytest', framework: 'pytest', metadataIssue: 'Too many Python projects to choose safely.' }]
  const documents = new Map(), errors = new Set(), files = new Set(manifest.files)
  for (const path of paths) {
    try {
      const file = await readPythonMetadata(root, path)
      if (file) documents.set(path, parsePythonToml(file.text))
    } catch { errors.add(path) }
  }
  const results = []
  for (const [path, document] of documents) {
    let selection
    try { selection = testSelection(document) } catch { continue }
    if (!selection) continue
    const projectPath = parent(path)
    const candidate = { system: 'python-pytest', framework: 'pytest', projectPath, buildInputs: [path], venvPath: under(projectPath, '.venv'), uv: null }
    try {
      const ancestors = []
      for (let directory = projectPath; ; directory = parent(directory)) {
        const file = under(directory, 'pyproject.toml')
        if (errors.has(file)) throw new Error('An ancestor Python manifest is unreadable or malformed.')
        if (documents.get(file)?.tool?.uv?.workspace !== undefined) ancestors.push(directory)
        if (directory === '.') break
      }
      if (ancestors.length > 1) throw new Error('Nested uv workspace ownership is ambiguous.')
      const workspacePath = ancestors[0] ?? projectPath
      const ownerPath = under(workspacePath, 'pyproject.toml')
      const owner = documents.get(ownerPath)
      let memberPaths = [path]
      if (ancestors.length) {
        const workspace = owner.tool.uv.workspace
        if (!Array.isArray(workspace.members) || workspace.members.length > MAX_PROJECTS ||
            (workspace.exclude !== undefined && (!Array.isArray(workspace.exclude) || workspace.exclude.length > MAX_PROJECTS))) throw new Error('Invalid uv workspace membership.')
        const members = workspace.members.map(safePattern), excludes = (workspace.exclude ?? []).map(safePattern)
        memberPaths = paths.filter(file => {
          const directory = parent(file), relative = posix.relative(workspacePath, directory) || '.'
          if (relative.startsWith('../')) return false
          return (directory === workspacePath && packageName(owner.project?.name)) ||
            (members.some(pattern => memberMatches(pattern, relative)) && !excludes.some(pattern => memberMatches(pattern, relative)))
        })
        if (!memberPaths.includes(path)) throw new Error('Python project is not an included uv workspace member.')
      }
      const lockPath = under(workspacePath, 'uv.lock')
      if (files.has(lockPath)) {
        const members = memberPaths.map(file => {
          const value = documents.get(file)
          if (!packageName(value?.project?.name)) throw new Error('Workspace members need unambiguous package names.')
          return { name: canonical(value.project.name), path: posix.relative(workspacePath, parent(file)) || '.' }
        })
        if (new Set(members.map(member => member.name)).size !== members.length) throw new Error('Duplicate uv workspace package names.')
        const buildInputs = [...new Set([path, ownerPath, ...memberPaths, lockPath])]
        let pythonVersion = null
        for (const directory of [...new Set([projectPath, workspacePath])]) {
          const pinPath = under(directory, '.python-version')
          if (!files.has(pinPath)) continue
          const pin = (await readPythonMetadata(root, pinPath, 128))?.text.trim()
          if (!/^3\.\d{1,2}(?:\.\d{1,2})?$/.test(pin ?? '')) throw new Error('Python version pin must be a numeric Python 3 version.')
          buildInputs.push(pinPath)
          pythonVersion ??= pin
        }
        candidate.buildInputs = buildInputs
        candidate.venvPath = under(workspacePath, '.venv')
        candidate.uv = { workspacePath, packageName: canonical(document.project.name), lockPath, members, pythonVersion, ...selection }
      } else if (ancestors.length) throw new Error('The uv workspace lockfile is missing.')
      else candidate.buildInputs.push(...['poetry.lock', 'pdm.lock'].map(name => under(projectPath, name)).filter(path => files.has(path)))
    } catch (error) { candidate.metadataIssue = error.message }
    results.push(candidate)
  }
  return results
}
