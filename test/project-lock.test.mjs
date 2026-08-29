import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile, mkdtemp, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initProject } from '../src/init-project.mjs'
import { acquireProjectVerificationLock } from '../src/core/project-lock.mjs'

test('only one verification can own a project build directory at a time', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-project-lock-'))
  await initProject(root, { allowUnversioned: true })
  const release = await acquireProjectVerificationLock(root)

  await assert.rejects(
    acquireProjectVerificationLock(root, { timeoutMs: 40, retryMs: 5 }),
    (error) => error.code === 'project_verification_locked'
  )

  await release()
  const releaseAgain = await acquireProjectVerificationLock(root, { timeoutMs: 40 })
  await releaseAgain()
})

test('concurrent stale-lock recovery creates exactly one new owner', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-project-stale-lock-'))
  await initProject(root, { allowUnversioned: true })
  const lockPath = join(root, '.backend-harness/local/locks/project-verification.lock')
  await mkdir(join(root, '.backend-harness/local/locks'), { recursive: true })
  await writeFile(lockPath, JSON.stringify({
    schemaVersion: 1,
    pid: 2_147_483_647,
    nonce: 'dead-owner',
    acquiredAt: '2000-01-01T00:00:00.000Z'
  }) + '\n', 'utf8')

  const contenders = await Promise.allSettled([
    acquireProjectVerificationLock(root, { timeoutMs: 50, staleMs: 1, retryMs: 2 }),
    acquireProjectVerificationLock(root, { timeoutMs: 50, staleMs: 1, retryMs: 2 })
  ])
  const owners = contenders.filter((entry) => entry.status === 'fulfilled')
  const rejected = contenders.filter((entry) => entry.status === 'rejected')

  assert.equal(owners.length, 1)
  assert.equal(rejected.length, 1)
  assert.equal(rejected[0].reason.code, 'project_verification_locked')
  await owners[0].value()
})

test('dead lock and dead recovery-guard owners are reclaimed without waiting for age expiry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-project-orphan-guard-'))
  await initProject(root, { allowUnversioned: true })
  const lockPath = join(root, '.backend-harness/local/locks/project-verification.lock')
  await mkdir(join(root, '.backend-harness/local/locks'), { recursive: true })
  const deadOwner = {
    schemaVersion: 1,
    pid: 2_147_483_647,
    nonce: 'dead-owner',
    acquiredAt: new Date().toISOString()
  }
  await writeFile(lockPath, JSON.stringify(deadOwner) + '\n', 'utf8')
  await writeFile(lockPath + '.recovering', JSON.stringify({ ...deadOwner, nonce: 'dead-recovery' }) + '\n', 'utf8')

  const release = await acquireProjectVerificationLock(root, {
    timeoutMs: 100,
    staleMs: 60 * 60 * 1000,
    retryMs: 2
  })

  await release()
})

test('a malformed crash remnant is recoverable after the bounded grace period', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-project-malformed-lock-'))
  await initProject(root, { allowUnversioned: true })
  const lockPath = join(root, '.backend-harness/local/locks/project-verification.lock')
  await mkdir(join(root, '.backend-harness/local/locks'), { recursive: true })
  await writeFile(lockPath, '{interrupted', 'utf8')
  const old = new Date(Date.now() - 10_000)
  await utimes(lockPath, old, old)

  const release = await acquireProjectVerificationLock(root, {
    timeoutMs: 100,
    staleMs: 60 * 60 * 1000,
    retryMs: 2
  })

  await release()
})
