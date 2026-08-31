import test from 'node:test'
import assert from 'node:assert/strict'
import { selectProviderContext } from '../src/core/provider-context.mjs'

function fixture() {
  const examples = Array.from({ length: 8 }, (_, index) => ({
    path: 'src/Service' + index + '.java',
    contentSha256: String(index).repeat(64),
    declarations: ['Service' + index]
  }))
  const group = { status: 'observed', roles: ['service'], examples }
  const codeContext = {
    status: 'available',
    authority: { advisory: true, forbiddenUses: ['pass-verdict', 'test-skipping'] },
    graph: { nodes: 100 }, algorithm: { iterations: 30 }, query: { matchedTokens: ['service'] },
    entries: [{ path: 'src/Service7.java' }, { path: 'src/Service6.java' }],
    budget: { limitCharacters: 6000, usedCharacters: 500 },
    provenance: { sourceFingerprint: 'a'.repeat(64) },
    impact: {
      authority: 'advisory-structural-localization',
      seedPaths: examples.map((example) => example.path),
      dependencies: { count: 10, paths: examples.map((example) => example.path), omitted: 2 },
      dependents: { count: 0, paths: [], omitted: 0 }
    }
  }
  const projectConventions = {
    status: 'unknown',
    projectRules: { rules: [{ id: 'security', severity: 'blocker', status: 'unknown', source: { path: 'AGENTS.md' } }] },
    knowledgeDocuments: { paths: ['AGENTS.md'] },
    authority: { verdictAuthority: false },
    requiredBeforeEdit: { stopOnUnknownOrConflictingBlockingRule: true },
    discovered: {
      layers: [{ role: 'service', count: 8, naming: [{ suffix: 'Service' }], ...group }],
      transactions: group, persistence: group, database: { ...group, authority: { queryPlanExecuted: false } },
      contracts: { routes: group, tables: group },
      tests: {
        count: 10, omittedPairCount: 2,
        pairs: examples.map((example, index) => ({ production: example.path, test: 'test/Service' + index + 'Test.java' }))
      }
    }
  }
  return { codeContext, projectConventions }
}

test('provider projection keeps every declared rule and ranked entry while selecting relevant examples', () => {
  const input = fixture()
  const before = structuredClone(input)
  const projected = selectProviderContext(input.codeContext, input.projectConventions, 'balanced')
  assert.deepEqual(projected.projectConventions.projectRules, input.projectConventions.projectRules)
  assert.deepEqual(projected.projectConventions.authority, input.projectConventions.authority)
  assert.deepEqual(projected.projectConventions.requiredBeforeEdit, input.projectConventions.requiredBeforeEdit)
  assert.deepEqual(projected.codeContext.entries, input.codeContext.entries)
  assert.deepEqual(projected.codeContext.provenance, input.codeContext.provenance)
  assert.deepEqual(projected.projectConventions.discovered.layers[0].examples.map((entry) => entry.path), ['src/Service7.java', 'src/Service6.java'])
  assert.equal(projected.projectConventions.discovered.tests.pairs[0].production, 'src/Service7.java')
  assert.equal(projected.projectConventions.discovered.tests.omittedPairCount, 6)
  assert.equal(projected.codeContext.impact.dependencies.omitted, 6)
  assert.equal(projected.codeContext.algorithm, undefined)
  assert.ok(JSON.stringify(projected).length < JSON.stringify(input).length * 0.65)
  assert.deepEqual(input, before)
})

test('provider example budgets expand with mode without weakening authority or inventing observations', () => {
  const input = fixture()
  for (const [mode, examples, pairs] of [['fast', 1, 2], ['balanced', 2, 4], ['deep', 4, 8]]) {
    const projected = selectProviderContext(input.codeContext, input.projectConventions, mode)
    assert.equal(projected.projectConventions.discovered.layers[0].examples.length, examples)
    assert.equal(projected.projectConventions.discovered.tests.pairs.length, pairs)
    assert.equal(projected.projectConventions.discovered.database.authority.queryPlanExecuted, false)
    assert.equal(projected.projectConventions.providerProjection.declaredRulesPreserved, true)
  }
  const unavailable = { status: 'unavailable', reason: 'graph_missing', entries: [], authority: { advisory: true } }
  assert.deepEqual(selectProviderContext(unavailable, null, 'fast'), { codeContext: unavailable, projectConventions: null })
  assert.throws(() => selectProviderContext(null, null, 'unknown'), /Unknown provider context mode/)
})

