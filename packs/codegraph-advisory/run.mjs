import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'

const output = resolve('.backend-harness/generated/packs/codegraph-advisory/graph.json')
const skipped = new Set(['.git', '.gradle', '.backend-harness', 'build', 'node_modules', 'out', 'target'])
const files = []
let visitedEntries = 0

async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    visitedEntries += 1
    if (visitedEntries > 500_000) {
      throw new Error('Codegraph safety limit exceeded (500000 entries or 100000 source files).')
    }
    if (entry.isSymbolicLink() || skipped.has(entry.name)) {
      continue
    }
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      await visit(path)
    } else if (entry.isFile() && /\.(?:java|kt)$/.test(entry.name)) {
      if (files.length >= 100_000) {
        throw new Error('Codegraph safety limit exceeded (500000 entries or 100000 source files).')
      }
      files.push(path)
    }
  }
}
await visit(process.cwd())
files.sort()

const nodes = []
const typeByName = new Map()
let indexedBytes = 0
let oversizedFiles = 0
for (const path of files) {
  const metadata = await stat(path)
  if (metadata.size > 2 * 1024 * 1024) {
    oversizedFiles += 1
    continue
  }
  indexedBytes += metadata.size
  if (indexedBytes > 256 * 1024 * 1024) {
    throw new Error('Codegraph source input exceeded the 256 MiB safety limit.')
  }
  const content = await readFile(path, 'utf8')
  const projectPath = relative(process.cwd(), path).split(sep).join('/')
  const packageName = content.match(/^\s*package\s+([A-Za-z_][\w.]*)\s*;?/m)?.[1] ?? ''
  const typeName = content.match(/\b(?:class|interface|enum|record|object)\s+([A-Za-z_$][\w$]*)/)?.[1] ?? path.split(sep).at(-1).replace(/\.(?:java|kt)$/, '')
  const qualifiedName = packageName ? packageName + '.' + typeName : typeName
  const node = {
    id: createHash('sha256').update(projectPath).digest('hex').slice(0, 20),
    path: projectPath,
    language: path.endsWith('.kt') ? 'kotlin' : 'java',
    qualifiedName,
    imports: [...content.matchAll(/^\s*import\s+(?:static\s+)?([A-Za-z_][\w.*$]*)\s*;?/gm)].map((match) => match[1])
  }
  nodes.push(node)
  const declarations = typeByName.get(qualifiedName) ?? []
  declarations.push(node)
  typeByName.set(qualifiedName, declarations)
}

const edges = []
let unresolvedImports = 0
let ambiguousImports = 0
for (const node of nodes) {
  for (const imported of node.imports) {
    if (imported.endsWith('.*')) {
      unresolvedImports += 1
      continue
    }
    const candidates = typeByName.get(imported) ?? typeByName.get(imported.split('.').slice(0, -1).join('.'))
    if (!candidates) {
      unresolvedImports += 1
      continue
    }
    if (candidates.length !== 1) {
      ambiguousImports += 1
      continue
    }
    const [exact] = candidates
    edges.push({ from: node.id, to: exact.id, kind: 'imports', provenance: 'static-import-resolved' })
  }
  delete node.imports
}

await mkdir(dirname(output), { recursive: true })
await writeFile(output, JSON.stringify({
  schemaVersion: 1,
  tool: { id: 'bth-import-graph', version: '1.0.0' },
  findings: [
    ...(unresolvedImports > 0 ? [{
      ruleId: 'graph.coverage.unresolved-imports',
      severity: 'info',
      message: unresolvedImports + ' imports were intentionally left unresolved.',
      location: null
    }] : []),
    ...(oversizedFiles > 0 ? [{
      ruleId: 'graph.coverage.oversized-files',
      severity: 'warning',
      message: oversizedFiles + ' source files larger than 2 MiB were not indexed.',
      location: null
    }] : []),
    ...(ambiguousImports > 0 ? [{
      ruleId: 'graph.coverage.ambiguous-imports',
      severity: 'warning',
      message: ambiguousImports + ' imports matched duplicate project type declarations and were not linked.',
      location: null
    }] : [])
  ],
  metrics: {
    nodes: nodes.length,
    edges: edges.length,
    unresolvedImports,
    ambiguousImports,
    duplicateTypes: [...typeByName.values()].filter((entries) => entries.length > 1).length,
    oversizedFiles,
    indexedBytes
  },
  graph: {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    generation: createHash('sha256').update(JSON.stringify(nodes) + JSON.stringify(edges)).digest('hex'),
    advisory: true,
    permittedUses: ['navigation', 'review-questions'],
    forbiddenUses: ['pass-verdict', 'test-skipping'],
    nodes,
    edges
  }
}, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
