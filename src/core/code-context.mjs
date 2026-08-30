import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isAbsolute, posix } from 'node:path'
import { resolveReadableRoot, resolveSafeProjectPath, statPath } from '../fs-safety.mjs'
import { canonicalJson } from './canonical-json.mjs'
import { personalizeCodeNodes as personalization } from './lexical-retrieval.mjs'

const MAX_NODES = 100_000
const MAX_EDGES = 500_000
const DAMPING = 0.85
const MAX_ITERATIONS = 30
const TOLERANCE = 1e-10
const GRAPH_PATH = '.backend-harness/generated/packs/codegraph-advisory/graph.json'
const RUN_PATH = '.backend-harness/local/runs/latest.json'
const MAX_REPORT_BYTES = 16 * 1024 * 1024
const MAX_AUTHORITY_ITEMS = 16
const AUTHORITY_ITEM = /^[a-z][a-z0-9-]{0,63}$/
const EDGE_CONTRACTS = new Map([
  ['imports\0static-import-resolved', 1],
  ['inherits\0source-declaration-resolved', 1.25],
  ['implements\0source-declaration-resolved', 1.25],
  ['injects\0source-pattern-resolved', 0.9],
  ['tests\0convention-test-name-resolved', 0.65],
  ['tests\0convention-test-path-resolved', 0.65]
])
const MAX_IMPACT_DEPTH = 8
const MAX_IMPACT_NODES = 5000
const MAX_IMPACT_PATHS = 32
const SEARCH_TERM = /^[A-Za-z_$][A-Za-z0-9_$]{1,127}$/

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(label + ' must be an object.')
  }
}

