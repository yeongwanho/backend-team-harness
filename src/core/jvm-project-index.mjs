import { availableParallelism } from 'node:os'
import { createHash } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { manifestJvmPaths, scanProjectManifest } from './project-manifest.mjs'

const MAX_ENTRIES = 500_000
const MAX_FILES = 100_000
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_TOTAL_BYTES = 256 * 1024 * 1024

function portable(path) {
  return path.split(sep).join('/')
}

async function discover(root, providedManifest) {
  const manifest = providedManifest ?? await scanProjectManifest(root, {
    maxDepth: Infinity,
    maxEntries: MAX_ENTRIES,
    onLimit: 'throw',
    onReadError: 'throw'
  })
  if (manifest.root !== root) {
    throw new Error('Project manifest belongs to a different root.')
  }
  if (manifest.truncated || manifest.unreadableDirectories > 0) {
    throw new Error('JVM project index requires a complete readable project manifest.')
  }
  const projectPaths = manifestJvmPaths(manifest)
  if (projectPaths.length > MAX_FILES) {
    throw new Error('JVM project index exceeded the ' + MAX_FILES + '-file safety limit.')
  }
  return {
    files: projectPaths.map((path) => resolve(root, path)),
    visitedEntries: manifest.visitedEntries,
    skippedSymlinks: manifest.skippedJvmSymlinks
  }
}

async function mapLimit(values, limit, mapper) {
  const output = new Array(values.length)
  let nextIndex = 0
  async function worker() {
    while (true) {
      const index = nextIndex
      nextIndex += 1
      if (index >= values.length) {
        return
      }
      output[index] = await mapper(values[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(1, values.length)) }, worker))
  return output
}

