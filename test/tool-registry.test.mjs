import test from 'node:test'
import assert from 'node:assert/strict'
import { createToolRegistry } from '../src/core/tool-registry.mjs'
import { assertToolAllowed } from '../src/policy/tool-gate.mjs'

test('an unregistered tool is never executed', async () => {
  const registry = createToolRegistry()
  await assert.rejects(registry.execute('shell.anything', {}, {}), /Unregistered tool/)
})

test('permission gate denies before a write-capable tool executes', async () => {
  let executions = 0
  const registry = createToolRegistry({
    beforeExecute: assertToolAllowed,
    tools: [{
      id: 'source.write',
      allowedStates: ['IMPLEMENTING'],
      mutatesSource: true,
      async execute() {
        executions += 1
      }
    }]
  })

  await assert.rejects(
    registry.execute('source.write', {}, {
      task: { id: 'T-1', state: 'IMPLEMENTING' },
      approval: { write: false }
    }),
    (error) => error.code === 'write_approval_required'
  )
  assert.equal(executions, 0)
})

test('task state gate denies before a tool executes', async () => {
  let executions = 0
  const registry = createToolRegistry({
    beforeExecute: assertToolAllowed,
    tools: [{
      id: 'build.test',
      allowedStates: ['VERIFYING'],
      async execute() {
        executions += 1
      }
    }]
  })

  await assert.rejects(
    registry.execute('build.test', {}, {
      task: { id: 'T-2', state: 'IMPLEMENTING' },
      approval: {}
    }),
    (error) => error.code === 'execution_state_denied'
  )
  assert.equal(executions, 0)
})

test('an explicit local check operation can run without forging a task', async () => {
  let executions = 0
  const registry = createToolRegistry({
    beforeExecute: assertToolAllowed,
    tools: [{
      id: 'build.check',
      allowedStates: ['CHECKING'],
      async execute() {
        executions += 1
      }
    }]
  })

  await registry.execute('build.check', {}, {
    operation: { id: 'project-check', state: 'CHECKING' },
    approval: {}
  })

  assert.equal(executions, 1)
})
