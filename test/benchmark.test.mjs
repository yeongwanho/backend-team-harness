import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

test('adaptive benchmark proves its scoped 2x claim and exact gate preservation', () => {
  const result = spawnSync(process.execPath, ['scripts/benchmark-adaptive-verification.mjs'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  const benchmark = JSON.parse(result.stdout)
  assert.ok(benchmark.speedup >= 2)
  assert.equal(benchmark.identityPreserved, true)
  assert.equal(benchmark.requiredGateCount, benchmark.adaptiveGateCount)
  assert.notDeepEqual(benchmark.configuredOrder, benchmark.adaptiveOrder)
})
