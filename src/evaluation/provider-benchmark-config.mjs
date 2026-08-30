import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { isAbsolute, posix } from 'node:path'

const DATABASE_IMPACTS = new Set(['none', 'read', 'write', 'schema'])
const API_IMPACTS = new Set(['none', 'compatible', 'breaking'])

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(label + ' must be an object.')
  return value
}

function exactKeys(value, expected, label) {
  for (const key of Object.keys(value)) if (!expected.has(key)) throw new Error(label + ' contains unknown key ' + key + '.')
}

function safePath(value, label, directory = false) {
  if (typeof value !== 'string' || !value || value.length > 4096 || value.includes('\0')) throw new Error(label + ' is invalid.')
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '')
  const parts = normalized.split('/')
  if (isAbsolute(normalized) || /^[A-Za-z]:\//.test(normalized) || parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error(label + ' must stay inside the repository.')
  }
  return posix.normalize(normalized) + (directory ? '/' : '')
}

function command(value, label) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64) throw new Error(label + ' must contain 1-64 argv entries.')
  return value.map((entry, index) => {
    if (typeof entry !== 'string' || !entry || entry.length > 4096 || entry.includes('\0')) throw new Error(label + '[' + index + '] is invalid.')
    return entry
  })
}

function decisions(value, label) {
  plainObject(value, label)
  exactKeys(value, new Set(['modules', 'excludedModules', 'databaseImpact', 'apiImpact', 'schemaStrategy', 'acceptanceCriteria', 'constraints']), label)
  if (!Array.isArray(value.modules) || value.modules.length < 1 || value.modules.length > 32) throw new Error(label + '.modules must contain 1-32 entries.')
  const modules = value.modules.map((entry, index) => safePath(entry, label + '.modules[' + index + ']'))
  const excludedModules = (value.excludedModules ?? []).map((entry, index) => safePath(entry, label + '.excludedModules[' + index + ']'))
  if (!DATABASE_IMPACTS.has(value.databaseImpact)) throw new Error(label + '.databaseImpact is invalid.')
  if (!API_IMPACTS.has(value.apiImpact)) throw new Error(label + '.apiImpact is invalid.')
  if (value.schemaStrategy !== undefined && (value.databaseImpact !== 'schema' || !['migration', 'bootstrap-only'].includes(value.schemaStrategy))) {
    throw new Error(label + '.schemaStrategy must be migration or bootstrap-only for schema impact.')
  }
  for (const key of ['acceptanceCriteria', 'constraints']) {
    if (value[key] !== undefined && (typeof value[key] !== 'string' || value[key].length < 1 || value[key].length > 16_384)) {
      throw new Error(label + '.' + key + ' is invalid.')
    }
  }
  return {
    modules,
    excludedModules,
    databaseImpact: value.databaseImpact,
    ...(value.schemaStrategy ? { schemaStrategy: value.schemaStrategy } : {}),
    apiImpact: value.apiImpact,
    ...(value.acceptanceCriteria ? { acceptanceCriteria: value.acceptanceCriteria.trim() } : {}),
    ...(value.constraints ? { constraints: value.constraints.trim() } : {})
  }
}

export function parseTaskAcceptance(value, label = 'acceptance') {
  if (value === undefined || value === null) return null
  plainObject(value, label)
  if (!['target-tests', 'fixture-tests'].includes(value.kind)) throw new Error(label + '.kind must be target-tests or fixture-tests.')
  exactKeys(value, new Set(['kind', value.kind === 'target-tests' ? 'testPaths' : 'files', 'command', 'reports', 'cases']), label)
  const paths = (key) => {
    if (!Array.isArray(value[key]) || value[key].length < 1 || value[key].length > 32) throw new Error(label + '.' + key + ' must contain 1-32 paths.')
    const normalized = value[key].map((entry) => safePath(entry, label + '.' + key))
    if (new Set(normalized).size !== normalized.length || normalized.some((entry) => /[?*\[\]]/.test(entry))) throw new Error(label + '.' + key + ' must be unique exact paths.')
    return normalized
  }
  let files
  if (value.kind === 'fixture-tests') {
    if (!Array.isArray(value.files) || value.files.length < 1 || value.files.length > 32) throw new Error(label + '.files must contain 1-32 fixtures.')
    files = value.files.map((entry) => {
      plainObject(entry, label + '.files')
      exactKeys(entry, new Set(['path', 'fixture', 'sha256']), label + '.files')
      if (typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error(label + '.files requires a SHA-256 hash.')
      return { path: safePath(entry.path, label + '.files.path'), fixture: safePath(entry.fixture, label + '.files.fixture'), sha256: entry.sha256 }
    })
  }
  const testPaths = files ? files.map((entry) => entry.path) : paths('testPaths')
  if (new Set(testPaths).size !== testPaths.length || testPaths.some((path) => /[?*\[\]]/.test(path))) throw new Error(label + '.files must have unique exact test paths.')
  if (testPaths.some((path) => !/(^|\/)(?:test|tests|__tests__)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path))) throw new Error(label + '.testPaths may contain only test source paths.')
  const reports = paths('reports')
  if ([...testPaths, ...reports].some((path) => path.split('/').some((part) => ['.git', '.backend-harness', 'node_modules', '.venv'].includes(part)))) throw new Error(label + ' cannot overwrite repository metadata, harness state, or dependencies.')
  if (reports.some((path) => !path.endsWith('.xml') || testPaths.includes(path))) throw new Error(label + '.reports must be separate XML report paths.')
  if (!Array.isArray(value.cases) || value.cases.length < 1 || value.cases.length > 256) throw new Error(label + '.cases must contain 1-256 named tests.')
  const cases = value.cases.map((entry) => {
    plainObject(entry, label + '.cases')
    exactKeys(entry, new Set(['className', 'name']), label + '.cases')
    for (const key of ['className', 'name']) if (typeof entry[key] !== 'string' || !entry[key] || entry[key].length > 512 || /[\0\r\n]/.test(entry[key])) throw new Error(label + '.cases.' + key + ' is invalid.')
    return { className: entry.className, name: entry.name }
  })
  if (new Set(cases.map((entry) => JSON.stringify(entry))).size !== cases.length) throw new Error(label + '.cases must be unique.')
  return { kind: value.kind, ...(files ? { files } : { testPaths }), command: command(value.command, label + '.command'), reports, cases }
}

