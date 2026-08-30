import test from 'node:test'
import assert from 'node:assert/strict'
import { selectTaskRetrievalQuery } from '../src/core/retrieval-query.mjs'
import { rankCodeContext } from '../src/core/code-context.mjs'

test('retrieval uses task context without mixing operational instructions or changing approved content', () => {
  const task = Object.freeze({
    id: 'MAP-1', title: 'Audit gates', context: 'Change InvoiceLookup.',
    plan: 'Keep Audit Clock Lock Journal Gate checks, then inspect the requested source.'
  })
  assert.equal(selectTaskRetrievalQuery(task), task.context)
  assert.equal(task.plan, 'Keep Audit Clock Lock Journal Gate checks, then inspect the requested source.')
})

test('manual tasks fall back to a useful title then plan, not a generated task id', () => {
  assert.equal(selectTaskRetrievalQuery({ context: ' \n ', title: ' Find Invoice ', plan: 'test steps' }), 'Find Invoice')
  assert.equal(selectTaskRetrievalQuery({ id: 'MAP-1', title: 'MAP-1', plan: ' Fix lookup ' }), 'Fix lookup')
  assert.equal(selectTaskRetrievalQuery({ plan: 'Plan-only manual task' }), 'Plan-only manual task')
})

test('the validated interview requirement takes precedence over the materialized task summary', () => {
  const task = { context: 'Requirement, acceptance, schema, gates and source summary.', plan: 'Full plan' }
  assert.equal(selectTaskRetrievalQuery(task, 'Change InvoiceLookup.'), 'Change InvoiceLookup.')
  assert.equal(selectTaskRetrievalQuery(task, 'x'.repeat(100_000)).length, 64 * 1024)
  assert.equal(selectTaskRetrievalQuery(task, null), task.context)
  assert.equal(selectTaskRetrievalQuery(task, { toString() { throw new Error('must not run') } }), task.context)
})

test('retrieval never stringifies arbitrary values and caps each possible source before processing it', () => {
  const untrusted = { toString() { throw new Error('not a text value') } }
  for (const input of [null, undefined, [], 42, 'not a task', untrusted, { context: untrusted, title: [], plan: {} }]) {
    assert.equal(selectTaskRetrievalQuery(input), '')
  }
  for (const field of ['context', 'title', 'plan']) {
    assert.equal(selectTaskRetrievalQuery({ [field]: 'x'.repeat(100_000) }).length, 64 * 1024)
  }
  assert.equal(selectTaskRetrievalQuery({ context: ' \n ', title: ' \t ', plan: ' \n ' }), '')
  assert.equal(selectTaskRetrievalQuery({ context: '  사용자 상태 조회 API를 수정한다.  ' }), '사용자 상태 조회 API를 수정한다.')
})

test('a semantic query keeps its entry point ahead of operational-name distractions within the same budget', () => {
  const task = {
    context: 'Change InvoiceLookup.',
    plan: 'Inspect Audit Clock Lock Journal Gate and preserve every approved verification step.'
  }
  const graph = {
    schemaVersion: 1,
    graph: {
      schemaVersion: 1, advisory: true, permittedUses: ['navigation'],
      forbiddenUses: ['pass-verdict', 'test-skipping'], edges: [],
      nodes: [
        { id: 'invoice', path: 'src/InvoiceLookup.java', language: 'java', qualifiedName: 'InvoiceLookup' },
        { id: 'audit', path: 'src/AuditClockLockJournalGate.java', language: 'java', qualifiedName: 'AuditClockLockJournalGate' }
      ]
    }
  }
  const control = rankCodeContext(graph, task.context + '\n' + task.plan, { budgetCharacters: 400 })
  const result = rankCodeContext(graph, selectTaskRetrievalQuery(task), { budgetCharacters: 400 })
  assert.equal(control.entries[0].path, 'src/AuditClockLockJournalGate.java')
  assert.equal(result.entries[0].path, 'src/InvoiceLookup.java')
  assert.ok(result.budget.usedCharacters <= 400)
  assert.equal(result.authority.advisory, true)
  assert.deepEqual(result.authority.forbiddenUses, ['pass-verdict', 'test-skipping'])
})
