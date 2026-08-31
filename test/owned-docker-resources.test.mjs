import test from 'node:test'
import assert from 'node:assert/strict'
import { ownedMysqlContainers, removeOwnedMysqlContainer } from '../test-support/owned-docker-resources.mjs'

const owner = '123e4567-e89b-42d3-a456-426614174000', id = 'a'.repeat(64)
const image = 'sha256:' + 'b'.repeat(64)
const inspected = (labels = { 'bth.mysql.fixture': owner }) => ({ status: 0, stdout: JSON.stringify([{ Id: id, Image: image, Config: { Labels: labels } }]), stderr: '' })

test('MySQL fixture discovery is limited to the unique owner label and full container IDs', () => {
  const calls = []
  const ids = ownedMysqlContainers(owner, args => { calls.push(args); return { status: 0, stdout: id + '\n' } })
  assert.deepEqual(ids, [id])
  assert.deepEqual(calls[0], ['ps', '-aq', '--no-trunc', '--filter', 'label=bth.mysql.fixture=' + owner])
  assert.throws(() => ownedMysqlContainers('shared', () => assert.fail('must not call Docker')), /owner/)
  assert.throws(() => ownedMysqlContainers(owner, () => ({ status: 0, stdout: 'not-an-id' })), /container ID/)
  assert.throws(() => ownedMysqlContainers(owner, () => ({ status: 1, stdout: '' })), /listing/)
})

test('forced cleanup checks exact container identity, owner and expected image before removal', () => {
  const calls = []
  removeOwnedMysqlContainer(id, owner, image, args => {
    calls.push(args)
    return args[0] === 'inspect' ? inspected() : { status: 0, stdout: id }
  })
  assert.deepEqual(calls, [['inspect', id], ['rm', '--force', '--volumes', id]])
  for (const result of [inspected({ 'bth.mysql.fixture': 'someone-else' }),
    { status: 0, stdout: JSON.stringify([{ Id: id, Image: 'sha256:' + 'c'.repeat(64), Config: { Labels: { 'bth.mysql.fixture': owner } } }]) },
    { status: 0, stdout: JSON.stringify([{ Id: 'd'.repeat(64), Image: image, Config: { Labels: { 'bth.mysql.fixture': owner } } }]) },
    { status: 0, stdout: 'invalid JSON' }, { status: 0, stdout: '[]' },
    { status: 1, stdout: '', stderr: 'not found or unavailable' }]) {
    const seen = []
    assert.throws(() => removeOwnedMysqlContainer(id, owner, image, args => { seen.push(args); return result }), /ownership|inspect/)
    assert.equal(seen.length, 1)
  }
  assert.throws(() => removeOwnedMysqlContainer('mysql', owner, image, () => assert.fail('must not call Docker')), /container ID/)
  assert.throws(() => removeOwnedMysqlContainer(id, owner, 'mysql:latest', () => assert.fail('must not call Docker')), /image ID/)
  assert.throws(() => removeOwnedMysqlContainer(id, owner, image, args => args[0] === 'inspect' ? inspected() : { status: 1 }), /removal/)
})
