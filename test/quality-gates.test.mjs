import test from 'node:test'
import assert from 'node:assert/strict'
import { parseQualityGate } from '../src/config/quality-gates.mjs'

test('quality-gate parser accepts the deliberately small schema', () => {
  const result = parseQualityGate([
    'name: test',
    'required: true',
    'checks:',
    '  - compile',
    '  - selected-tests',
    ''
  ].join('\n'), 'test.yaml')

  assert.deepEqual(result, {
    name: 'test',
    required: true,
    checks: ['compile', 'selected-tests']
  })
})

test('quality-gate parser rejects unknown and duplicate fields', () => {
  assert.throws(
    () => parseQualityGate('name: test\nrequired: true\ncommand: rm\nchecks:\n  - compile\n', 'test.yaml'),
    /unknown key command/
  )
  assert.throws(
    () => parseQualityGate('name: test\nname: again\nrequired: true\nchecks:\n  - compile\n', 'test.yaml'),
    /duplicate key name/
  )
})
