import test from 'node:test'
import assert from 'node:assert/strict'
import { createValidationActivity } from '../src/providers/validation-activity.mjs'

test('validation completion requires every approved command and an explicit successful tool result', () => {
  const activity = createValidationActivity(['./tools/verify', './tools/lint'], '/fixture')
  assert.equal(activity.matches('cat ./tools/verify'), false)
  assert.equal(activity.matches("/bin/zsh -lc 'tools/verify'"), true)
  assert.equal(activity.matches('"/fixture/tools/verify"'), true)
  assert.equal(activity.matches('./tools/verify-extra'), false)
  assert.equal(activity.matches('/bin/bash -c "exec tools/verify"'), true)
  assert.equal(activity.matches('"/fixture/tools/verify" extra'), false)
  assert.equal(activity.matches("'tools/verify"), false)
  activity.observe({ type: 'item.started', item: { id: 'a', type: 'command_execution', command: 'tools/verify' } }, 'codex')
  assert.equal(activity.snapshot().complete, false)
  activity.observe({ type: 'item.completed', item: { id: 'a', type: 'command_execution', exit_code: 0 } }, 'codex')
  assert.equal(activity.snapshot().complete, false)
  activity.observe({ type: 'item.completed', item: { id: 'b', type: 'command_execution', command: './tools/lint', exit_code: 1 } }, 'codex')
  assert.equal(activity.snapshot().complete, false)
  const success = { type: 'item.completed', item: { id: 'c', type: 'command_execution', command: './tools/lint', exit_code: 0 } }
  activity.observe(success, 'codex'); activity.observe(success, 'codex')
  assert.equal(activity.snapshot().complete, true)
  assert.equal(activity.snapshot().commands[1].succeeded, 1)
  assert.equal(activity.snapshot().commands[1].failed, 1)
})

test('Claude prose, missing results and errors cannot establish validation completion', () => {
  const activity = createValidationActivity(['./tools/verify'], '/fixture')
  const start = id => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command: './tools/verify' } }] } })
  const result = (id, extra) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'Tests passed', ...extra }] } })
  activity.observe(start('unknown'), 'claude'); activity.observe(result('unknown', {}), 'claude')
  activity.observe(start('failed'), 'claude'); activity.observe(result('failed', { is_error: true }), 'claude')
  assert.equal(activity.snapshot().complete, false)
  activity.observe(start('passed'), 'claude'); activity.observe(result('passed', { is_error: false }), 'claude')
  assert.equal(activity.snapshot().complete, true)
  assert.equal(createValidationActivity([], '/fixture').snapshot().complete, false)
})

test('compound shell success and quoted command mentions do not prove validation ran successfully', () => {
  for (const command of [
    'true || ./tools/verify', './tools/verify || true', './tools/verify; true',
    'false && ./tools/verify; true', 'echo "done; ./tools/verify"',
    '/bin/zsh -lc \'true || ./tools/verify\'',
    'echo "$(./tools/verify)"', './tools/verify &', './tools/verify > result.txt',
    'cd /different && ./tools/verify', '# ./tools/verify',
    '/bin/zsh -lc \'./tools/verify > result.txt\'',
    'tools/verify\ntrue', 'tools/verify\\', 'tools/verify ""',
  ]) {
    const activity = createValidationActivity(['./tools/verify'], '/fixture')
    activity.observe({ type: 'item.completed', item: { id: 'compound', type: 'command_execution', command, exit_code: 0 } }, 'codex')
    assert.equal(activity.snapshot().complete, false, command)
  }
})

test('literal validation arguments must match exactly and excessively long events remain unknown', () => {
  const activity = createValidationActivity(['./tools/verify --local'], '/fixture')
  assert.equal(activity.matches('tools/verify "--local"'), true)
  assert.equal(activity.matches('tools/verify --other'), false)
  assert.equal(activity.matches('tools/verify --local ' + ' '.repeat(16384)), false)
})
