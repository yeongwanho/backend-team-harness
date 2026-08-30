import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { posix } from 'node:path'
import { resolveSafeProjectPath, statPath } from '../fs-safety.mjs'

const MAX_FILES = 128
const MAX_FILE_BYTES = 256 * 1024
const MAX_TOTAL_BYTES = 4 * 1024 * 1024

function inside(base, value) {
  if (typeof value !== 'string' || !value || /[\\\0:$%]/.test(value) || value.startsWith('/')) return null
  const path = posix.normalize(posix.join(base, value))
  return path === '..' || path.startsWith('../') || path.startsWith('/') ? null : path
}

// Do not import a DataSource or execute its scripts. Mask strings/comments before
// finding declaration patterns; retain only literal positions for static paths.
function javascriptView(text) {
  const literals = []
  const code = text.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, (value, offset) => {
    if (/^["'`]/.test(value)) literals.push({ offset, end: offset + value.length, value: value.slice(1, -1) })
    return ' '.repeat(value.length)
  })
  return /["'`]/.test(code) ? { code: '', literals: [] } : { code, literals }
}

function pythonCode(text) {
  const code = text.replace(/'''[\s\S]*?'''|"""[\s\S]*?"""|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|#[^\r\n]*/g,
    (value) => value.replace(/[^\r\n]/g, ' '))
  return /["']/.test(code) ? '' : code
}

function typeormDirectories(text, sourcePath, projectPath) {
  const { code, literals } = javascriptView(text)
  const start = /\bnew\s+DataSource\s*\(\s*\{/.exec(code)
  if (!start) return []
  let depth = 1, end = start.index + start[0].length
  for (; end < code.length && depth; end += 1) {
    if (code[end] === '{') depth += 1
    if (code[end] === '}') depth -= 1
  }
  if (depth) return []
  const bodyStart = start.index + start[0].length
  const body = code.slice(bodyStart, end)
  if (body.includes('...') || [...body.matchAll(/\bmigrations\s*:/g)].length !== 1) return []
  const property = /\bmigrations\s*:\s*\[/.exec(body)
  if (!property) return []
  let propertyDepth = 0
  for (const character of body.slice(0, property.index)) {
    if (character === '{') propertyDepth += 1
    if (character === '}') propertyDepth -= 1
  }
  if (propertyDepth !== 0) return []
  const arrayStart = bodyStart + property.index + property[0].length
  const arrayEnd = code.indexOf(']', arrayStart)
  if (arrayEnd < 0 || arrayEnd > end || arrayEnd - arrayStart > 4096) return []
  const directories = []
  let offset = arrayStart
  for (const expression of code.slice(arrayStart, arrayEnd).split(',')) {
    const selected = literals.filter((literal) => literal.offset >= offset && literal.end <= offset + expression.length)
    offset += expression.length + 1
    if (!expression.trim() && selected.length === 0) continue
    if (selected.length !== 1 || !['', '__dirname +'].includes(expression.trim())) return []
    const value = selected[0].value
    if (/[\\$]/.test(value) || !/\.(?:ts|js)/.test(value) || !value.includes('*')) return []
    const base = expression.trim() ? posix.dirname(sourcePath) : projectPath
    const literalPrefix = value.split(/[*?{\[]/, 1)[0]
    const glob = value.slice(literalPrefix.length)
    if (!/^(?:\*\*\/)?\*(?:\.ts|\.js|\{\.ts,\.js\}|\{\.js,\.ts\})$/.test(glob)) return []
    const prefix = literalPrefix.replace(/\/$/, '')
    const path = inside(base, expression.trim() ? prefix.replace(/^\//, '') : prefix)
    if (!path) return []
    directories.push({ path, recursive: glob.startsWith('**/'), ts: glob.includes('.ts'), js: glob.includes('.js') })
  }
  return directories
}

function alembicLocation(text, configPath) {
  let active = false
  const locations = [], recursiveValues = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (/^[#;]/.test(line)) continue
    if (line.startsWith('[')) { active = line === '[alembic]'; continue }
    if (!active) continue
    if (/^version_locations\s*=\s*[^#;\s]/.test(line)) return null
    if (/^recursive_version_locations\s*=/.test(line)) {
      const match = /^recursive_version_locations\s*=\s*(true|false)\s*$/i.exec(line)
      if (!match) return null
      recursiveValues.push(match[1].toLowerCase() === 'true')
    }
    const match = /^script_location\s*=\s*([^#;]+?)\s*$/.exec(line)
    if (match) locations.push(match[1].replace(/^%\(here\)s\//, ''))
  }
  const directory = locations.length === 1 ? inside(posix.dirname(configPath), locations[0]) : null
  return directory && recursiveValues.length <= 1 ? { directory, recursive: recursiveValues[0] ?? false } : null
}

export async function inspectMigrationMechanisms(root, manifest) {
  const files = new Set(manifest.files)
  const sortedPaths = [...files].sort()
  const under = (directory) => {
    const prefix = directory + '/'
    let low = 0, high = sortedPaths.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (sortedPaths[middle] < prefix) low = middle + 1
      else high = middle
    }
    const result = []
    for (; low < sortedPaths.length && sortedPaths[low].startsWith(prefix); low += 1) result.push(sortedPaths[low])
    return result
  }
  const tools = [], diagnostics = [], sources = [], memo = new Map()
  let bytes = 0, complete = !manifest.truncated && !manifest.unreadableDirectories && !manifest.skippedSymlinks
  const note = (path, code) => { complete = false; if (diagnostics.length < 32) diagnostics.push({ path, code }) }
  const read = async (path) => {
    if (!path || !files.has(path)) return null
    if (memo.has(path)) return memo.get(path)
    if (memo.size >= MAX_FILES) { note(path, 'file-limit'); return null }
    memo.set(path, null)
    try {
      const absolute = await resolveSafeProjectPath(root, path)
      const metadata = await statPath(absolute)
      if (!metadata?.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_FILE_BYTES || bytes + metadata.size > MAX_TOTAL_BYTES) {
        note(path, 'unsafe-or-oversized'); return null
      }
      const handle = await open(absolute, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0))
      let content
      try {
        if (!(await handle.stat()).isFile()) { note(path, 'not-a-regular-file'); return null }
        const buffer = Buffer.alloc(Math.min(MAX_FILE_BYTES, MAX_TOTAL_BYTES - bytes) + 1)
        let offset = 0
        while (offset < buffer.length) {
          const result = await handle.read(buffer, offset, buffer.length - offset, offset)
          if (result.bytesRead === 0) break
          offset += result.bytesRead
        }
        content = buffer.subarray(0, offset)
      } finally { await handle.close() }
      bytes += content.length
      if (content.length > MAX_FILE_BYTES || bytes > MAX_TOTAL_BYTES) { note(path, 'byte-limit'); return null }
      sources.push({ path, sha256: createHash('sha256').update(content).digest('hex') })
      const text = content.toString('utf8')
      memo.set(path, text)
      return text
    } catch { note(path, 'unreadable-or-unsafe'); return null }
  }
  for (const packagePath of manifest.files.filter((path) => posix.basename(path) === 'package.json')) {
    const text = await read(packagePath)
    if (text === null) continue
    let pkg
    try { pkg = JSON.parse(text) } catch { note(packagePath, 'invalid-package-json'); continue }
    if (!pkg?.dependencies?.typeorm && !pkg?.devDependencies?.typeorm) continue
    const projectPath = posix.dirname(packagePath)
    const commands = Object.values(pkg.scripts ?? {}).filter((value) => typeof value === 'string' && /\bmigration:run\b/.test(value))
    const sourcePaths = [...new Set(commands.flatMap((command) => [...command.matchAll(/(?:--dataSource(?:=|\s+)|(?:^|\s)-d(?:=|\s+))["']?([A-Za-z0-9_./-]+\.(?:ts|js))\b/g)]
      .map((match) => inside(projectPath, match[1])).filter(Boolean)))]
    if (!sourcePaths.length) note(packagePath, 'migration-command-not-statically-resolved')
    for (const sourcePath of sourcePaths) {
      const source = await read(sourcePath)
      if (source === null) { note(sourcePath, 'missing-data-source'); continue }
      const directories = typeormDirectories(source, sourcePath, projectPath)
      if (!directories.length) note(sourcePath, 'migration-path-not-statically-resolved')
      const revisions = [...new Set(directories.flatMap((directory) => under(directory.path).filter((path) =>
        (directory.recursive || posix.dirname(path) === directory.path) &&
        ((directory.ts && path.endsWith('.ts')) || (directory.js && path.endsWith('.js'))))))]
      const confirmed = []
      for (const path of revisions.slice(0, MAX_FILES)) {
        const revision = await read(path)
        const code = revision === null ? '' : javascriptView(revision).code
        if (/\bimplements\s+MigrationInterface\b/.test(code) && /\bup\s*\(/.test(code) && /\bdown\s*\(/.test(code)) confirmed.push(path)
      }
      if (revisions.length > MAX_FILES) note(sourcePath, 'revision-limit')
      if (confirmed.length) tools.push({ kind: 'typeorm', projectPath, configurationPaths: [packagePath, sourcePath], revisionPaths: confirmed })
      else note(sourcePath, 'no-linked-revision')
    }
  }
  for (const configPath of manifest.files.filter((path) => posix.basename(path) === 'alembic.ini')) {
    const config = await read(configPath)
    if (config === null) continue
    const location = alembicLocation(config, configPath)
    if (!location) { note(configPath, 'unsupported-script-location'); continue }
    const { directory, recursive } = location
    const envPath = directory + '/env.py'
    const environment = await read(envPath)
    if (environment === null || !/^\s*(?:from\s+alembic\s+import\s+.*\bcontext\b|import\s+alembic(?:\.context)?\b)/m.test(pythonCode(environment))) {
      note(configPath, 'missing-alembic-environment'); continue
    }
    const revisions = under(directory + '/versions').filter((path) => path.endsWith('.py') &&
      (recursive || posix.dirname(path) === directory + '/versions'))
    const confirmed = []
    for (const path of revisions.slice(0, MAX_FILES)) {
      const revision = await read(path)
      const code = revision === null ? '' : pythonCode(revision)
      const assignment = /^\s*revision\s*(?::[^=\n]+)?=/m.exec(code)
      if (assignment && /^\s*['"][A-Za-z0-9_]+['"]/.test(revision.slice(assignment.index + assignment[0].length)) &&
        /^def upgrade\s*\(/m.test(code) && /^def downgrade\s*\(/m.test(code)) confirmed.push(path)
    }
    if (revisions.length > MAX_FILES) note(configPath, 'revision-limit')
    if (confirmed.length) tools.push({ kind: 'alembic', projectPath: posix.dirname(configPath), configurationPaths: [configPath, envPath], revisionPaths: confirmed })
    else note(configPath, 'no-linked-revision')
  }
  return {
    schemaVersion: 1, status: tools.length ? 'observed' : 'not-observed', complete,
    tools, sources, diagnostics, inspectedBytes: bytes,
    authority: { sourcePatternObservationOnly: true, configurationExecuted: false, databaseConnected: false, migrationVerified: false }
  }
}
