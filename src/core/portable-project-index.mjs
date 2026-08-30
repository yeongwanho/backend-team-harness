import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { posix } from 'node:path'
import { resolveSafeProjectPath, statPath } from '../fs-safety.mjs'
import { javascriptSourceView, pythonCodeView } from './source-pattern-view.mjs'

const MAX_FILES = 10_000
const MAX_FILE_BYTES = 512 * 1024
const MAX_TOTAL_BYTES = 64 * 1024 * 1024
const SOURCE = /\.(?:ts|tsx|js|jsx|mjs|cjs|py)$/

function testPath(path) {
  return /(?:^|\/)(?:test|tests|__tests__)(?:\/|$)/.test(path) ||
    /(?:^|[.-])(?:spec|test)\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(posix.basename(path)) ||
    /(?:^|\/)test_[^/]+\.py$|_test\.py$/.test(path)
}

function rolesFor(path, content) {
  const roles = []
  if (/(?:^|\/)controllers?(?:\/|$)|\.controller\.[^.]+$|(?:^|\/)api\/routes(?:\/|$)/.test(path)) roles.push('controller')
  if (/(?:^|\/)services?(?:\/|$)|\.service\.[^.]+$/.test(path)) roles.push('service')
  if (/(?:^|\/)(?:repositories?|crud)(?:\/|\.|$)|\.repository\.[^.]+$/.test(path)) roles.push('repository')
  if (/(?:^|\/)(?:entities|models?|domain)(?:\/|$)|\.entity\.[^.]+$/.test(path) ||
      /(?:^|\r?\n)[\t ]*(?:@Entity\b|__tablename__\s*=)/.test(content)) roles.push('entity')
  if (/(?:^|\/)(?:dto|schemas?)(?:\/|$)|\.dto\.[^.]+$/.test(path)) roles.push('dto')
  if (/(?:^|\/)(?:config|configuration)(?:\/|$)|\.config\.[^.]+$/.test(path)) roles.push('configuration')
  if (/(?:^|\/)(?:errors?|exceptions?)(?:\/|$)/.test(path)) roles.push('error')
  if (testPath(path)) roles.push('test')
  return [...new Set(roles)]
}

function declarationsFor(path, content) {
  const pattern = path.endsWith('.py')
    ? /^\s*(class|def|async\s+def)\s+([A-Za-z_][\w]*)/gm
    : /\b(class|interface|type|enum|function)\s+([A-Za-z_$][\w$]*)/g
  return [...content.matchAll(pattern)].slice(0, 64).map((match) => ({
    kind: match[1].replace(/\s+/g, '-'),
    name: match[2]
  }))
}

function routesFor(path, content, code) {
  const routes = []
  for (const match of content.matchAll(/@(Get|Post|Put|Patch|Delete)\s*\(\s*['"]([^'"]*)['"]/g)) {
    if (code[match.index] !== '@') continue
    routes.push({ method: match[1].toUpperCase(), path: match[2] })
  }
  for (const match of content.matchAll(/@(?:[A-Za-z_][\w]*\.)?(get|post|put|patch|delete)\s*\(\s*['"]([^'"]*)['"]/g)) {
    if (code[match.index] !== '@') continue
    routes.push({ method: match[1].toUpperCase(), path: match[2] })
  }
  return routes.slice(0, 64)
}

function tablesFor(content, code) {
  const real = (matches, marker) => [...matches].filter(match => code.slice(match.index, match.index + marker.length) === marker)
  return [...new Set([
    ...real(content.matchAll(/@Entity\s*\(\s*['"]([^'"]+)['"]/g), '@Entity').map(match => match[1]),
    ...real(content.matchAll(/@Entity\s*\(\s*\{[\s\S]{0,512}?\bname\s*:\s*['"]([^'"]+)['"]/g), '@Entity').map(match => match[1]),
    ...real(content.matchAll(/__tablename__\s*=\s*['"]([^'"]+)['"]/g), '__tablename__').map(match => match[1])
  ])].slice(0, 64)
}

function emptyPersistenceSignals() {
  return {
    declaredQueries: 0, nativeQueries: 0, selectStarQueries: 0, leadingWildcardLikes: 0,
    lockingQueries: 0, pessimisticLocks: 0, indexDeclarations: 0, toOneAssociations: 0,
    defaultEagerToOneAssociations: 0, collectionAssociations: 0, joinFetches: 0, entityGraphs: 0,
    transactionalAnnotations: 0, readOnlyTransactions: 0, modifyingQueries: 0, bulkDmlQueries: 0,
    paginatedFetchJoins: 0
  }
}

function normalizedProjectPath(value) {
  const path = String(value ?? '.').replaceAll('\\', '/')
  if (path === '.') return path
  if (path.startsWith('/') || path.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Portable project path must be a normalized relative path.')
  }
  return path
}

export async function inspectPortableProject(root, manifest, options = {}) {
  const projectPath = normalizedProjectPath(options.projectPath)
  const inProject = (path) => projectPath === '.' || path === projectPath || path.startsWith(projectPath + '/')
  const sourcePaths = options.enabled === false
    ? []
    : manifest.files.filter((path) => inProject(path) && SOURCE.test(path))
  const candidates = sourcePaths.slice(0, MAX_FILES)
  const files = []
  let totalBytes = 0
  let oversizedFiles = 0
  for (const path of candidates) {
    const target = await resolveSafeProjectPath(root, path)
    const metadata = await statPath(target)
    if (!metadata?.isFile() || metadata.isSymbolicLink()) continue
    if (metadata.size > MAX_FILE_BYTES) { oversizedFiles += 1; continue }
    totalBytes += metadata.size
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error('Portable source convention input exceeded 64 MiB.')
    const content = await readFile(target, 'utf8')
    const code = path.endsWith('.py') ? pythonCodeView(content) : javascriptSourceView(content).code
    files.push({
      path,
      language: path.endsWith('.py') ? 'python' : 'ecmascript',
      contentSha256: createHash('sha256').update(content).digest('hex'),
      packageName: posix.dirname(path).split('/').filter(Boolean).join('.'),
      declarations: declarationsFor(path, code),
      annotations: /@Transactional\b/.test(code) ? ['Transactional'] : [],
      roles: rolesFor(path, code),
      routes: routesFor(path, content, code),
      tables: tablesFor(content, code),
      persistenceSignals: emptyPersistenceSignals()
    })
  }
  return {
    files,
    metrics: {
      files: files.length,
      declarations: files.reduce((sum, file) => sum + file.declarations.length, 0),
      routes: files.reduce((sum, file) => sum + file.routes.length, 0),
      tests: files.filter((file) => file.roles.includes('test')).length,
      oversizedFiles,
      truncated: sourcePaths.length > candidates.length
    },
    authority: {
      deterministic: true,
      provenance: 'bounded-portable-source-patterns',
      projectPath,
      enabled: options.enabled !== false,
      runtimeSemanticsInspected: false
    }
  }
}
