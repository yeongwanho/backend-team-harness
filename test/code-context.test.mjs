import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initProject } from '../src/init-project.mjs'
import { captureConfiguredSourceBinding } from '../src/runtime/backend-harness.mjs'
import { recordProjectRun } from '../src/core/run-record-store.mjs'
import { loadBudgetedCodeContext, rankCodeContext } from '../src/core/code-context.mjs'
import { inspectBoundSourceCodeContext } from '../src/adapters/bounded-code-context.mjs'
import { initializeGit, writeGradleFixture } from '../test-support/git-project.mjs'
import { IMPACT_GOLD_V1 } from './fixtures/impact-gold-v1.mjs'

function graphDocument() {
  return {
    schemaVersion: 1,
    tool: { id: 'bth-import-graph', version: '1.1.0' },
    findings: [],
    metrics: { nodes: 4, edges: 2 },
    graph: {
      schemaVersion: 1,
      generatedAt: '2026-08-30T00:00:00.000Z',
      generation: 'a'.repeat(64),
      advisory: true,
      permittedUses: ['navigation', 'review-questions'],
      forbiddenUses: ['pass-verdict', 'test-skipping'],
      nodes: [
        { id: 'controller', path: 'src/main/java/orders/OrdersController.java', language: 'java', qualifiedName: 'orders.OrdersController' },
        { id: 'service', path: 'src/main/java/orders/OrdersService.java', language: 'java', qualifiedName: 'orders.OrdersService' },
        { id: 'repository', path: 'src/main/java/orders/OrdersRepository.java', language: 'java', qualifiedName: 'orders.OrdersRepository' },
        { id: 'unrelated', path: 'src/main/java/audit/AuditClock.java', language: 'java', qualifiedName: 'audit.AuditClock' }
      ],
      edges: [
        { from: 'controller', to: 'service', kind: 'imports', provenance: 'static-import-resolved' },
        { from: 'service', to: 'repository', kind: 'imports', provenance: 'static-import-resolved' }
      ]
    }
  }
}

test('query-aware PageRank keeps the lexical entry point and exact graph neighbors inside budget', () => {
  const document = graphDocument()
  const result = rankCodeContext(document, 'Change OrdersController lookup behavior', { budgetCharacters: 700 })

  assert.equal(result.status, 'available')
  assert.equal(result.algorithm.id, 'bounded-personalized-pagerank')
  assert.equal(typeof result.algorithm.converged, 'boolean')
  assert.equal(result.algorithm.converged, result.algorithm.residual < result.algorithm.tolerance)
  assert.ok(result.query.seededNodeCount >= 1)
  assert.equal(result.entries[0].path, 'src/main/java/orders/OrdersController.java')
  assert.ok(result.entries.some((entry) => entry.path.endsWith('OrdersService.java')))
  assert.ok(result.budget.usedCharacters <= result.budget.limitCharacters)
  assert.equal(result.budget.usedCharacters, result.entries.reduce((sum, entry) => sum + JSON.stringify(entry).length, 0))
  assert.ok(result.entries.every((entry) => document.graph.nodes.some((node) => node.path === entry.path)))
  assert.deepEqual(result.authority.forbiddenUses, ['pass-verdict', 'test-skipping'])
})

test('no lexical match uses a deterministic global fallback instead of inventing relevance', () => {
  const first = rankCodeContext(graphDocument(), '한국어 요구사항만 있음', { budgetCharacters: 700 })
  const second = rankCodeContext(graphDocument(), '한국어 요구사항만 있음', { budgetCharacters: 700 })

  assert.equal(first.query.mode, 'global-fallback')
  assert.deepEqual(first.entries, second.entries)
  assert.equal(first.query.matchedTokens.length, 0)
})

test('requirement action verbs do not outrank a backend documentation concept', () => {
  const document = graphDocument()
  document.graph.nodes = [
    {
      id: 'main', path: 'src/main.ts', language: 'typescript', qualifiedName: 'src.main#bootstrap',
      searchTerms: ['DocumentBuilder', 'SwaggerModule']
    },
    {
      id: 'user', path: 'src/users/domain/user.ts', language: 'typescript', qualifiedName: 'src.users.domain.user#User',
      searchTerms: ['Expose', 'SwaggerModule']
    }
  ]
  document.graph.edges = []

  const result = rankCodeContext(
    document,
    'Expose the global request header in generated Swagger documentation.',
    { budgetCharacters: 700 }
  )

  assert.equal(result.entries[0].path, 'src/main.ts')
  assert.ok(result.query.matchedTokens.includes('document'))
  assert.equal(result.query.matchedTokens.includes('expose'), false)
})

