import { availableParallelism } from 'node:os'
import { createHash } from 'node:crypto'
import { lstat, readdir, readFile, stat } from 'node:fs/promises'
import { posix, relative, resolve, sep } from 'node:path'

const SKIPPED = new Set(['.git', '.gradle', '.backend-harness', '.agents', '.claude', '.codex', '.idea', '.vscode', 'build', 'node_modules', 'out', 'target'])
const MAX_ENTRIES = 500_000
const MAX_FILES = 100_000
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_SOURCE_BYTES = 256 * 1024 * 1024
const MAX_EDGES = 500_000
const EDGE_WEIGHTS = Object.freeze({ imports: 1, inherits: 1.25, implements: 1.25, injects: 0.9, tests: 0.65 })
const SOURCE_FILE = /\.(?:java|kt|ts|tsx|js|jsx|mjs|cjs|py)$/
const ARTIFACT_FILE = /(?:\.(?:sql|properties|html|hbs|json|ya?ml|toml|md|ejs\.t)|(?:^|\/)\.env)$/
const INDEXED_FILE = new RegExp(SOURCE_FILE.source + '|' + ARTIFACT_FILE.source)
const JVM_FILE = /\.(?:java|kt)$/
const LANGUAGE_BY_EXTENSION = Object.freeze({
  java: 'java', kt: 'kotlin', ts: 'typescript', tsx: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', py: 'python'
})

function portable(path) {
  return path.split(sep).join('/')
}

function boundedSearchTerms(values) {
  return [...new Set(values.flatMap((value) => String(value).match(/[A-Za-z_$][A-Za-z0-9_$]{1,127}/g) ?? []))]
    .slice(0, 128)
}

async function discover(root) {
  const files = []
  let visitedEntries = 0
  let skippedSymlinks = 0
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      visitedEntries += 1
      if (visitedEntries > MAX_ENTRIES) throw new Error('Codegraph safety limit exceeded (' + MAX_ENTRIES + ' entries or ' + MAX_FILES + ' source files).')
      if (SKIPPED.has(entry.name)) continue
      const path = resolve(directory, entry.name)
      if (entry.isSymbolicLink()) {
        const sourceLink = INDEXED_FILE.test(entry.name)
        let directoryLink = false
        if (!sourceLink) {
          try { directoryLink = (await stat(path)).isDirectory() } catch {}
        }
        if (sourceLink || directoryLink) skippedSymlinks += 1
        continue
      }
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile() && INDEXED_FILE.test(portable(relative(root, path)))) {
        if (files.length >= MAX_FILES) throw new Error('Codegraph safety limit exceeded (' + MAX_ENTRIES + ' entries or ' + MAX_FILES + ' source files).')
        files.push(path)
      }
    }
  }
  await visit(root)
  return { files: files.sort(), visitedEntries, skippedSymlinks }
}

async function mapLimit(values, limit, mapper) {
  const output = new Array(values.length)
  let cursor = 0
  async function worker() {
    while (true) {
      const index = cursor++
      if (index >= values.length) return
      output[index] = await mapper(values[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(1, values.length)) }, worker))
  return output
}

function typeTokens(value) {
  return [...String(value).matchAll(/(?:^|[^\w$])([A-Z][A-Za-z0-9_$]*(?:\.[A-Z][A-Za-z0-9_$]*)*)/g)].map((match) => match[1])
}

