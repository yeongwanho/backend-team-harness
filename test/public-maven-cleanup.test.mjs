import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanupSpringContainers } from '../benchmarks/public-backend-v1/fixtures/spring/full-test-run.mjs'
const owner = '11111111-2222-4333-8444-555555555555', id = 'a'.repeat(64), image = 'sha256:' + 'b'.repeat(64)

test('Spring container cleanup checks owner, full ID and the exact cached image before removal', () => {
  for (const kind of ['owned', 'wrong-owner', 'wrong-image', 'wrong-id', 'invalid-list', 'list-failed', 'inspect-failed', 'remove-failed']) {
    const removed = []
    const docker = args => {
      if (args[0] === 'ps') {
        assert.deepEqual(args, ['ps', '-aq', '--no-trunc', '--filter', 'label=bth.spring.fixture=' + owner])
        return { status: kind === 'list-failed' ? 1 : 0, stdout: kind === 'invalid-list' ? 'short' : id }
      }
      if (args[0] === 'inspect') return { status: kind === 'inspect-failed' ? 1 : 0, stdout: JSON.stringify([{
        Id: kind === 'wrong-id' ? 'c'.repeat(64) : id,
        Image: kind === 'wrong-image' ? 'sha256:' + 'd'.repeat(64) : image,
        Config: { Labels: { 'bth.spring.fixture': kind === 'wrong-owner' ? 'foreign' : owner } }
      }]) }
      assert.deepEqual(args, ['rm', '--force', '--volumes', id]); removed.push(id)
      return { status: kind === 'remove-failed' ? 1 : 0, stdout: '' }
    }
    if (kind === 'owned') assert.equal(cleanupSpringContainers(owner, [image], docker), 1)
    else assert.throws(() => cleanupSpringContainers(owner, [image], docker), undefined, kind)
    assert.equal(removed.length, ['owned', 'remove-failed'].includes(kind) ? 1 : 0, kind)
  }
  assert.throws(() => cleanupSpringContainers('bad', [image], () => assert.fail('must not run')))
  assert.throws(() => cleanupSpringContainers(owner, ['mysql:latest'], () => assert.fail('must not run')))
})
