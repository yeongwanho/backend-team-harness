import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { access, chmod, mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initProject } from '../src/init-project.mjs'
import { captureConfiguredSourceBinding } from '../src/runtime/backend-harness.mjs'
import { runImplementation } from '../src/runtime/implementation-orchestrator.mjs'
import { advanceTask, createTask, loadTask, updateTaskPlan } from '../src/core/task-store.mjs'
import { initializeGit, runGit, writeGradleFixture } from '../test-support/git-project.mjs'

async function approvedImplementationProject(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'bth-implementation-'))
  await writeGradleFixture(root)
  await initProject(root)
  await writeFile(join(root, '.backend-harness/implementation.json'), JSON.stringify({
    schemaVersion: 1,
    adapter: { id: 'fixture', command: ['./tools/implement'], network: false, timeoutMs: 30_000 },
    writePolicy: { allowedPrefixes: ['src/'], maxChangedFiles: 4, maxDiffBytes: 64 * 1024 },
    recovery: { maxAttempts: 2 }
  }, null, 2) + '\n', 'utf8')
  await writeFile(join(root, 'tools-implement.tmp'), options.adapterScript ?? '#!/bin/sh\nset -eu\nmkdir -p src/main/java/example\nprintf "package example; class Generated {}\\n" > src/main/java/example/Generated.java\n', 'utf8')
  await mkdir(join(root, 'tools'), { recursive: true })
  await rename(join(root, 'tools-implement.tmp'), join(root, 'tools/implement'))
  await chmod(join(root, 'tools/implement'), 0o755)
  initializeGit(root)
  runGit(root, ['add', '-f', '.gitignore', '.backend-harness/.gitignore'])
  runGit(root, ['commit', '-qm', 'track isolation ignore contracts'])
  await createTask(root, { id: 'IMPL-1', context: 'Add one generated fixture class.' })
  await advanceTask(root, 'IMPL-1', 'CONTEXT_READY', { actor: 'developer' })
  const source = await captureConfiguredSourceBinding(root)
  await updateTaskPlan(root, 'IMPL-1', 'Create src/main/java/example/Generated.java and preserve all verification Gates.', {
    actor: 'developer', sourceFingerprint: source.fingerprint
  })
  await advanceTask(root, 'IMPL-1', 'PLAN_PROPOSED', { actor: 'developer' })
  await advanceTask(root, 'IMPL-1', 'PLAN_APPROVED', {
    actor: 'reviewer', approved: true, currentSourceFingerprint: source.fingerprint
  })
  return root
}

test('approved implementation runs in a detached worktree, verifies changes, and leaves the original source untouched', async () => {
  const root = await approvedImplementationProject()

  const result = await runImplementation(root, 'IMPL-1', { actor: 'developer', allowWrite: true })

  assert.equal(result.record.status, 'passed', JSON.stringify(result.record, null, 2))
  assert.equal(result.record.originalWorktreeUnchanged, true)
  assert.equal(result.record.attempts.length, 1)
  assert.equal(result.record.attempts[0].outcome, 'passed')
  assert.equal(result.record.verification.tests.executed, 1)
  assert.ok(result.record.changedFiles.paths.includes('src/main/java/example/Generated.java'))
  await assert.rejects(access(join(root, 'src/main/java/example/Generated.java')), /ENOENT/)
  await access(join(root, result.record.workspace, 'src/main/java/example/Generated.java'))
  assert.equal((await loadTask(root, 'IMPL-1')).record.state, 'IMPLEMENTING')

  const cli = spawnSync(process.execPath, [join(import.meta.dirname, '../src/cli.mjs'), 'implement', 'status', 'IMPL-1', root, '--json'], {
    encoding: 'utf8'
  })
  assert.equal(cli.status, 0, cli.stderr)
  assert.equal(JSON.parse(cli.stdout).record.status, 'passed')
})

test('implementation refuses source writes without a fresh explicit write approval', async () => {
  const root = await approvedImplementationProject()
  await assert.rejects(runImplementation(root, 'IMPL-1', { actor: 'developer' }), /--allow-write/)
  const config = JSON.parse(await readFile(join(root, '.backend-harness/implementation.json'), 'utf8'))
  config.adapter.network = true
  await writeFile(join(root, '.backend-harness/implementation.json'), JSON.stringify(config, null, 2) + '\n', 'utf8')
  await assert.rejects(
    runImplementation(root, 'IMPL-1', { actor: 'developer', allowWrite: true }),
    /--allow-network/
  )
})

test('a failed verification feeds a bounded recovery attempt in the same isolated workspace', async () => {
  const root = await approvedImplementationProject({
    adapterScript: [
      '#!/bin/sh',
      'set -eu',
      'mkdir -p src/main/java/example',
      'printf "package example; class Generated {}\\n" > src/main/java/example/Generated.java',
      'if [ "$BTH_IMPLEMENTATION_ATTEMPT" = "1" ]; then',
      '  printf "#!/bin/sh\\nexit 1\\n" > gradlew',
      'else',
      '  git checkout HEAD -- gradlew',
      '  grep -q \'"recovery"\' "$BTH_IMPLEMENTATION_REQUEST"',
      'fi',
      ''
    ].join('\n')
  })

  const result = await runImplementation(root, 'IMPL-1', { actor: 'developer', allowWrite: true })

  assert.equal(result.record.status, 'passed', JSON.stringify(result.record, null, 2))
  assert.equal(result.record.attempts.length, 2)
  assert.equal(result.record.attempts[0].outcome, 'control-plane-change')
  assert.equal(result.record.attempts[0].verification.failure.code, 'protected_control_plane_changed')
  assert.equal(result.record.attempts[1].outcome, 'passed')
})

test('an adapter process failure becomes structured recovery input for the next bounded attempt', async () => {
  const root = await approvedImplementationProject({
    adapterScript: [
      '#!/bin/sh',
      'set -eu',
      'if [ "$BTH_IMPLEMENTATION_ATTEMPT" = "1" ]; then',
      '  exit 7',
      'fi',
      'grep -q implementation_adapter_failed "$BTH_IMPLEMENTATION_REQUEST"',
      'mkdir -p src/main/java/example',
      'printf "package example; class Generated {}\\n" > src/main/java/example/Generated.java',
      ''
    ].join('\n')
  })

  const result = await runImplementation(root, 'IMPL-1', { actor: 'developer', allowWrite: true })

  assert.equal(result.record.status, 'passed', JSON.stringify(result.record, null, 2))
  assert.equal(result.record.attempts.length, 2)
  assert.equal(result.record.attempts[0].outcome, 'adapter-failed')
  assert.equal(result.record.attempts[0].verification.failure.code, 'implementation_adapter_failed')
  assert.equal(result.record.attempts[1].outcome, 'passed')
})

test('implementation cannot escape the project-owned path and diff budget', async () => {
  const root = await approvedImplementationProject({
    adapterScript: '#!/bin/sh\nset -eu\nprintf "outside approved scope\\n" > README.generated.md\n'
  })

  const result = await runImplementation(root, 'IMPL-1', { actor: 'developer', allowWrite: true })

  assert.equal(result.record.status, 'failed')
  assert.equal(result.record.attempts.length, 2)
  assert.ok(result.record.attempts.every((attempt) => attempt.outcome === 'write-policy-violation'))
  assert.match(result.record.attempts[0].verification.failure.message, /outside allowed prefixes/)
  await assert.rejects(access(join(root, 'README.generated.md')), /ENOENT/)
})
