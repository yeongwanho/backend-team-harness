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
    }
  )
  assert.equal(available.status, 'confirmed')
  assert.equal(projectRuleReadiness(confirmedEvaluation), 'confirmed')
  assert.deepEqual(available.knowledgeDocuments.paths, ['AGENTS.md', '.backend-harness/architecture.md'])
  assert.deepEqual(available.adjacentCode.paths, [
    'src/main/java/users/UserController.java',
    'src/test/java/users/UserControllerTest.java'
  ])
  assert.equal(available.authority.verdictAuthority, false)

  const missingCode = buildProjectConventions(confirmedEvaluation, { complete: true, documents: [] }, {
    status: 'unavailable', reason: 'graph_missing', entries: []
  })
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
  }, null, { status: 'available', entries: [{ path: 'src/main/java/users/UserController.java' }] })

  assert.equal(conflicted.status, 'conflict')
  assert.equal(conflicted.projectRules.blocking, true)
  assert.equal(conflicted.projectRules.rules[0].status, 'conflict')
  assert.equal(conflicted.requiredBeforeEdit.stopOnUnknownOrConflictingBlockingRule, true)
})
