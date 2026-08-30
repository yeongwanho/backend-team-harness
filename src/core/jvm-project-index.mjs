import { availableParallelism } from 'node:os'
import { readdir, readFile, stat } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'

const SKIPPED_DIRECTORIES = new Set(['.git', '.gradle', '.backend-harness', 'build', 'node_modules', 'out', 'target'])
const MAX_ENTRIES = 500_000
const MAX_FILES = 100_000
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_TOTAL_BYTES = 256 * 1024 * 1024

function portable(path) {
  return path.split(sep).join('/')
}

async function discover(root) {
  const files = []
  let visitedEntries = 0
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      visitedEntries += 1
      if (visitedEntries > MAX_ENTRIES) {
        throw new Error('JVM project index exceeded the ' + MAX_ENTRIES + '-entry safety limit.')
      }
      if (entry.isSymbolicLink() || SKIPPED_DIRECTORIES.has(entry.name)) {
        continue
      }
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(path)
      } else if (entry.isFile() && /\.(?:java|kt)$/.test(entry.name)) {
        if (files.length >= MAX_FILES) {
          throw new Error('JVM project index exceeded the ' + MAX_FILES + '-file safety limit.')
        }
        files.push(path)
      }
    }
  }
  await visit(root)
  return { files: files.sort(), visitedEntries }
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

function parseSource(root, path, content) {
  const projectPath = portable(relative(root, path))
  const packageName = content.match(/^\s*package\s+([A-Za-z_][\w.]*)\s*;?/m)?.[1] ?? ''
  const declarations = [...content.matchAll(/\b(class|interface|enum|record|object)\s+([A-Za-z_$][\w$]*)/g)]
    .map((match) => ({ kind: match[1], name: match[2], qualifiedName: packageName ? packageName + '.' + match[2] : match[2] }))
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
  return { path: projectPath, language: path.endsWith('.kt') ? 'kotlin' : 'java', packageName, declarations, imports, annotations, roles: [...roles], routes, tables }
}

export async function inspectJvmProject(root, options = {}) {
  const discovered = await discover(root)
  let declaredBytes = 0
  const metadata = []
  for (const path of discovered.files) {
    const fileStat = await stat(path)
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
      continue
    }
    if (fileStat.size > MAX_FILE_BYTES) {
      metadata.push({ path, oversized: true, bytes: fileStat.size })
      continue
    }
    declaredBytes += fileStat.size
    if (declaredBytes > MAX_TOTAL_BYTES) {
      throw new Error('JVM project source exceeds the ' + MAX_TOTAL_BYTES + '-byte aggregate limit.')
    }
    metadata.push({ path, oversized: false, bytes: fileStat.size })
  }
  let readBytes = 0
  const parallelism = options.parallelism ?? Math.min(8, Math.max(1, availableParallelism?.() ?? 4))
  const parsed = await mapLimit(metadata.filter((entry) => !entry.oversized), parallelism, async (entry) => {
    const buffer = await readFile(entry.path)
    if (buffer.length > MAX_FILE_BYTES) {
      throw new Error('JVM source grew beyond the per-file limit while being read: ' + portable(relative(root, entry.path)))
    }
    readBytes += buffer.length
    if (readBytes > MAX_TOTAL_BYTES) {
      throw new Error('JVM project source exceeded the aggregate limit while being read.')
    }
    return parseSource(root, entry.path, buffer.toString('utf8'))
  })
  const roles = [...new Set(parsed.flatMap((entry) => entry.roles))].sort()
  const tables = [...new Set(parsed.flatMap((entry) => entry.tables))].sort()
  const packages = [...new Set(parsed.map((entry) => entry.packageName).filter(Boolean))].sort()
  return {
    schemaVersion: 1,
    authority: { evidenceTier: 'REPORTED', provenance: 'bounded-source-patterns', semanticCompilerIndex: false },
    metrics: {
      visitedEntries: discovered.visitedEntries,
      files: parsed.length,
      oversizedFiles: metadata.filter((entry) => entry.oversized).length,
      bytes: readBytes,
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