function declarationRelations(kind, tail) {
  const relations = []
  const javaExtends = tail.match(/\bextends\s+([A-Za-z_$][\w.$]*)/)
  if (javaExtends) relations.push({ kind: 'inherits', type: javaExtends[1] })
  const javaImplements = tail.match(/\bimplements\s+([^\{]+)/)
  if (javaImplements) {
    for (const type of javaImplements[1].split(',').flatMap(typeTokens)) relations.push({ kind: 'implements', type })
  }
  const withoutPrimaryConstructor = tail.replace(/^\s*\([^)]*\)/, '')
  const kotlinParents = withoutPrimaryConstructor.match(/^\s*:\s*([^\{]+)/)
  if (kotlinParents) {
    const parents = kotlinParents[1].split(',').flatMap(typeTokens)
    parents.forEach((type) => relations.push({ kind: 'kotlin-supertype', type }))
  }
  return relations
}

function kotlinRelationKind(sourceKind, type, target) {
  const simpleName = type.replace(/[?\[\]]/g, '').split('<')[0].split('.').at(-1)
  const declaration = target.declarations.find((entry) => entry.name === simpleName)
  if (!declaration) throw new Error('Resolved Kotlin supertype lacks declaration metadata: ' + type)
  return declaration.kind === 'interface' && sourceKind !== 'interface' ? 'implements' : 'inherits'
}

function sourceDeclarations(content, packageName) {
  const pattern = /\b(?:(enum|data|sealed|annotation|value|fun)\s+)?(class|interface|enum|record|object)\s+([A-Za-z_$][\w$]*)\b/g
  const matches = [...content.matchAll(pattern)]
  return matches.map((match, index) => {
    const kind = match[1] === 'enum' && match[2] === 'class' ? 'enum' : match[2]
    const tailStart = match.index + match[0].length
    const nextStart = matches[index + 1]?.index ?? content.length
    const boundedEnd = Math.min(nextStart, tailStart + 16 * 1024)
    const candidate = content.slice(tailStart, boundedEnd)
    const terminator = candidate.search(/[\{;]/)
    const tail = terminator === -1 ? candidate : candidate.slice(0, terminator)
    return {
      kind,
      name: match[3],
      qualifiedName: packageName ? packageName + '.' + match[3] : match[3],
      relations: declarationRelations(kind, tail)
    }
  })
}

function sourceLanguage(path) {
  return LANGUAGE_BY_EXTENSION[path.split('.').at(-1).toLowerCase()] ?? 'artifact'
}

function moduleQualifiedName(projectPath, declaredName = '') {
  const withoutExtension = projectPath.replace(/\.[^.\/]+$/, '')
  const moduleName = (withoutExtension || projectPath).split('/').join('.')
  return declaredName ? moduleName + '#' + declaredName : moduleName
}

function commonNode(root, path, declarations, roles, moduleImports = [], searchTerms = []) {
  const projectPath = portable(relative(root, path))
  const basename = path.split(sep).at(-1)
  const fallbackName = basename.replace(/\.[^.]+$/, '') || basename.replace(/^\.+/, '') || 'artifact'
  const declaredTypes = declarations.length
    ? declarations.map((entry) => entry.qualifiedName)
    : [moduleQualifiedName(projectPath, fallbackName)]
  return {
    id: createHash('sha256').update(projectPath).digest('hex').slice(0, 20),
    path: projectPath,
    language: sourceLanguage(path),
    packageName: '',
    qualifiedName: declaredTypes[0],
    declaredTypes,
    declarations,
    imports: [],
    moduleImports,
    searchTerms: boundedSearchTerms(searchTerms),
    injectionTypes: [],
    roles,
    routes: [],
    tables: []
  }
}

function testRole(projectPath) {
  return /(?:^|\/)(?:test|tests|__tests__|src\/test)(?:\/|$)|(?:\.spec|\.test)\.[^.]+$|(?:^|\/)test_[^/]+\.py$|_test\.py$/.test(projectPath)
}

function parseJvmSource(root, path, content) {
  const projectPath = portable(relative(root, path))
  const packageName = content.match(/^\s*package\s+([A-Za-z_][\w.]*)\s*;?/m)?.[1] ?? ''
  const declarations = sourceDeclarations(content, packageName)
  const fallbackName = path.split(sep).at(-1).replace(/\.(?:java|kt)$/, '')
  if (declarations.length === 0) declarations.push({ kind: 'file', name: fallbackName, qualifiedName: packageName ? packageName + '.' + fallbackName : fallbackName, relations: [] })
  const imports = [...content.matchAll(/^\s*import\s+(?:static\s+)?([A-Za-z_][\w.*$]*)\s*;?/gm)].map((match) => match[1])
  const annotations = [...new Set([...content.matchAll(/@([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/g)].map((match) => match[1].split('.').at(-1)))].sort()
  const roles = []
  if (annotations.some((name) => ['Controller', 'RestController'].includes(name))) roles.push('controller')
  if (annotations.includes('Service')) roles.push('service')
  if (annotations.includes('Repository')) roles.push('repository')
  if (annotations.includes('Entity')) roles.push('entity')
  if (annotations.includes('Configuration')) roles.push('configuration')
  if (/\/src\/test\/(?:java|kotlin)\//.test('/' + projectPath)) roles.push('test')
  const routes = [...content.matchAll(/@(Get|Post|Put|Delete|Patch|Request)Mapping\s*(?:\(\s*(?:value\s*=\s*|path\s*=\s*)?["']([^"']*)["'][^)]*\))?/g)].map((match) => ({ method: match[1].toUpperCase(), path: match[2] ?? '' }))
  const tables = [...content.matchAll(/@Table\s*\(\s*(?:name\s*=\s*)?["']([^"']+)["']/g)].map((match) => match[1])
  const injectionTypes = new Set()
  for (const match of content.matchAll(/\b(?:private|protected|public|internal)?\s*(?:final\s+)?([A-Z][A-Za-z0-9_$]*(?:<[^;=]+>)?)\s+[a-z_$][\w$]*\s*(?:[;=])/g)) typeTokens(match[1]).forEach((type) => injectionTypes.add(type))
  for (const declaration of declarations) {
    const constructor = content.match(new RegExp('\\b' + declaration.name.replaceAll('$', '\\$&') + '\\s*\\(([^)]*)\\)'))
    if (constructor) typeTokens(constructor[1]).forEach((type) => injectionTypes.add(type))
  }
  for (const match of content.matchAll(/\b(?:private|protected|public|internal)?\s*(?:val|var)\s+[a-z_$][\w$]*\s*:\s*([A-Z][A-Za-z0-9_$.]*)/g)) injectionTypes.add(match[1])
  return {
    id: createHash('sha256').update(projectPath).digest('hex').slice(0, 20), path: projectPath,
    language: path.endsWith('.kt') ? 'kotlin' : 'java', packageName,
    qualifiedName: declarations[0].qualifiedName, declaredTypes: declarations.map((entry) => entry.qualifiedName),
    declarations, imports, moduleImports: [], injectionTypes: [...injectionTypes], roles, routes, tables,
    searchTerms: boundedSearchTerms([
      ...declarations.map((entry) => entry.name), ...imports, ...annotations, ...roles,
      ...routes.flatMap((route) => [route.method, route.path]), ...tables
    ])
  }
}

function parseEcmaSource(root, path, content) {
  const projectPath = portable(relative(root, path))
  const declarations = [...content.matchAll(/\b(class|interface|type|enum|function)\s+([A-Za-z_$][\w$]*)/g)]
    .slice(0, 64)
    .map((match) => ({ kind: match[1], name: match[2], qualifiedName: moduleQualifiedName(projectPath, match[2]), relations: [] }))
  const moduleImports = [
    ...content.matchAll(/^\s*(?:import|export)\s+(?:[^'"\n]*?\s+from\s+)?['"]([^'"]+)['"]/gm),
    ...content.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)
  ].map((match) => match[1])
  const importedIdentifiers = [...content.matchAll(/^\s*import\s+([^'"\n]+?)\s+from\s+['"][^'"]+['"]/gm)]
    .flatMap((match) => match[1].match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? [])
  const roles = []
  if (/(?:^|\/)controllers?(?:\/|$)|\.controller\.[^.]+$/.test(projectPath)) roles.push('controller')
  if (/(?:^|\/)services?(?:\/|$)|\.service\.[^.]+$/.test(projectPath)) roles.push('service')
  if (/(?:^|\/)repositories?(?:\/|$)|\.repository\.[^.]+$/.test(projectPath)) roles.push('repository')
  if (testRole(projectPath)) roles.push('test')
  return commonNode(root, path, declarations, roles, moduleImports, [
    ...declarations.map((entry) => entry.name), ...importedIdentifiers,
    ...moduleImports.flatMap((entry) => entry.split(/[^A-Za-z0-9_$]+/)), ...roles
  ])
}

function parsePythonSource(root, path, content) {
  const projectPath = portable(relative(root, path))
  const declarations = [...content.matchAll(/^\s*(class|def|async\s+def)\s+([A-Za-z_][\w]*)/gm)]
    .slice(0, 64)
    .map((match) => ({ kind: match[1].replace(/\s+/g, '-'), name: match[2], qualifiedName: moduleQualifiedName(projectPath, match[2]), relations: [] }))
  const moduleImports = []
  const importedIdentifiers = []
  for (const match of content.matchAll(/^\s*from\s+([.A-Za-z_][\w.]*)\s+import\s+([^#\n]+)/gm)) {
    moduleImports.push(match[1])
    importedIdentifiers.push(...(match[2].match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []))
  }
  for (const match of content.matchAll(/^\s*import\s+([^#\n]+)/gm)) {
    for (const imported of match[1].split(',')) moduleImports.push(imported.trim().split(/\s+as\s+/)[0])
  }
  const roles = []
  if (/(?:^|\/)(?:api\/routes|controllers?)(?:\/|$)/.test(projectPath)) roles.push('controller')
  if (/(?:^|\/)services?(?:\/|$)/.test(projectPath)) roles.push('service')
  if (/(?:^|\/)(?:repositories?|crud)(?:\/|\.|$)/.test(projectPath)) roles.push('repository')
  if (testRole(projectPath)) roles.push('test')
  return commonNode(root, path, declarations, roles, moduleImports.filter(Boolean), [
    ...declarations.map((entry) => entry.name), ...importedIdentifiers,
    ...moduleImports.flatMap((entry) => entry.split(/[^A-Za-z0-9_]+/)), ...roles
  ])
}

function parseSource(root, path, content) {
  if (JVM_FILE.test(path)) return parseJvmSource(root, path, content)
  if (path.endsWith('.py')) return parsePythonSource(root, path, content)
  if (SOURCE_FILE.test(path)) return parseEcmaSource(root, path, content)
  return commonNode(root, path, [], [], [], [])
}

function withoutSourceExtension(path) {
  return path.replace(/\.(?:java|kt|ts|tsx|js|jsx|mjs|cjs|py)$/, '')
}

function moduleIndex(nodes) {
  const index = new Map()
  function add(key, node) {
    const normalized = key.replace(/^\.\//, '').replace(/^\//, '')
    if (!normalized) return
    const entries = index.get(normalized) ?? []
    if (!entries.includes(node)) entries.push(node)
    index.set(normalized, entries)
  }
  for (const node of nodes) {
    const base = withoutSourceExtension(node.path)
    add(base, node)
    if (base.endsWith('/index') || base.endsWith('/__init__')) add(posix.dirname(base), node)
  }
  return index
}

function resolveModuleImport(index, nodes, source, imported) {
  if (typeof imported !== 'string' || !imported || imported.startsWith('node:')) return { node: null, ambiguous: false }
  let clean = imported.trim()
  const candidates = []
  if (clean.startsWith('.')) {
    if (source.language === 'python') {
      const dots = clean.match(/^\.+/)[0].length
      let base = posix.dirname(source.path)
      for (let cursor = 1; cursor < dots; cursor += 1) base = posix.dirname(base)
      clean = posix.join(base, clean.slice(dots).replaceAll('.', '/'))
    } else {
      clean = posix.normalize(posix.join(posix.dirname(source.path), clean))
    }
    candidates.push(...(index.get(clean) ?? []))
  } else {
    clean = clean.replace(/^@\//, '').replaceAll('.', '/')
    candidates.push(...(index.get(clean) ?? []))
    for (const [key, entries] of index) {
      if (key.endsWith('/' + clean)) candidates.push(...entries)
    }
  }
  const unique = [...new Set(candidates)].filter((node) => node !== source)
  return { node: unique.length === 1 ? unique[0] : null, ambiguous: unique.length > 1 }
}

function uniqueCandidate(candidates) {
  return candidates?.length === 1 ? candidates[0] : null
}

function resolver(qualifiedTypes, simpleTypes) {
  return (type, source) => {
    const clean = type.replace(/[?\[\]]/g, '').split('<')[0]
    if (clean.includes('.')) {
      const exact = qualifiedTypes.get(clean)
      return { node: uniqueCandidate(exact), ambiguous: Boolean(exact && exact.length !== 1) }
    }
    const samePackage = source.packageName ? qualifiedTypes.get(source.packageName + '.' + clean) : null
    if (samePackage) return { node: uniqueCandidate(samePackage), ambiguous: samePackage.length !== 1 }
    const explicit = source.imports.filter((entry) => !entry.endsWith('.*') && entry.split('.').at(-1) === clean).flatMap((entry) => qualifiedTypes.get(entry) ?? [])
    if (explicit.length > 0) return { node: uniqueCandidate(explicit), ambiguous: explicit.length !== 1 }
    const global = simpleTypes.get(clean)
    return { node: uniqueCandidate(global), ambiguous: Boolean(global && global.length !== 1) }
  }
}

function stronglyConnectedComponents(nodes, edges) {
  const adjacency = new Map(nodes.map((node) => [node.id, []]))
  const reverse = new Map(nodes.map((node) => [node.id, []]))
  edges.forEach((edge) => {
    adjacency.get(edge.from).push(edge.to)
    reverse.get(edge.to).push(edge.from)
  })
  const visited = new Set(), finishOrder = [], components = []
  for (const node of nodes) {
    if (visited.has(node.id)) continue
    visited.add(node.id)
    const stack = [{ id: node.id, cursor: 0 }]
    while (stack.length > 0) {
      const frame = stack.at(-1), neighbors = adjacency.get(frame.id)
      if (frame.cursor < neighbors.length) {
        const next = neighbors[frame.cursor++]
        if (!visited.has(next)) {
          visited.add(next)
          stack.push({ id: next, cursor: 0 })
        }
      } else {
        finishOrder.push(frame.id)
        stack.pop()
      }
    }
  }
  visited.clear()
  for (let cursor = finishOrder.length - 1; cursor >= 0; cursor -= 1) {
    const root = finishOrder[cursor]
    if (visited.has(root)) continue
    const members = [], stack = [root]
    visited.add(root)
    while (stack.length > 0) {
      const id = stack.pop()
      members.push(id)
      for (const next of reverse.get(id)) {
        if (!visited.has(next)) {
          visited.add(next)
          stack.push(next)
        }
      }
    }
    components.push(members.sort())
  }
  components.sort((left, right) => left[0].localeCompare(right[0]))
  const componentByNode = new Map()
  components.forEach((members, componentIndex) => members.forEach((id) => componentByNode.set(id, componentIndex)))
  return { components, componentByNode }
}

function pageRank(nodes, edges) {
  if (nodes.length === 0) return { ranks: [], iterations: 0, residual: 0, damping: 0.85, maxIterations: 30 }
  const nodeIndex = new Map(nodes.map((node, index) => [node.id, index]))
  const outgoing = nodes.map(() => [])
  edges.forEach((edge) => outgoing[nodeIndex.get(edge.from)].push({ to: nodeIndex.get(edge.to), weight: EDGE_WEIGHTS[edge.kind] }))
  const damping = 0.85, maxIterations = 30
  let ranks = nodes.map(() => 1 / nodes.length), residual = 0, iterations = 0
  for (; iterations < maxIterations; iterations += 1) {
    const next = nodes.map(() => (1 - damping) / nodes.length)
    let dangling = 0
    for (let from = 0; from < nodes.length; from += 1) {
      const totalWeight = outgoing[from].reduce((sum, edge) => sum + edge.weight, 0)
      if (totalWeight === 0) dangling += ranks[from]
      else for (const edge of outgoing[from]) next[edge.to] += damping * ranks[from] * edge.weight / totalWeight
    }
    const danglingContribution = damping * dangling / nodes.length
    for (let cursor = 0; cursor < next.length; cursor += 1) next[cursor] += danglingContribution
    residual = next.reduce((sum, value, cursor) => sum + Math.abs(value - ranks[cursor]), 0)
    ranks = next
    if (residual < 1e-10) { iterations += 1; break }
  }
  return { ranks, iterations, residual, damping, maxIterations }
}

export async function indexProjectGraph(root = process.cwd(), options = {}) {
  const discovered = await discover(root)
  let indexedBytes = 0, oversizedFiles = 0
  const readable = []
  for (const path of discovered.files) {
    const metadata = await lstat(path)
    if (!metadata.isFile() || metadata.isSymbolicLink()) { discovered.skippedSymlinks += 1; continue }
    const readContent = SOURCE_FILE.test(path)
    if (readContent && metadata.size > MAX_FILE_BYTES) { oversizedFiles += 1; continue }
    if (readContent) {
      indexedBytes += metadata.size
      if (indexedBytes > MAX_SOURCE_BYTES) throw new Error('Codegraph source input exceeded the 256 MiB safety limit.')
    }
    readable.push({ path, readContent })
  }
  let actualBytes = 0
  const parallelism = options.parallelism ?? Math.min(8, Math.max(1, availableParallelism?.() ?? 4))
  const nodes = await mapLimit(readable, parallelism, async (entry) => {
    if (!entry.readContent) return parseSource(root, entry.path, '')
    const buffer = await readFile(entry.path); actualBytes += buffer.length
    if (buffer.length > MAX_FILE_BYTES || actualBytes > MAX_SOURCE_BYTES) throw new Error('Codegraph source changed beyond a read safety limit.')
    return parseSource(root, entry.path, buffer.toString('utf8'))
  })
  const qualifiedTypes = new Map(), simpleTypes = new Map()
  for (const node of nodes) for (const qualifiedName of node.declaredTypes) {
    const qualified = qualifiedTypes.get(qualifiedName) ?? []; qualified.push(node); qualifiedTypes.set(qualifiedName, qualified)
    const simpleName = qualifiedName.split('.').at(-1), simple = simpleTypes.get(simpleName) ?? []; simple.push(node); simpleTypes.set(simpleName, simple)
  }
  const resolveType = resolver(qualifiedTypes, simpleTypes)
  const modules = moduleIndex(nodes)
  const edges = [], edgeKeys = new Set()
  let unresolvedImports = 0, ambiguousImports = 0, unresolvedRelations = 0, ambiguousRelations = 0
  function edge(from, to, kind, provenance) {
    if (!to || from.id === to.id) return
    const key = from.id + '\0' + to.id + '\0' + kind
    if (edgeKeys.has(key)) return
    if (edges.length >= MAX_EDGES) throw new Error('Codegraph edge count exceeded the ' + MAX_EDGES + '-edge limit.')
    edgeKeys.add(key); edges.push({ from: from.id, to: to.id, kind, provenance })
  }
  for (const node of nodes) {
    for (const imported of node.moduleImports) {
      const resolved = resolveModuleImport(modules, nodes, node, imported)
      if (resolved.ambiguous) ambiguousImports += 1
      else if (!resolved.node) unresolvedImports += 1
      else edge(node, resolved.node, 'imports', 'static-import-resolved')
    }
    if (!['java', 'kotlin'].includes(node.language)) continue
    for (const imported of node.imports) {
      if (imported.endsWith('.*')) { unresolvedImports += 1; continue }
      const candidates = qualifiedTypes.get(imported) ?? qualifiedTypes.get(imported.split('.').slice(0, -1).join('.'))
      if (!candidates) unresolvedImports += 1
      else if (candidates.length !== 1) ambiguousImports += 1
      else edge(node, candidates[0], 'imports', 'static-import-resolved')
    }
    for (const declaration of node.declarations) for (const relation of declaration.relations) {
      const resolved = resolveType(relation.type, node)
      if (resolved.ambiguous) ambiguousRelations += 1
      else if (!resolved.node) unresolvedRelations += 1
      else edge(
        node,
        resolved.node,
        relation.kind === 'kotlin-supertype'
          ? kotlinRelationKind(declaration.kind, relation.type, resolved.node)
          : relation.kind,
        'source-declaration-resolved'
      )
    }
    for (const injected of node.injectionTypes) {
      const resolved = resolveType(injected, node)
      if (resolved.ambiguous) ambiguousRelations += 1
      else if (resolved.node) edge(node, resolved.node, 'injects', 'source-pattern-resolved')
    }
    if (node.roles.includes('test')) for (const declaredType of node.declaredTypes) {
      const declaredName = declaredType.split('.').at(-1), simple = declaredName.replace(/(?:Integration)?Tests?$/, '')
      if (simple !== declaredName) { const resolved = resolveType(simple, node); if (resolved.node) edge(node, resolved.node, 'tests', 'convention-test-name-resolved') }
    }
  }
  edges.sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to) || left.kind.localeCompare(right.kind))
  const scc = stronglyConnectedComponents(nodes, edges), ranking = pageRank(nodes, edges)
  nodes.forEach((node, index) => {
    node.componentId = scc.componentByNode.get(node.id); node.globalRank = ranking.ranks[index]
    delete node.packageName; delete node.declarations; delete node.imports; delete node.moduleImports; delete node.injectionTypes
  })
  const findings = []
  if (unresolvedImports > 0) findings.push({ ruleId: 'graph.coverage.unresolved-imports', severity: 'info', message: unresolvedImports + ' imports were intentionally left unresolved.', location: null })
  if (oversizedFiles > 0) findings.push({ ruleId: 'graph.coverage.oversized-files', severity: 'warning', message: oversizedFiles + ' source files larger than 2 MiB were not indexed.', location: null })
  if (discovered.skippedSymlinks > 0) findings.push({ ruleId: 'graph.coverage.skipped-symlinks', severity: 'warning', message: discovered.skippedSymlinks + ' symbolic links were not indexed.', location: null })
  if (ambiguousImports > 0) findings.push({ ruleId: 'graph.coverage.ambiguous-imports', severity: 'warning', message: ambiguousImports + ' imports matched duplicate project type declarations and were not linked.', location: null })
  if (unresolvedRelations > 0) findings.push({ ruleId: 'graph.coverage.unresolved-relations', severity: 'info', message: unresolvedRelations + ' declared inheritance/implementation relations were left unresolved.', location: null })
  if (ambiguousRelations > 0) findings.push({ ruleId: 'graph.coverage.ambiguous-relations', severity: 'warning', message: ambiguousRelations + ' structural relations were ambiguous and not linked.', location: null })
  const metrics = {
    nodes: nodes.length, edges: edges.length, unresolvedImports, ambiguousImports, unresolvedRelations, ambiguousRelations,
    duplicateTypes: [...qualifiedTypes.values()].filter((entries) => entries.length > 1).length, oversizedFiles, skippedSymlinks: discovered.skippedSymlinks,
    indexedBytes: actualBytes, rankedNodes: nodes.length, declarations: nodes.reduce((sum, node) => sum + node.declaredTypes.length, 0),
    stronglyConnectedComponents: scc.components.length, cyclicComponents: scc.components.filter((members) => members.length > 1).length,
    ...Object.fromEntries(Object.keys(EDGE_WEIGHTS).map((kind) => ['edges.' + kind, edges.filter((edge) => edge.kind === kind).length])),
    ...Object.fromEntries(['java', 'kotlin', 'typescript', 'javascript', 'python', 'artifact'].map((language) => ['language.' + language, nodes.filter((node) => node.language === language).length]))
  }
  const generatedAt = options.generatedAt ?? new Date().toISOString()
  const generation = createHash('sha256').update(JSON.stringify(nodes) + JSON.stringify(edges)).digest('hex')
  return {
    schemaVersion: 1, tool: { id: 'bth-semantic-advisory-graph', version: '2.0.0' }, findings, metrics,
    graph: {
      schemaVersion: 1, generatedAt, generation, advisory: true,
      permittedUses: ['navigation', 'review-questions', 'impact-localization'], forbiddenUses: ['pass-verdict', 'test-skipping'],
      ranking: { algorithm: 'weighted-pagerank', damping: ranking.damping, maxIterations: ranking.maxIterations, iterations: ranking.iterations, residual: ranking.residual, queryPersonalized: false, edgeWeights: EDGE_WEIGHTS },
      nodes, edges
    }
  }
}