function parseSource(root, path, content, contentSha256) {
  const projectPath = portable(relative(root, path))
  const packageName = content.match(/^\s*package\s+([A-Za-z_][\w.]*)\s*;?/m)?.[1] ?? ''
  const declarations = [...content.matchAll(/\b(?:(enum|data|sealed|annotation|value|fun)\s+)?(class|interface|enum|record|object)\s+([A-Za-z_$][\w$]*)/g)]
    .map((match) => {
      const kind = match[1] === 'enum' && match[2] === 'class' ? 'enum' : match[2]
      return { kind, name: match[3], qualifiedName: packageName ? packageName + '.' + match[3] : match[3] }
    })
  const imports = [...content.matchAll(/^\s*import\s+(?:static\s+)?([A-Za-z_][\w.*$]*)\s*;?/gm)].map((match) => match[1])
  const annotations = [...new Set([...content.matchAll(/@([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/g)].map((match) => match[1].split('.').at(-1)))].sort()
  const roles = new Set()
  if (annotations.some((name) => ['Controller', 'RestController'].includes(name))) roles.add('controller')
  if (annotations.includes('Service')) roles.add('service')
  if (annotations.includes('Repository')) roles.add('repository')
  if (annotations.includes('Entity')) roles.add('entity')
  if (annotations.includes('Configuration')) roles.add('configuration')
  if (/\/src\/test\/(?:java|kotlin)\//.test('/' + projectPath)) roles.add('test')
  const routes = [...content.matchAll(/@(Get|Post|Put|Delete|Patch|Request)Mapping\s*(?:\(\s*(?:value\s*=\s*|path\s*=\s*)?["']([^"']*)["'][^)]*\))?/g)]
    .map((match) => ({ method: match[1].toUpperCase(), path: match[2] ?? '' }))
  const tables = [...content.matchAll(/@Table\s*\(\s*(?:name\s*=\s*)?["']([^"']+)["']/g)].map((match) => match[1])
  return { path: projectPath, contentSha256, language: path.endsWith('.kt') ? 'kotlin' : 'java', packageName, declarations, imports, annotations, roles: [...roles], routes, tables }
}

export async function inspectJvmProject(root, options = {}) {
  const discovered = await discover(root, options.manifest)
  let declaredBytes = 0
  const metadata = []
  for (const path of discovered.files) {
    const fileStat = await lstat(path)
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
      continue
    }
    if (fileStat.size > MAX_FILE_BYTES) {
      metadata.push({ path, projectPath: portable(relative(root, path)), oversized: true, bytes: fileStat.size })
      continue
    }
    declaredBytes += fileStat.size
    if (declaredBytes > MAX_TOTAL_BYTES) {
      throw new Error('JVM project source exceeds the ' + MAX_TOTAL_BYTES + '-byte aggregate limit.')
    }
    metadata.push({ path, projectPath: portable(relative(root, path)), oversized: false, bytes: fileStat.size })
  }
  let readBytes = 0
  let parsedFiles = 0
  const parallelism = options.parallelism ?? Math.min(8, Math.max(1, availableParallelism?.() ?? 4))
  const cachedFiles = new Map((options.cachedIndex?.files ?? []).map((entry) => [entry.path, entry]))
  const changedPaths = new Set(options.changedPaths ?? [])
  const reusable = []
  const readable = []
  for (const entry of metadata.filter((candidate) => !candidate.oversized)) {
    const cached = cachedFiles.get(entry.projectPath)
    if (cached && !changedPaths.has(entry.projectPath)) {
      reusable.push(cached)
    } else {
      readable.push(entry)
    }
  }
  const readResults = await mapLimit(readable, parallelism, async (entry) => {
    const buffer = await readFile(entry.path)
    if (buffer.length > MAX_FILE_BYTES) {
      throw new Error('JVM source grew beyond the per-file limit while being read: ' + portable(relative(root, entry.path)))
    }
    readBytes += buffer.length
    if (readBytes > MAX_TOTAL_BYTES) {
      throw new Error('JVM project source exceeded the aggregate limit while being read.')
    }
    const contentSha256 = createHash('sha256').update(buffer).digest('hex')
    const cached = cachedFiles.get(entry.projectPath)
    if (cached?.contentSha256 === contentSha256) {
      return cached
    }
    parsedFiles += 1
    return parseSource(root, entry.path, buffer.toString('utf8'), contentSha256)
  })
  const parsedByPath = new Map([...reusable, ...readResults].map((entry) => [entry.path, entry]))
  const parsed = metadata.filter((entry) => !entry.oversized).map((entry) => parsedByPath.get(entry.projectPath))
  const roles = [...new Set(parsed.flatMap((entry) => entry.roles))].sort()
  const tables = [...new Set(parsed.flatMap((entry) => entry.tables))].sort()
  const packages = [...new Set(parsed.map((entry) => entry.packageName).filter(Boolean))].sort()
  return {
    schemaVersion: 1,
    authority: { evidenceTier: 'REPORTED', provenance: 'bounded-source-patterns', semanticCompilerIndex: false },
    metrics: {
      visitedEntries: discovered.visitedEntries,
      skippedSymlinks: discovered.skippedSymlinks,
      files: parsed.length,
      oversizedFiles: metadata.filter((entry) => entry.oversized).length,
      bytes: declaredBytes,
      readBytes,
      parsedFiles,
      reusedFiles: parsed.length - parsedFiles,
      declarations: parsed.reduce((sum, entry) => sum + entry.declarations.length, 0),
      imports: parsed.reduce((sum, entry) => sum + entry.imports.length, 0),
      routes: parsed.reduce((sum, entry) => sum + entry.routes.length, 0),
      entities: parsed.filter((entry) => entry.roles.includes('entity')).length,
      tests: parsed.filter((entry) => entry.roles.includes('test')).length
    },
    roles,
    tables,
    packages,
    files: parsed,
    limitations: [
      'Source-pattern evidence is not compiler-resolved code intelligence.',
      'Runtime dependency injection, reflection, generated code, and dynamic SQL are not resolved.'
    ]
  }
}
