import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateProjectRules } from '../src/core/constraint-engine.mjs'

function fact(id, status, value) {
  return { id, status, value, summary: id, evidence: { source: 'fixture' } }
}

const source = { path: '.backend-harness/project-rules.json', section: 'fixture' }

test('project rules distinguish satisfied, violated, unknown, and not-applicable outcomes', () => {
  const facts = [
    fact('database.dialect', 'confirmed', 'mysql'),
    fact('verification.gates', 'confirmed', ['unit', 'db-integration']),
    fact('policy.owner', 'unknown', null),
    fact('feature.enabled', 'confirmed', false)
  ]
  const rules = [
    {
      id: 'mysql-required',
      description: 'The project uses MySQL.',
      severity: 'blocker',
      assert: { fact: 'database.dialect', operator: 'equals', value: 'mysql' },
      source
    },
    {
      id: 'contract-gate-required',
      description: 'Contract verification must exist.',
      severity: 'blocker',
      assert: { fact: 'verification.gates', operator: 'includes', value: 'contract' },
      source
    },
    {
      id: 'owner-required',
      description: 'A policy owner must be known.',
      severity: 'warning',
      assert: { fact: 'policy.owner', operator: 'present' },
      source
    },
    {
      id: 'conditional-contract',
      description: 'Enabled features require a contract Gate.',
      severity: 'blocker',
      when: { fact: 'feature.enabled', operator: 'equals', value: true },
      assert: { fact: 'verification.gates', operator: 'includes', value: 'contract' },
      source
    }
  ]

  const result = evaluateProjectRules(facts, rules)
  assert.equal(result.status, 'conflict')
  assert.equal(result.blocking, true)
  assert.deepEqual(
    result.results.map((entry) => [entry.id, entry.status, entry.outcome]),
    [
      ['mysql-required', 'confirmed', 'satisfied'],
      ['contract-gate-required', 'conflict', 'violated'],
      ['owner-required', 'unknown', 'insufficient-evidence'],
      ['conditional-contract', 'confirmed', 'not-applicable']
    ]
  )
  assert.deepEqual(result.results[1].factIds, ['verification.gates'])
})
test('composite conditions use conservative three-valued logic without inventing answers', () => {
  const facts = [
    fact('a', 'confirmed', true),
    fact('b', 'unknown', null),
    fact('c', 'confirmed', false)
  ]
  const rules = [
    {
      id: 'all-needs-b', description: 'all', severity: 'warning', source,
      assert: { all: [
        { fact: 'a', operator: 'equals', value: true },
        { fact: 'b', operator: 'equals', value: true }
      ] }
    },
    {
      id: 'any-is-known', description: 'any', severity: 'warning', source,
      assert: { any: [
        { fact: 'a', operator: 'equals', value: true },
        { fact: 'b', operator: 'equals', value: true }
      ] }
    },
    {
      id: 'not-c', description: 'not', severity: 'warning', source,
      assert: { not: { fact: 'c', operator: 'equals', value: true } }
    }
  ]
  const result = evaluateProjectRules(facts, rules)
  assert.deepEqual(
    result.results.map((entry) => [entry.id, entry.status]),
    [['all-needs-b', 'unknown'], ['any-is-known', 'confirmed'], ['not-c', 'confirmed']]
  )
})

test('conflicting input facts remain conflicts and duplicate facts fail closed', () => {
  const rule = {
    id: 'dialect', description: 'dialect', severity: 'blocker', source,
    assert: { fact: 'database.dialect', operator: 'equals', value: 'mysql' }
  }
  const conflicted = evaluateProjectRules([
    fact('database.dialect', 'conflict', ['mysql', 'postgresql'])
  ], [rule])
  assert.equal(conflicted.results[0].outcome, 'input-conflict')
  assert.equal(conflicted.blocking, true)

  assert.throws(
    () => evaluateProjectRules([fact('x', 'confirmed', true), fact('x', 'confirmed', false)], []),
    /duplicate fact id x/
  )
})
