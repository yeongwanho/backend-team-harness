import test from 'node:test'
import assert from 'node:assert/strict'
import { buildProjectConventions, projectRuleReadiness } from '../src/core/project-conventions.mjs'

const confirmedEvaluation = {
  schemaVersion: 1,
  status: 'confirmed',
  blocking: false,
  counts: { confirmed: 1, unknown: 0, conflict: 0 },
  results: [{
    id: 'service-boundary',
    description: 'Controllers delegate to services.',
    severity: 'warning',
    status: 'confirmed',
    outcome: 'satisfied',
    source: { path: '.backend-harness/policies/architecture.md', section: 'Service boundary' }
  }]
}

const observedConventions = {
  status: 'observed',
  modules: ['root'],
  layers: [{
    role: 'controller', count: 2, packages: ['users'],
    naming: [{ suffix: 'Controller', occurrences: 2, status: 'repeated' }],
    examples: [{ path: 'src/main/java/users/UserController.java', contentSha256: 'a'.repeat(64), declarations: ['UserController'] }]
  }],
  transactions: { status: 'not-observed', roles: [], examples: [] },
  persistence: { status: 'not-observed', roles: [], examples: [] },
  tests: { status: 'observed', pairs: [] },
  limitations: []
}

test('project conventions require confirmed rules and adjacent source-bound code for fast readiness', () => {
  const available = buildProjectConventions(
    confirmedEvaluation,
    { complete: true, documents: [{ path: 'AGENTS.md' }, { path: '.backend-harness/architecture.md' }] },
    {
      status: 'available',
      entries: [
        { path: 'src/main/java/users/UserController.java' },
        { path: 'src/test/java/users/UserControllerTest.java' }
      ]
    },
    observedConventions
  )
  assert.equal(available.status, 'confirmed')
  assert.equal(projectRuleReadiness(confirmedEvaluation), 'confirmed')
  assert.deepEqual(available.knowledgeDocuments.paths, ['AGENTS.md', '.backend-harness/architecture.md'])
  assert.deepEqual(available.adjacentCode.paths, [
    'src/main/java/users/UserController.java',
    'src/test/java/users/UserControllerTest.java'
  ])
  assert.equal(available.authority.verdictAuthority, false)
  assert.equal(available.discovered.layers[0].naming[0].status, 'repeated')

  const missingCode = buildProjectConventions(confirmedEvaluation, { complete: true, documents: [] }, {
    status: 'unavailable', reason: 'graph_missing', entries: []
  }, observedConventions)
  assert.equal(missingCode.status, 'unknown')
  assert.equal(missingCode.adjacentCode.source, 'provider-bounded-discovery-required')
})

test('project convention conflicts stay explicit and bounded', () => {
  const conflicted = buildProjectConventions({
    ...confirmedEvaluation,
    status: 'conflict',
    blocking: true,
    counts: { confirmed: 0, unknown: 0, conflict: 1 },
    results: [{ ...confirmedEvaluation.results[0], severity: 'blocker', status: 'conflict', outcome: 'violated' }]
  }, null, { status: 'available', entries: [{ path: 'src/main/java/users/UserController.java' }] }, observedConventions)

  assert.equal(conflicted.status, 'conflict')
  assert.equal(conflicted.projectRules.blocking, true)
  assert.equal(conflicted.projectRules.rules[0].status, 'conflict')
  assert.equal(conflicted.requiredBeforeEdit.stopOnUnknownOrConflictingBlockingRule, true)
})

test('uncertain test pairs remain visible in the provider-facing contract', () => {
  const projected = buildProjectConventions(confirmedEvaluation, null, null, {
    ...observedConventions,
    tests: { status: 'observed', count: 5, pairs: [], ambiguousTestFileCount: 2, unmatchedTestFileCount: 3, candidateLimitExceededTestFileCount: 1 }
  })
  assert.equal(projected.discovered.tests.ambiguousTestFileCount, 2)
  assert.equal(projected.discovered.tests.unmatchedTestFileCount, 3)
  assert.equal(projected.discovered.tests.candidateLimitExceededTestFileCount, 1)
})