test('PageRank convergence telemetry distinguishes an exact fixed point from an iteration cap', () => {
  const fixedPoint = graphDocument()
  fixedPoint.graph.nodes = fixedPoint.graph.nodes.slice(0, 2)
  fixedPoint.graph.edges = [
    { from: 'controller', to: 'service', kind: 'imports', provenance: 'static-import-resolved' },
    { from: 'service', to: 'controller', kind: 'imports', provenance: 'static-import-resolved' }
  ]
  const converged = rankCodeContext(fixedPoint, '한국어만', { budgetCharacters: 700 })
  const capped = rankCodeContext(graphDocument(), '한국어만', { budgetCharacters: 700 })

  assert.equal(converged.algorithm.converged, true)
  assert.ok(converged.algorithm.iterations < converged.algorithm.maxIterations)
  assert.equal(capped.algorithm.converged, false)
  assert.equal(capped.algorithm.iterations, capped.algorithm.maxIterations)
})

test('budget is a hard bound and reports omitted nodes', () => {
  const result = rankCodeContext(graphDocument(), 'OrdersController', { budgetCharacters: 180 })

  assert.ok(result.budget.usedCharacters <= 180)
  assert.ok(result.budget.omittedNodes > 0)
  assert.ok(result.entries.length < graphDocument().graph.nodes.length)
})

test('unsafe graph contracts are rejected before ranking', () => {
  const unsafe = graphDocument()
  unsafe.graph.advisory = false
  assert.throws(() => rankCodeContext(unsafe, 'orders', { budgetCharacters: 700 }), /advisory/)

  const invented = graphDocument()
  invented.graph.edges[0].provenance = 'name-guess'
  assert.throws(() => rankCodeContext(invented, 'orders', { budgetCharacters: 700 }), /provenance/)

  const oversizedAuthority = graphDocument()
  oversizedAuthority.graph.permittedUses = ['navigation', ...Array.from({ length: 32 }, (_, index) => 'extra-' + index)]
  assert.throws(
    () => rankCodeContext(oversizedAuthority, 'orders', { budgetCharacters: 64 }),
    /permittedUses.*bounded/i
  )
})

test('graph contract accepts supported backend languages without changing edge authority', () => {
  const document = graphDocument()
  document.graph.nodes[0].language = 'typescript'
  document.graph.nodes[1].language = 'javascript'
  document.graph.nodes[2].language = 'python'

  const result = rankCodeContext(document, 'OrdersController', { budgetCharacters: 700 })

  assert.deepEqual(result.entries.slice(0, 3).map((entry) => entry.language).sort(), ['javascript', 'python', 'typescript'])
  assert.ok(result.entries.every((entry) => entry.provenance.includes('static-import-resolved') || entry.path.endsWith('AuditClock.java')))
})

test('authority metadata stays bounded independently of a tiny entry budget', () => {
  const document = graphDocument()
  const identifiers = Array.from({ length: 16 }, (_, index) => 'x' + String(index).padStart(63, 'a'))
  document.graph.permittedUses = ['navigation', ...identifiers.slice(0, 15)]
  document.graph.forbiddenUses = ['pass-verdict', 'test-skipping', ...identifiers.slice(0, 14)]

  const result = rankCodeContext(document, 'orders', { budgetCharacters: 64 })

  assert.equal(result.entries.length, 0)
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 8192)
})

test('semantic edges produce directional dependencies and dependents without claiming runtime truth', () => {
  const document = graphDocument()
  document.graph.edges = [
    { from: 'controller', to: 'service', kind: 'injects', provenance: 'source-pattern-resolved' },
    { from: 'service', to: 'repository', kind: 'imports', provenance: 'static-import-resolved' }
  ]

  const result = rankCodeContext(document, 'OrdersService', { budgetCharacters: 700 })

  assert.equal(result.impact.authority, 'advisory-structural-localization')
  assert.deepEqual(result.impact.seedPaths, ['src/main/java/orders/OrdersService.java'])
  assert.ok(result.impact.dependencies.paths.includes('src/main/java/orders/OrdersRepository.java'))
  assert.ok(result.impact.dependents.paths.includes('src/main/java/orders/OrdersController.java'))
  assert.ok(result.entries.find((entry) => entry.path.endsWith('OrdersService.java')).provenance.includes('source-pattern-resolved'))
})

test('synthetic impact gold v1 keeps mean Recall@20 and Recall@5 above the declared regression floors', () => {
  const metrics = IMPACT_GOLD_V1.cases.map((fixture) => {
    const result = rankCodeContext(IMPACT_GOLD_V1.graphDocument, fixture.query, { budgetCharacters: 100_000 })
    const rankedPaths = result.entries.map((entry) => entry.path)
    const relevant = new Set(fixture.expectedPaths)
    const recallAt = (limit) => rankedPaths.slice(0, limit).filter((path) => relevant.has(path)).length / relevant.size
    return { id: fixture.id, recallAt5: recallAt(5), recallAt20: recallAt(20) }
  })
  const mean = (key) => metrics.reduce((sum, entry) => sum + entry[key], 0) / metrics.length

  assert.equal(IMPACT_GOLD_V1.fixtureKind, 'synthetic-gold')
  assert.ok(mean('recallAt20') >= 0.95, JSON.stringify(metrics))
  assert.ok(mean('recallAt5') >= 0.8, JSON.stringify(metrics))
})