test('package neighborhoods are bounded by mode and selected by ranked code while full rules and layer observations survive', () => {
  const input = fixture()
  input.codeContext.entries = [{ path: 'src/main/java/example/files/FileService.java' }, { path: 'src/main/java/example/users/UserService.java' }]
  input.projectConventions.discovered.layers[0].packages = ['example.unrelated', 'example.other', 'example.third', 'example.users', 'example.files']
  const before = structuredClone(input)
  const fast = selectProviderContext(input.codeContext, input.projectConventions, 'fast')
  const layer = fast.projectConventions.discovered.layers[0]
  assert.deepEqual(layer.packages, ['example.files', 'example.users'])
  assert.equal(layer.omittedProviderPackageCount, 3)
  assert.equal(fast.projectConventions.providerProjection.omittedPackages, 3)
  assert.equal(layer.count, input.projectConventions.discovered.layers[0].count)
  assert.deepEqual(layer.naming, input.projectConventions.discovered.layers[0].naming)
  assert.deepEqual(fast.projectConventions.projectRules, input.projectConventions.projectRules)
  assert.deepEqual(input, before)
  assert.equal(selectProviderContext(input.codeContext, input.projectConventions, 'deep').projectConventions.discovered.layers[0].packages.length, 5)
})

test('provider navigation has mode-bounded entries without dropping declared rules or hiding omissions', () => {
  const input = fixture()
  input.codeContext.entries = Array.from({ length: 47 }, (_, index) => ({ path: `src/Service${index}.java`, costCharacters: 100 }))
  input.codeContext.budget = { limitCharacters: 12000, usedCharacters: 4700, omittedNodes: 3 }
  input.projectConventions.adjacentCode = {
    status: 'confirmed', source: 'source-bound-codegraph',
    paths: input.codeContext.entries.slice(0, 32).map(entry => entry.path), omittedPathCount: 15
  }
  input.projectConventions.discovered.database.reviewCandidates = { locking: 17, nPlusOne: 21, indexCoverageUnknown: true }
  const before = structuredClone(input)
  for (const [mode, limit] of [['fast', 8], ['balanced', 16], ['deep', 24]]) {
    const projected = selectProviderContext(input.codeContext, input.projectConventions, mode)
    assert.deepEqual(projected.codeContext.entries, input.codeContext.entries.slice(0, limit))
    assert.equal(projected.codeContext.budget.usedCharacters, limit * 100)
    assert.equal(projected.codeContext.budget.omittedNodes, 50 - limit)
    assert.equal(projected.codeContext.providerProjection.omittedEntries, 47 - limit)
    assert.deepEqual(projected.projectConventions.adjacentCode.paths, input.projectConventions.adjacentCode.paths.slice(0, limit))
    assert.equal(projected.projectConventions.adjacentCode.omittedPathCount, 47 - limit)
    for (const key of ['projectRules', 'knowledgeDocuments', 'authority', 'requiredBeforeEdit']) {
      assert.deepEqual(projected.projectConventions[key], input.projectConventions[key], key)
    }
    assert.deepEqual(projected.projectConventions.discovered.database.reviewCandidates, input.projectConventions.discovered.database.reviewCandidates)
    assert.deepEqual(projected.codeContext.authority, input.codeContext.authority)
    assert.deepEqual(projected.codeContext.provenance, input.codeContext.provenance)
    assert.equal(projected.projectConventions.discovered.tests.count, 10)
  }
  assert.deepEqual(input, before)
})