export function parseProviderBenchmarkConfig(text, corpus, source = '<inline>') {
  let parsed
  try { parsed = JSON.parse(text) } catch (error) { throw new Error(source + ': invalid JSON: ' + error.message) }
  plainObject(parsed, source)
  exactKeys(parsed, new Set(['schemaVersion', 'corpusId', 'repositories']), source)
  if (parsed.schemaVersion !== 1) throw new Error(source + '.schemaVersion must be 1.')
  if (parsed.corpusId !== corpus.id) throw new Error(source + '.corpusId does not match ' + corpus.id + '.')
  if (!Array.isArray(parsed.repositories) || parsed.repositories.length !== corpus.repositories.length) {
    throw new Error(source + '.repositories must cover every corpus repository exactly once.')
  }
  const byId = new Map(corpus.repositories.map((entry) => [entry.id, entry]))
  const seenRepositories = new Set()
  const repositories = parsed.repositories.map((repository, repositoryIndex) => {
    const label = source + '.repositories[' + repositoryIndex + ']'
    plainObject(repository, label)
    exactKeys(repository, new Set(['id', 'buildSystem', 'allowedPrefixes', 'setupCommand', 'tasks']), label)
    const corpusRepository = byId.get(repository.id)
    if (!corpusRepository || seenRepositories.has(repository.id)) throw new Error(label + '.id is unknown or duplicated.')
    seenRepositories.add(repository.id)
    if (repository.buildSystem !== null && !['gradle', 'maven'].includes(repository.buildSystem)) throw new Error(label + '.buildSystem is invalid.')
    if (!Array.isArray(repository.allowedPrefixes) || repository.allowedPrefixes.length < 1 || repository.allowedPrefixes.length > 64) {
      throw new Error(label + '.allowedPrefixes must contain 1-64 paths.')
    }
    if (!Array.isArray(repository.tasks) || repository.tasks.length !== corpusRepository.tasks.length) {
      throw new Error(label + '.tasks must cover every corpus task exactly once.')
    }
    const taskIds = new Set(corpusRepository.tasks.map((entry) => entry.id))
    const seenTasks = new Set()
    const tasks = repository.tasks.map((task, taskIndex) => {
      const taskLabel = label + '.tasks[' + taskIndex + ']'
      plainObject(task, taskLabel)
      exactKeys(task, new Set(['id', 'decisions', 'acceptance']), taskLabel)
      if (!taskIds.has(task.id) || seenTasks.has(task.id)) throw new Error(taskLabel + '.id is unknown or duplicated.')
      seenTasks.add(task.id)
      return { id: task.id, decisions: decisions(task.decisions, taskLabel + '.decisions'), acceptance: parseTaskAcceptance(task.acceptance, taskLabel + '.acceptance') }
    })
    return {
      id: repository.id,
      buildSystem: repository.buildSystem,
      allowedPrefixes: repository.allowedPrefixes.map((entry, index) => safePath(entry, label + '.allowedPrefixes[' + index + ']', entry.endsWith('/'))),
      setupCommand: command(repository.setupCommand, label + '.setupCommand'),
      tasks
    }
  })
  return { schemaVersion: 1, corpusId: corpus.id, sourceSha256: createHash('sha256').update(text).digest('hex'), repositories }
}

export async function loadProviderBenchmarkConfig(path, corpus) {
  return parseProviderBenchmarkConfig(await readFile(path, 'utf8'), corpus, path)
}
