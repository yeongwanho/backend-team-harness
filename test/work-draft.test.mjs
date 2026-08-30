import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveWorkDraft } from '../src/core/work-draft.mjs'

function context(files, gates = ['tests']) {
  return {
    sourceBinding: { fingerprint: 'a'.repeat(64) },
    verification: {
      status: 'configured',
      context: { databaseDialect: 'mysql' },
      gates: gates.map((id) => ({ id, required: true }))
    },
    intelligence: {
      evaluation: { blocking: false, status: 'confirmed', results: [] },
      code: { files }
    }
  }
}

test('a small compatible lookup receives a source-cited complete draft without fixed ceremony', () => {
  const result = deriveWorkDraft({
    requirement: 'Add a backward-compatible user status lookup API without a migration.',
    context: context([
      {
        path: 'users/src/main/java/example/users/UserStatusController.java',
        packageName: 'example.users',
        declarations: [{ name: 'UserStatusController' }],
        roles: ['controller'],
        routes: [{ method: 'GET', path: '/users/{id}/status' }]
      },
      {
        path: 'users/src/test/java/example/users/UserStatusControllerTest.java',
        packageName: 'example.users',
        declarations: [{ name: 'UserStatusControllerTest' }],
        roles: ['test'],
        routes: []
      },
      {
        path: 'billing/src/main/java/example/billing/InvoiceService.java',
        packageName: 'example.billing',
        declarations: [{ name: 'InvoiceService' }],
        roles: ['service'],
        routes: []
      }
    ])
  })

  assert.equal(result.status, 'ready-for-plan-review')
  assert.deepEqual(result.questions, [])
  assert.deepEqual(result.draft.modules, ['users'])
  assert.equal(result.draft.databaseImpact, 'read')
  assert.equal(result.draft.apiImpact, 'compatible')
  assert.deepEqual(result.draft.requiredGates, ['tests'])
  assert.ok(result.evidence.adjacentPaths.includes('users/src/main/java/example/users/UserStatusController.java'))
  assert.equal(result.authority.humanApprovalRequired, true)
  assert.equal(result.authority.inferenceCreatesVerdict, false)
})

test('an ambiguous request asks only unresolved decisions and preserves known gates', () => {
  const result = deriveWorkDraft({
    requirement: 'Improve account handling.',
    context: context([
      {
        path: 'users/src/main/java/example/users/UserService.java',
        packageName: 'example.users',
        declarations: [{ name: 'UserService' }],
        roles: ['service'],
        routes: []
      },
      {
        path: 'admin/src/main/java/example/admin/AdminService.java',
        packageName: 'example.admin',
        declarations: [{ name: 'AdminService' }],
        roles: ['service'],
        routes: []
      }
    ], ['tests', 'contract'])
  })

  assert.equal(result.status, 'needs-decisions')
  assert.deepEqual(result.questions.map((question) => question.id), [
    'scope.modules',
    'data.impact',
    'api.impact'
  ])
  assert.deepEqual(result.draft.requiredGates, ['contract', 'tests'])
  assert.equal(result.draft.modules, null)
  assert.equal(result.draft.databaseImpact, null)
  assert.equal(result.draft.apiImpact, null)
})

test('explicit bounded decisions complete only the missing fields', () => {
  const result = deriveWorkDraft({
    requirement: 'Improve account handling.',
    context: context([]),
    decisions: {
      modules: ['accounts'],
      databaseImpact: 'write',
      apiImpact: 'none',
      excludedModules: ['billing']
    }
  })

  assert.equal(result.status, 'ready-for-plan-review')
  assert.deepEqual(result.questions, [])
  assert.deepEqual(result.draft.modules, ['accounts'])
  assert.deepEqual(result.draft.excludedModules, ['billing'])
  assert.equal(result.draft.databaseImpact, 'write')
  assert.equal(result.draft.requiresMigration, false)
  assert.equal(result.draft.changesPublicApi, false)
  assert.equal(result.draft.preservesCompatibility, true)
})

test('blocking project rules stop draft completion even when task decisions are explicit', () => {
  const blocked = context([])
  blocked.intelligence.evaluation = {
    blocking: true,
    status: 'conflict',
    results: [{ id: 'api-policy', severity: 'blocker', status: 'conflict', outcome: 'violated' }]
  }
  const result = deriveWorkDraft({
    requirement: 'Internal cleanup.',
    context: blocked,
    decisions: { modules: ['core'], databaseImpact: 'none', apiImpact: 'none' }
  })

  assert.equal(result.status, 'blocked')
  assert.deepEqual(result.blockers.map((blocker) => blocker.id), ['api-policy'])
  assert.deepEqual(result.questions, [])
})