test('SCC analysis stays iterative on a graph deeper than the JavaScript call stack', () => {
  const size = 12_000
  const document = graphDocument()
  document.graph.nodes = Array.from({ length: size }, (_, index) => ({
    id: 'n' + index,
    path: 'src/main/java/deep/N' + index + '.java',
    language: 'java',
    qualifiedName: 'deep.N' + index
  }))
  document.graph.edges = Array.from({ length: size - 1 }, (_, index) => ({
    from: 'n' + index,
    to: 'n' + (index + 1),
    kind: 'imports',
    provenance: 'static-import-resolved'
  }))

  const result = rankCodeContext(document, 'terms absent from graph', { budgetCharacters: 64 })

  assert.equal(result.impact.stronglyConnectedComponents, size)
  assert.equal(result.impact.cyclicComponents, 0)
})

test('loader accepts only a graph digest bound to the current sealed project run', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-code-context-bound-'))
  await writeGradleFixture(root)
  initializeGit(root)
  await initProject(root)
  const graphPath = join(root, '.backend-harness/generated/packs/codegraph-advisory/graph.json')
  await mkdir(join(root, '.backend-harness/generated/packs/codegraph-advisory'), { recursive: true })
  const graphText = JSON.stringify(graphDocument(), null, 2) + '\n'
  await writeFile(graphPath, graphText, 'utf8')
  const source = await captureConfiguredSourceBinding(root)
  await recordProjectRun(root, {
    confirmed: true,
    sourceBinding: source,
    result: {
      configuration: '.backend-harness/verification.json',
      reason: null,
      sourceStable: true,
      tests: { tests: 1, executed: 1, failures: 0, errors: 0, skipped: 0 },
      gates: [{
        id: 'codegraph', required: false, outcome: 'passed', evidenceTier: 'REPORTED',
        result: {
          type: 'observation', evidenceTier: 'REPORTED', reportFiles: ['.backend-harness/generated/packs/codegraph-advisory/graph.json'],
          reportDigests: [{
            path: '.backend-harness/generated/packs/codegraph-advisory/graph.json',
            sha256: createHash('sha256').update(graphText).digest('hex'),
            bytes: Buffer.byteLength(graphText)
          }]
        }
      }]
    }
  })

  const loaded = await loadBudgetedCodeContext(root, 'OrdersController', {
    budgetCharacters: 700,
    sourceFingerprint: source.fingerprint
  })
  assert.equal(loaded.status, 'available')
  assert.match(loaded.provenance.reportSha256, /^[a-f0-9]{64}$/)

  await writeFile(graphPath, graphText + ' ', 'utf8')
  const tampered = await loadBudgetedCodeContext(root, 'OrdersController', {
    budgetCharacters: 700,
    sourceFingerprint: source.fingerprint
  })
  assert.equal(tampered.status, 'unavailable')
  assert.equal(tampered.reason, 'graph_digest_mismatch')
})

test('on-demand context stays bounded, source-labelled, and non-persistent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-live-code-context-'))
  const fingerprint = 'c'.repeat(64)
  const result = await inspectBoundSourceCodeContext(root, 'OrdersController', {
    budgetCharacters: 700,
    sourceFingerprint: fingerprint,
    indexProjectGraph: async () => graphDocument()
  })

  assert.equal(result.status, 'available')
  assert.equal(result.entries[0].path, 'src/main/java/orders/OrdersController.java')
  assert.deepEqual(result.provenance, {
    mode: 'bounded-read-only-source-snapshot',
    graphGeneration: 'a'.repeat(64),
    sourceFingerprint: fingerprint,
    persisted: false
  })
})

test('on-demand context explains absent identity and bounded index failures without inventing paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-live-code-context-fail-'))
  const missingIdentity = await inspectBoundSourceCodeContext(root, 'orders', {
    budgetCharacters: 700,
    sourceFingerprint: 'not-a-fingerprint'
  })
  const failed = await inspectBoundSourceCodeContext(root, 'orders', {
    budgetCharacters: 700,
    sourceFingerprint: 'd'.repeat(64),
    indexProjectGraph: async () => { throw new Error('bounded fixture failure') }
  })
  const disabled = await inspectBoundSourceCodeContext(root, 'orders', {
    budgetCharacters: 0,
    sourceFingerprint: 'd'.repeat(64)
  })

  assert.equal(missingIdentity.reason, 'source_fingerprint_required')
  assert.equal(failed.reason, 'live_graph_failed')
  assert.match(failed.diagnostic, /bounded fixture failure/)
  assert.deepEqual(failed.entries, [])
  assert.equal(disabled.reason, 'disabled')
})