function safeGraphPath(value, label) {
  if (typeof value !== 'string' || !value || value.length > 4096 || value.includes('\0')) {
    throw new Error(label + ' is invalid.')
  }
  const normalized = value.replaceAll('\\', '/')
  if (isAbsolute(normalized) || /^[A-Za-z]:\//.test(normalized) || normalized.split('/').some((part) => !part || part === '..')) {
    throw new Error(label + ' must stay inside the project.')
  }
  return posix.normalize(normalized.replace(/^\.\//, ''))
}

function boundedAuthority(values, label, required) {
  if (!Array.isArray(values) || values.length === 0 || values.length > MAX_AUTHORITY_ITEMS) {
    throw new Error(label + ' must be a bounded non-empty array with at most ' + MAX_AUTHORITY_ITEMS + ' entries.')
  }
  const normalized = []
  for (const value of values) {
    if (typeof value !== 'string' || !AUTHORITY_ITEM.test(value)) {
      throw new Error(label + ' must contain bounded authority identifiers.')
    }
    if (!normalized.includes(value)) {
      normalized.push(value)
    }
  }
  for (const value of required) {
    if (!normalized.includes(value)) {
      throw new Error(label + ' must include ' + value + '.')
    }
  }
  return normalized
}

function validateGraph(document) {
  assertObject(document, 'graph document')
  if (document.schemaVersion !== 1) {
    throw new Error('graph document schemaVersion must be 1.')
  }
  assertObject(document.graph, 'graph')
  const graph = document.graph
  if (graph.schemaVersion !== 1 || graph.advisory !== true) {
    throw new Error('graph must be a schemaVersion 1 advisory graph.')
  }
  const permittedUses = boundedAuthority(graph.permittedUses, 'graph.permittedUses', ['navigation'])
  const forbiddenUses = boundedAuthority(graph.forbiddenUses, 'graph.forbiddenUses', ['pass-verdict', 'test-skipping'])
  if (!Array.isArray(graph.nodes) || graph.nodes.length > MAX_NODES) {
    throw new Error('graph nodes exceed the safety limit.')
  }
  if (!Array.isArray(graph.edges) || graph.edges.length > MAX_EDGES) {
    throw new Error('graph edges exceed the safety limit.')
  }
  const ids = new Set()
  const paths = new Set()
  const nodes = graph.nodes.map((node, index) => {
    assertObject(node, 'nodes[' + index + ']')
    if (typeof node.id !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(node.id) || ids.has(node.id)) {
      throw new Error('nodes[' + index + '].id is invalid or duplicated.')
    }
    const path = safeGraphPath(node.path, 'nodes[' + index + '].path')
    if (paths.has(path)) {
      throw new Error('nodes[' + index + '].path is duplicated.')
    }
    if (typeof node.qualifiedName !== 'string' || !node.qualifiedName || node.qualifiedName.length > 1024) {
      throw new Error('nodes[' + index + '].qualifiedName is invalid.')
    }
    if (!['java', 'kotlin', 'typescript', 'javascript', 'python', 'artifact'].includes(node.language)) {
      throw new Error('nodes[' + index + '].language is invalid.')
    }
    const searchTerms = node.searchTerms === undefined
      ? []
      : Array.isArray(node.searchTerms) && node.searchTerms.length <= 128 && node.searchTerms.every((term) => typeof term === 'string' && SEARCH_TERM.test(term))
        ? [...new Set(node.searchTerms)]
        : null
    if (searchTerms === null) throw new Error('nodes[' + index + '].searchTerms is invalid.')
    ids.add(node.id)
    paths.add(path)
    return { id: node.id, path, language: node.language, qualifiedName: node.qualifiedName, searchTerms }
  })
  const edges = graph.edges.map((edge, index) => {
    assertObject(edge, 'edges[' + index + ']')
    if (!ids.has(edge.from) || !ids.has(edge.to)) {
      throw new Error('edges[' + index + '] references an unknown node.')
    }
    const weight = EDGE_CONTRACTS.get(edge.kind + '\0' + edge.provenance)
    if (weight === undefined) {
      throw new Error('edges[' + index + '] has unsupported kind or provenance.')
    }
    return { from: edge.from, to: edge.to, kind: edge.kind, provenance: edge.provenance, weight }
  })
  return {
    nodes,
    edges,
    generatedAt: typeof graph.generatedAt === 'string' ? graph.generatedAt : null,
    generation: typeof graph.generation === 'string' ? graph.generation : null,
    permittedUses,
    forbiddenUses
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
    components.push(members)
  }
  return components
}

function reachable(seedIds, edges, direction) {
  const adjacency = new Map()
  for (const edge of edges) {
    const from = direction === 'forward' ? edge.from : edge.to
    const to = direction === 'forward' ? edge.to : edge.from
    const list = adjacency.get(from) ?? []
    list.push(to)
    adjacency.set(from, list)
  }
  const seen = new Set(seedIds)
  let frontier = [...seedIds]
  let depth = 0
  let truncated = false
  while (frontier.length > 0 && depth < MAX_IMPACT_DEPTH) {
    const next = []
    for (const id of frontier) {
      for (const target of adjacency.get(id) ?? []) {
        if (seen.has(target)) continue
        if (seen.size >= MAX_IMPACT_NODES) {
          truncated = true
          break
        }
        seen.add(target)
        next.push(target)
      }
      if (truncated) break
    }
    frontier = next
    depth += 1
    if (truncated) break
  }
  if (frontier.length > 0) truncated = true
  seedIds.forEach((id) => seen.delete(id))
  return { ids: seen, depth, truncated }
}

function pageRank(nodes, edges, teleport) {
  if (nodes.length === 0) {
    return { scores: [], iterations: 0, residual: 0, converged: true }
  }
  const indexes = new Map(nodes.map((node, index) => [node.id, index]))
  const adjacency = nodes.map(() => new Map())
  for (const edge of edges) {
    const from = indexes.get(edge.from)
    const to = indexes.get(edge.to)
    adjacency[from].set(to, (adjacency[from].get(to) ?? 0) + edge.weight)
    adjacency[to].set(from, (adjacency[to].get(from) ?? 0) + edge.weight * 0.5)
  }
  const outgoingWeights = adjacency.map((links) => {
    let total = 0
    for (const weight of links.values()) {
      total += weight
    }
    return total
  })
  let scores = [...teleport]
  let residual = Number.POSITIVE_INFINITY
  let iterations = 0
  for (; iterations < MAX_ITERATIONS; iterations += 1) {
    const next = teleport.map((weight) => (1 - DAMPING) * weight)
    let dangling = 0
    for (let from = 0; from < nodes.length; from += 1) {
      const links = adjacency[from]
      const totalWeight = outgoingWeights[from]
      if (totalWeight === 0) {
        dangling += scores[from]
        continue
      }
      for (const [to, weight] of links) {
        next[to] += DAMPING * scores[from] * weight / totalWeight
      }
    }
    if (dangling > 0) {
      for (let index = 0; index < next.length; index += 1) {
        next[index] += DAMPING * dangling * teleport[index]
      }
    }
    residual = next.reduce((sum, value, index) => sum + Math.abs(value - scores[index]), 0)
    scores = next
    if (residual < TOLERANCE) {
      iterations += 1
      break
    }
  }
  return { scores, iterations, residual, converged: residual < TOLERANCE }
}

function withEntryCost(candidate) {
  let costCharacters = 0
  while (true) {
    const entry = { ...candidate, costCharacters }
    const nextCost = JSON.stringify(entry).length
    if (nextCost === costCharacters) {
      return entry
    }
    costCharacters = nextCost
  }
}

export function rankCodeContext(document, query, options = {}) {
  const graph = validateGraph(document)
  const budgetCharacters = options.budgetCharacters ?? 4000
  if (!Number.isSafeInteger(budgetCharacters) || budgetCharacters < 64 || budgetCharacters > 100_000) {
    throw new Error('Context budget must be an integer between 64 and 100000 characters.')
  }
  const seed = personalization(graph.nodes, query)
  const ranked = pageRank(graph.nodes, graph.edges, seed.weights)
  const finalScores = seed.mode === 'query-personalized'
    ? ranked.scores.map((score, index) => 0.4 * score + 0.6 * seed.weights[index])
    : ranked.scores
  const provenanceByNode = new Map(graph.nodes.map((node) => [node.id, new Set(['graph-node'])]))
  for (const edge of graph.edges) {
    provenanceByNode.get(edge.from).add(edge.provenance)
    provenanceByNode.get(edge.to).add(edge.provenance)
  }
  const candidates = graph.nodes
    .map((node, index) => ({
      path: node.path,
      qualifiedName: node.qualifiedName,
      language: node.language,
      score: Number(finalScores[index].toPrecision(12)),
      provenance: [...provenanceByNode.get(node.id)].sort(),
      nodeId: node.id,
      rankIndex: index
    }))
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
  const entries = []
  const selected = new Set()
  const candidateById = new Map(candidates.map((candidate) => [candidate.nodeId, candidate]))
  const testPairs = new Map(graph.nodes.map((node) => [node.id, []]))
  for (const edge of graph.edges.filter((entry) => entry.kind === 'tests')) {
    testPairs.get(edge.from).push(edge.to)
    testPairs.get(edge.to).push(edge.from)
  }
  let usedCharacters = 0
  function select(candidate) {
    if (!candidate || selected.has(candidate.nodeId)) return false
    const { nodeId: _nodeId, rankIndex: _rankIndex, ...publicCandidate } = candidate
    const entry = withEntryCost(publicCandidate)
    if (usedCharacters + entry.costCharacters > budgetCharacters) {
      return false
    }
    entries.push(entry)
    selected.add(candidate.nodeId)
    usedCharacters += entry.costCharacters
    return true
  }
  for (const candidate of candidates) {
    if (!select(candidate)) continue
    const paired = (testPairs.get(candidate.nodeId) ?? [])
      .map((id) => candidateById.get(id))
      .filter(Boolean)
      .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
      .at(0)
    select(paired)
  }
  const seedIds = seed.seededIndexes.map((index) => graph.nodes[index].id)
  const dependencies = reachable(seedIds, graph.edges, 'forward')
  const dependents = reachable(seedIds, graph.edges, 'reverse')
  const scoreById = new Map(candidates.map((candidate) => [candidate.nodeId, candidate.score]))
  const pathById = new Map(graph.nodes.map((node) => [node.id, node.path]))
  function topPaths(ids) {
    const paths = [...ids]
      .sort((left, right) => (scoreById.get(right) ?? 0) - (scoreById.get(left) ?? 0) || pathById.get(left).localeCompare(pathById.get(right)))
      .slice(0, MAX_IMPACT_PATHS)
      .map((id) => pathById.get(id))
    return { paths, omitted: Math.max(0, ids.size - paths.length) }
  }
  const components = stronglyConnectedComponents(graph.nodes, graph.edges)
  const cyclicComponents = components.filter((members) => members.length > 1)
  return {
    status: 'available',
    authority: {
      evidenceTier: 'REPORTED',
      advisory: true,
      permittedUses: graph.permittedUses,
      forbiddenUses: graph.forbiddenUses
    },
    graph: {
      generation: graph.generation,
      generatedAt: graph.generatedAt,
      nodes: graph.nodes.length,
      edges: graph.edges.length
    },
    algorithm: {
      id: 'bounded-personalized-pagerank',
      damping: DAMPING,
      reverseEdgeWeight: 0.5,
      lexicalPriorBlend: seed.mode === 'query-personalized' ? 0.6 : 0,
      lexicalPrior: seed.lexical,
      testPairCoSelection: true,
      maxIterations: MAX_ITERATIONS,
      iterations: ranked.iterations,
      residual: ranked.residual,
      tolerance: TOLERANCE,
      converged: ranked.converged
    },
    query: {
      mode: seed.mode,
      matchedTokens: seed.matchedTokens,
      seededNodeCount: seed.seededNodeCount
    },
    impact: {
      authority: 'advisory-structural-localization',
      maxDepth: MAX_IMPACT_DEPTH,
      seedPaths: seedIds.map((id) => pathById.get(id)).slice(0, MAX_IMPACT_PATHS),
      dependencies: { count: dependencies.ids.size, truncated: dependencies.truncated, ...topPaths(dependencies.ids) },
      dependents: { count: dependents.ids.size, truncated: dependents.truncated, ...topPaths(dependents.ids) },
      stronglyConnectedComponents: components.length,
      cyclicComponents: cyclicComponents.length
    },
    budget: {
      limitCharacters: budgetCharacters,
      usedCharacters,
      omittedNodes: candidates.length - entries.length
    },
    entries,
    limitations: [
      'Imports and declared inheritance are exact only when their project type resolves uniquely; injection and convention-resolved test-pair edges are source-pattern evidence.',
      'This remains an advisory structural graph, not a compiler call graph.',
      'Reflection, runtime dependency injection, generated code, and dynamic SQL ownership are not resolved.',
      'Ranking may guide navigation or review questions only.'
    ]
  }
}

function unavailable(reason, diagnostic, budgetCharacters) {
  return {
    status: 'unavailable',
    reason,
    diagnostic,
    authority: {
      evidenceTier: 'REPORTED',
      advisory: true,
      permittedUses: ['navigation', 'review-questions'],
      forbiddenUses: ['pass-verdict', 'test-skipping']
    },
    budget: { limitCharacters: budgetCharacters, usedCharacters: 0, omittedNodes: 0 },
    entries: []
  }
}

export async function loadBudgetedCodeContext(inputPath, query, options = {}) {
  const budgetCharacters = options.budgetCharacters ?? 4000
  if (budgetCharacters === 0) {
    return unavailable('disabled', 'Context budget is zero.', 0)
  }
  if (!Number.isSafeInteger(budgetCharacters) || budgetCharacters < 64 || budgetCharacters > 100_000) {
    throw new Error('Context budget must be zero or an integer between 64 and 100000 characters.')
  }
  if (typeof options.sourceFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(options.sourceFingerprint)) {
    return unavailable('source_fingerprint_required', 'A current source fingerprint is required.', budgetCharacters)
  }
  const root = await resolveReadableRoot(inputPath)
  let graphPath
  let runPath
  try {
    graphPath = await resolveSafeProjectPath(root, GRAPH_PATH)
    runPath = await resolveSafeProjectPath(root, RUN_PATH)
  } catch (error) {
    return unavailable('unsafe_path', error instanceof Error ? error.message : String(error), budgetCharacters)
  }
  const [graphMetadata, runMetadata] = await Promise.all([statPath(graphPath), statPath(runPath)])
  if (!graphMetadata) {
    return unavailable('graph_missing', 'Run the installed codegraph-advisory Gate with `bth check` first.', budgetCharacters)
  }
  if (!runMetadata) {
    return unavailable('bound_run_missing', 'A sealed project check containing the graph is required.', budgetCharacters)
  }
  if (!graphMetadata.isFile() || graphMetadata.isSymbolicLink() || graphMetadata.size > MAX_REPORT_BYTES) {
    return unavailable('graph_unsafe', 'Graph report is not a bounded regular non-symbolic link file.', budgetCharacters)
  }
  if (!runMetadata.isFile() || runMetadata.isSymbolicLink() || runMetadata.size > MAX_REPORT_BYTES) {
    return unavailable('bound_run_unsafe', 'Latest project run is not a bounded regular non-symbolic link file.', budgetCharacters)
  }

  let run
  try {
    run = JSON.parse(await readFile(runPath, 'utf8'))
  } catch (error) {
    return unavailable('bound_run_invalid', 'Latest project run has invalid JSON: ' + error.message, budgetCharacters)
  }
  if (!run || typeof run !== 'object' || Array.isArray(run)) {
    return unavailable('bound_run_invalid', 'Latest project run must be a JSON object.', budgetCharacters)
  }
  const { recordSha256, ...unsignedRun } = run
  const expectedRunSha = createHash('sha256').update(canonicalJson(unsignedRun)).digest('hex')
  if (recordSha256 !== expectedRunSha) {
    return unavailable('bound_run_invalid', 'Latest project run seal does not match its content.', budgetCharacters)
  }
  if (run.source?.fingerprint !== options.sourceFingerprint) {
    return unavailable('bound_run_source_stale', 'Latest graph run belongs to a different source fingerprint.', budgetCharacters)
  }
  const graphGate = run.gates?.find((gate) => gate.id === 'codegraph' && gate.outcome === 'passed')
  const digest = graphGate?.result?.reportDigests?.find((entry) => entry.path === GRAPH_PATH)
  if (!digest || typeof digest.sha256 !== 'string' || !Number.isSafeInteger(digest.bytes)) {
    return unavailable('graph_not_bound', 'Latest project run does not bind a successful codegraph report.', budgetCharacters)
  }
  const graphText = await readFile(graphPath, 'utf8')
  const actualSha = createHash('sha256').update(graphText).digest('hex')
  if (actualSha !== digest.sha256 || Buffer.byteLength(graphText) !== digest.bytes) {
    return unavailable('graph_digest_mismatch', 'Graph content no longer matches the sealed project run.', budgetCharacters)
  }
  try {
    const ranked = rankCodeContext(JSON.parse(graphText), query, { budgetCharacters })
    return {
      ...ranked,
      provenance: {
        graphPath: GRAPH_PATH,
        reportSha256: actualSha,
        runPath: RUN_PATH,
        runRecordSha256: recordSha256,
        sourceFingerprint: options.sourceFingerprint
      }
    }
  } catch (error) {
    return unavailable('graph_invalid', error instanceof Error ? error.message : String(error), budgetCharacters)
  }
}
