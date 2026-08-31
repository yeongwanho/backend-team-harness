import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, symlink, truncate, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { assertFormattingContract, runWorkspaceFormatting } from '../src/core/workspace-formatting.mjs'

const formatting = { command: ['./mvnw', '-o', 'format'], inputs: ['pom.xml'], network: false, timeoutMs: 1000 }
const verification = { gates: [{ command: ['./mvnw'], inputs: ['pom.xml'] }] }
const successful = { exitCode: 0, signal: null, timedOut: false, stdioDrainTimedOut: false, durationMs: 1,
  stdout: { sha256: 'a'.repeat(64), bytes: 8, tail: 'private' }, stderr: { sha256: 'b'.repeat(64), bytes: 0, tail: '' } }
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'bth-formatting-unit-'))
  for (const path of ['mvnw', 'mvnw.cmd', 'pom.xml', 'source.java']) await writeFile(join(root, path), 'fixture\n')
  for (const path of ['mvnw', 'mvnw.cmd']) await chmod(join(root, path), 0o755)
  return root
}

test('format contract binds platform-specific wrapper and rejects unbound inputs or undeclared network', async () => {
  const root = await fixture()
  await assertFormattingContract(root, formatting, verification)
  await assertFormattingContract(root, formatting, verification, { platform: 'win32' })
  await assertFormattingContract(root, { ...formatting, network: true }, verification, { allowNetwork: true })
  await assert.rejects(assertFormattingContract(root, { ...formatting, network: true }, verification), { code: 'formatting_network_not_acknowledged' })
  await assert.rejects(assertFormattingContract(root, { ...formatting, inputs: ['undeclared'] }, verification), { code: 'formatting_input_not_bound' })
  await assert.rejects(assertFormattingContract(root, { ...formatting, command: ['./other'] }, verification), { code: 'formatting_input_not_bound' })
})

test('formatter wrapper must not be a symlink even when declared', async () => {
  const root = await fixture()
  await symlink(join(root, 'mvnw'), join(root, 'linked'))
  await assert.rejects(assertFormattingContract(root, { ...formatting, command: ['./linked'] }, { gates: [{ command: ['./linked'], inputs: ['pom.xml'] }] }), /symbolic link/)
})

test('formatter execution makes a private recoverable snapshot and passes argv without shell or raw logs', async () => {
  const root = await fixture()
  const result = await runWorkspaceFormatting(root, root, formatting, ['source.java'], { runner: async input => {
    assert.equal(input.program, join(root, 'mvnw'))
    assert.deepEqual(input.args, ['-o', 'format'])
    assert.equal(input.cwd, root)
    await writeFile(join(root, 'source.java'), 'formatted\n')
    return successful
  } })
  assert.equal(result.status, 'passed')
  assert.deepEqual(result.changedPaths, ['source.java'])
  assert.equal(await readFile(join(root, result.backup, 'source.java'), 'utf8'), 'fixture\n')
  assert.equal(result.egressIsolation, 'not-enforced')
  assert.doesNotMatch(JSON.stringify(result), /private|tail/)
})

test('oversized recovery backup and linked backup directory refuse before formatter invocation', async () => {
  const root = await fixture()
  for (const path of ['large-a', 'large-b']) { await writeFile(join(root, path), ''); await truncate(join(root, path), 17 * 1024 * 1024) }
  let calls = 0
  const runner = async () => { calls++; return successful }
  const large = await runWorkspaceFormatting(root, root, formatting, ['large-a', 'large-b'], { runner })
  assert.equal(large.status, 'failed')
  assert.equal(large.failureCode, 'formatting_backup_limit')
  assert.equal(calls, 0)
  await mkdir(join(root, '.backend-harness/local'), { recursive: true })
  await symlink(root, join(root, '.backend-harness/local/formatting'))
  const linked = await runWorkspaceFormatting(root, root, formatting, ['source.java'], { runner })
  assert.equal(linked.status, 'failed')
  assert.equal(calls, 0)
})

test('formatter process failure, launch error, deletion and symlink mutation never report success', async () => {
  for (const mode of ['failure', 'launch', 'symlink']) {
    const root = await fixture()
    const result = await runWorkspaceFormatting(root, root, formatting, ['missing.java'], { runner: async () => {
      if (mode === 'launch') throw new Error('private-launch-error')
      if (mode === 'symlink') await symlink(join(root, 'source.java'), join(root, 'missing.java'))
      return mode === 'failure' ? { ...successful, exitCode: 9 } : successful
    } })
    assert.equal(result.status, 'failed')
    assert.doesNotMatch(JSON.stringify(result), /private/)
    if (mode === 'symlink') assert.equal(result.integrityFailure, true)
  }
})
