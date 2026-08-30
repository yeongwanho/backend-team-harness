import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { access, chmod, copyFile, mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { initProject } from '../src/init-project.mjs'
import { installPack } from '../src/packs/install.mjs'
import { captureConfiguredSourceBinding, checkProject, verifyTask } from '../src/runtime/backend-harness.mjs'
import { cleanupImplementation, implementationStatus, resetImplementation, runImplementation } from '../src/runtime/implementation-orchestrator.mjs'
import { answerInterview, completeInterview, startInterview } from '../src/runtime/interview-orchestrator.mjs'
import { advanceTask, createTask, loadTask, updateTaskPlan } from '../src/core/task-store.mjs'
import { initializeGit, writeGradleFixture } from '../test-support/git-project.mjs'

async function approvedImplementationProject(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'bth-implementation-'))
  await writeGradleFixture(root)
  if (options.verificationFailsOnBrokenSource) {
    await writeFile(join(root, 'gradlew'), [
      '#!/bin/sh',
      'set -eu',
      'if grep -q BROKEN src/main/java/example/Generated.java; then exit 7; fi',
      'mkdir -p build/test-results/test',
      'printf "%s\\n" \'<testsuite tests="1"><testcase classname="example.VerificationTest" name="works"/></testsuite>\' > build/test-results/test/TEST-fixture.xml',
      ''
    ].join('\n'), 'utf8')
    await chmod(join(root, 'gradlew'), 0o755)
  }
  if (options.verificationMutatesCandidate) {
    await writeFile(join(root, 'gradlew'), [
      '#!/bin/sh',
      'set -eu',
      'printf "// gate mutation\\n" >> src/main/java/example/Generated.java',
      'mkdir -p build/test-results/test',
      'printf "%s\\n" \'<testsuite tests="1"><testcase classname="example.VerificationTest" name="works"/></testsuite>\' > build/test-results/test/TEST-fixture.xml',
      ''
    ].join('\n'), 'utf8')
    await chmod(join(root, 'gradlew'), 0o755)
  }
  if (options.verificationAddsCandidate) {
    await writeFile(join(root, 'gradlew'), [
      '#!/bin/sh',
      'set -eu',
      'printf "package example; class GateAdded {}\\n" > src/main/java/example/GateAdded.java',
      'mkdir -p build/test-results/test',
      'printf "%s\\n" \'<testsuite tests="1"><testcase classname="example.VerificationTest" name="works"/></testsuite>\' > build/test-results/test/TEST-fixture.xml',
      ''
    ].join('\n'), 'utf8')
    await chmod(join(root, 'gradlew'), 0o755)
  }
  if (options.ignoredDeclaredInput) {
    await writeFile(join(root, 'gradle.properties'), 'fixture.mode=original\n', 'utf8')
    await writeFile(join(root, '.gitignore'), (await readFile(join(root, '.gitignore'), 'utf8')) + 'gradle.properties\n', 'utf8')
  }
  if (options.trackedLargeSourceBytes) {
    const directory = join(root, 'src/main/java/example')
    await mkdir(directory, { recursive: true })
    await writeFile(
      join(directory, 'Large.java'),
      'package example; class Large {}\n/*' + 'x'.repeat(options.trackedLargeSourceBytes) + '*/\n',
      'utf8'
    )
  }
  await initProject(root)
  await writeFile(join(root, '.backend-harness/implementation.json'), JSON.stringify(options.providerConfig ?? {
      schemaVersion: 1,
      adapter: { id: 'fixture', command: options.adapterCommand ?? ['./tools/implement'], network: false, timeoutMs: 30_000 },
      writePolicy: { allowedPrefixes: ['src/'], maxChangedFiles: 4, maxDiffBytes: 64 * 1024 },
      recovery: { maxAttempts: 2 }
    }, null, 2) + '\n', 'utf8')
  await writeFile(join(root, 'tools-implement.tmp'), options.adapterScript ?? '#!/bin/sh\nset -eu\nmkdir -p src/main/java/example\nprintf "package example; class Generated {}\\n" > src/main/java/example/Generated.java\n', 'utf8')
  await mkdir(join(root, 'tools'), { recursive: true })
  await rename(join(root, 'tools-implement.tmp'), join(root, 'tools/implement'))
  await chmod(join(root, 'tools/implement'), 0o755)
  initializeGit(root, { forcePaths: ['.gitignore', '.backend-harness/.gitignore'] })
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

async function approvedRuleAwareFastProject() {
  const root = await mkdtemp(join(tmpdir(), 'bth-rule-aware-fast-'))
  await writeGradleFixture(root)
  await mkdir(join(root, 'src/main/java/orders'), { recursive: true })
  await mkdir(join(root, 'src/test/java/orders'), { recursive: true })
  await writeFile(join(root, 'src/main/java/orders/OrdersController.java'), [
    'package orders;',
    'class OrdersController { private final OrdersService service = new OrdersService(); }',
    ''
  ].join('\n'), 'utf8')
  await writeFile(join(root, 'src/main/java/orders/OrdersService.java'), 'package orders; class OrdersService {}\n', 'utf8')
  await writeFile(join(root, 'src/test/java/orders/OrdersControllerTest.java'), 'package orders; class OrdersControllerTest {}\n', 'utf8')
  initializeGit(root)
  await initProject(root)
  await installPack(root, 'codegraph-advisory')
  await writeFile(join(root, '.backend-harness/implementation.json'), JSON.stringify({
    schemaVersion: 2,
    adapter: {
      kind: 'provider', provider: 'codex', network: true, timeoutMs: 30_000,
      model: null, mode: 'auto', contextBudgetCharacters: null, maxBudgetUsd: null
    },
    writePolicy: { allowedPrefixes: ['src/'], maxChangedFiles: 4, maxDiffBytes: 64 * 1024 },
    recovery: { maxAttempts: 2 }
  }, null, 2) + '\n', 'utf8')
  initializeGit(root, { forcePaths: ['.gitignore', '.backend-harness/.gitignore'] })
  const checked = await checkProject(root)
  assert.equal(checked.confirmed, true, JSON.stringify(checked, null, 2))

  await startInterview(root, {
    taskId: 'FAST-1', title: 'Add compatible order lookup',
    requirement: 'Add one compatible order lookup behavior.', actor: 'developer'
  })
  for (const answer of [
    { questionId: 'acceptance', text: 'Existing id returns the existing response and missing id returns 404.' },
    { questionId: 'scope', text: 'Only the orders module and its tests may change.', claims: { changesPublicApi: false, modules: ['orders'] } },
    { questionId: 'data', text: 'No schema or stored-data change.', claims: { changesDatabase: false, requiresMigration: false } },
    { questionId: 'verification', text: 'Run every required project Gate.', claims: { requiredGates: ['tests'] } },
    { questionId: 'constraints', text: 'Preserve all existing contracts.', claims: { preservesCompatibility: true } }
  ]) {
    await answerInterview(root, 'FAST-1', { ...answer, actor: 'developer' })
  }
  await completeInterview(root, 'FAST-1', { actor: 'developer' })
  const source = await captureConfiguredSourceBinding(root)
  const task = await loadTask(root, 'FAST-1')
  await advanceTask(root, 'FAST-1', 'PLAN_APPROVED', {
    actor: 'reviewer', approved: true, currentSourceFingerprint: source.fingerprint,
    currentPlanArtifactSha256: task.record.planArtifactSha256
  })
  return root
}

test('approved implementation runs in a detached worktree, verifies changes, and leaves the original source untouched', async () => {
  const root = await approvedImplementationProject()

  const result = await runImplementation(root, 'IMPL-1', { actor: 'developer', allowWrite: true })

  assert.equal(result.record.status, 'passed', JSON.stringify(result.record, null, 2))
  assert.equal(result.record.originalBoundSourceUnchanged, true)
  assert.equal(result.record.isolation.worktreeOutsideProject, true)
  assert.equal(isAbsolute(result.record.workspace), true)
  assert.equal(relative(root, result.record.workspace).startsWith('..'), true)
  assert.equal(result.record.attempts.length, 1)
  assert.equal(result.record.attempts[0].outcome, 'passed')
  assert.equal(result.record.verification.tests.executed, 1)
  assert.ok(result.record.changedFiles.paths.includes('src/main/java/example/Generated.java'))
  assert.deepEqual(result.record.implementedFiles.map((entry) => entry.path), ['src/main/java/example/Generated.java'])
  const legacyRequest = JSON.parse(await readFile(join(result.record.workspace, '.backend-harness/local/implementation/request-IMPL-1.json'), 'utf8'))
  assert.equal(legacyRequest.schemaVersion, 1)
  assert.equal(Object.hasOwn(legacyRequest, 'implementation'), false)
  await assert.rejects(access(join(root, 'src/main/java/example/Generated.java')), /ENOENT/)
  await access(join(result.record.workspace, 'src/main/java/example/Generated.java'))
  assert.equal((await loadTask(root, 'IMPL-1')).record.state, 'IMPLEMENTING')

  const cli = spawnSync(process.execPath, [join(import.meta.dirname, '../src/cli.mjs'), 'implement', 'status', 'IMPL-1', root, '--json'], {
    encoding: 'utf8'
  })
  assert.equal(cli.status, 0, cli.stderr)
  assert.equal(JSON.parse(cli.stdout).record.status, 'passed')

  const humanCli = spawnSync(process.execPath, [join(import.meta.dirname, '../src/cli.mjs'), 'implement', 'run', 'IMPL-1', root, '--by', 'developer', '--allow-write'], {
    encoding: 'utf8'
  })
  assert.equal(humanCli.status, 0, humanCli.stderr)
  assert.match(humanCli.stdout, /Original bound source unchanged: true/)
  assert.doesNotMatch(humanCli.stdout, /undefined/)
})

test('built-in provider receives a bounded approved request and produces a fully verified isolated change', async () => {
  const root = await approvedImplementationProject({
    providerConfig: {
      schemaVersion: 2,
      adapter: {
        kind: 'provider', provider: 'codex', network: true, timeoutMs: 30_000,
        model: null, mode: 'auto', contextBudgetCharacters: null, maxBudgetUsd: null
      },
      writePolicy: { allowedPrefixes: ['src/'], maxChangedFiles: 4, maxDiffBytes: 64 * 1024 },
      recovery: { maxAttempts: 2 }
    }
  })
  let capturedRequest
  const providerRunner = async (_adapter, input) => {
    capturedRequest = JSON.parse(await readFile(join(input.cwd, input.requestPath), 'utf8'))
    await mkdir(join(input.cwd, 'src/main/java/example'), { recursive: true })
    await writeFile(join(input.cwd, 'src/main/java/example/Generated.java'), 'package example; class Generated {}\n', 'utf8')
    return {
      process: {
        exitCode: 0, signal: null, timedOut: false, stdioDrainTimedOut: false,
        startedAt: '2026-08-30T00:00:00.000Z', finishedAt: '2026-08-30T00:00:01.000Z', durationMs: 1000,
        stdout: { sha256: 'a'.repeat(64), bytes: 100, tail: '{"usage":{"input_tokens":100}}' },
        stderr: { sha256: 'b'.repeat(64), bytes: 0, tail: '' }
      },
      metadata: { kind: 'provider', provider: 'codex', version: 'fixture', profile: input.profile, usage: { 'usage.input_tokens': 100 } }
    }
  }
  const result = await runImplementation(root, 'IMPL-1', {
    actor: 'developer', allowWrite: true, allowNetwork: true,
    providerProbe: async () => ({ available: true, version: 'codex-fixture 1.0' }),
    providerRunner
  })
  assert.equal(result.record.status, 'passed', JSON.stringify(result.record, null, 2))
  assert.equal(result.record.adapterKind, 'provider')
  assert.equal(result.record.provider.id, 'codex')
  assert.equal(result.record.provider.profile.selected, 'balanced')
  assert.equal(capturedRequest.schemaVersion, 2)
  assert.equal(capturedRequest.implementation.profile.contextBudgetCharacters, 6000)
  assert.deepEqual(capturedRequest.implementation.allowedPrefixes, ['src/'])
  assert.equal(capturedRequest.authority.deployment, false)
  assert.equal(capturedRequest.codeContext.budget.limitCharacters, 6000)
  assert.equal(capturedRequest.projectConventions.schemaVersion, 1)
  assert.equal(capturedRequest.projectConventions.status, 'unknown')
  assert.equal(capturedRequest.projectConventions.projectRules.status, 'unknown')
  assert.deepEqual(capturedRequest.projectConventions.adjacentCode.paths, [])
  assert.equal(capturedRequest.projectConventions.requiredBeforeEdit.inspectAdjacentProductionAndTests, true)
  assert.equal(capturedRequest.projectConventions.authority.verdictAuthority, false)
  assert.equal(result.record.attempts[0].invocation.usage['usage.input_tokens'], 100)
  assert.equal(result.record.attempts[0].request.unchanged, true)
  assert.match(result.record.attempts[0].request.sha256, /^[a-f0-9]{64}$/)
})

test('automatic fast implementation requires confirmed project rules and adjacent source-bound code', async () => {
  const root = await approvedRuleAwareFastProject()
  let capturedRequest
  const result = await runImplementation(root, 'FAST-1', {
    actor: 'developer', allowWrite: true, allowNetwork: true,
    providerProbe: async () => ({ available: true, version: 'codex-fixture 1.0' }),
    providerRunner: async (_adapter, input) => {
      capturedRequest = JSON.parse(await readFile(join(input.cwd, input.requestPath), 'utf8'))
      await writeFile(
        join(input.cwd, 'src/main/java/orders/OrderLookup.java'),
        'package orders; class OrderLookup {}\n',
        'utf8'
      )
      return {
        process: {
          exitCode: 0, signal: null, timedOut: false, stdioDrainTimedOut: false,
          startedAt: '2026-08-31T00:00:00.000Z', finishedAt: '2026-08-31T00:00:01.000Z', durationMs: 1000,
          stdout: { sha256: 'a'.repeat(64), bytes: 0, tail: '' },
          stderr: { sha256: 'b'.repeat(64), bytes: 0, tail: '' }
        },
        metadata: { kind: 'provider', provider: 'codex', version: 'fixture', profile: input.profile, usage: {} }
      }
    }
  })

  assert.equal(result.record.status, 'passed', JSON.stringify(result.record, null, 2))
  assert.equal(result.record.provider.profile.selected, 'fast', JSON.stringify({
    profile: result.record.provider.profile,
    conventions: capturedRequest.projectConventions,
    codeContext: capturedRequest.codeContext
  }, null, 2))
  assert.equal(result.record.provider.profile.readiness.projectRules, 'confirmed')
  assert.equal(result.record.provider.profile.readiness.adjacentCode, 'confirmed')
  assert.equal(capturedRequest.projectConventions.status, 'confirmed')
  assert.equal(capturedRequest.projectConventions.projectRules.status, 'unknown')
  assert.equal(capturedRequest.projectConventions.projectRules.readiness, 'confirmed')
  assert.ok(capturedRequest.projectConventions.adjacentCode.paths.some((path) => path.endsWith('OrdersController.java')))
  assert.equal(capturedRequest.implementation.profile.verificationStrategy, 'all-required-gates')
})

test('an unavailable built-in provider fails before creating implementation state or changing the task', async () => {
  const root = await approvedImplementationProject({
    providerConfig: {
      schemaVersion: 2,
      adapter: {
        kind: 'provider', provider: 'codex', network: true, timeoutMs: 30_000,
        model: null, mode: 'auto', contextBudgetCharacters: null, maxBudgetUsd: null
      },
      writePolicy: { allowedPrefixes: ['src/'], maxChangedFiles: 4, maxDiffBytes: 64 * 1024 },
      recovery: { maxAttempts: 2 }
    }
  })

  await assert.rejects(
    runImplementation(root, 'IMPL-1', {
      actor: 'developer', allowWrite: true, allowNetwork: true,
      providerProbe: async () => ({ available: false, version: null })
    }),
    /provider is unavailable/
  )

  assert.equal((await loadTask(root, 'IMPL-1')).record.state, 'PLAN_APPROVED')
  await assert.rejects(implementationStatus(root, 'IMPL-1'), /No implementation run exists/)
})

test('a non-retryable built-in provider failure stops after one attempt', async () => {
  const root = await approvedImplementationProject({
    providerConfig: {
      schemaVersion: 2,
      adapter: {
        kind: 'provider', provider: 'codex', network: true, timeoutMs: 30_000,
        model: null, mode: 'fast', contextBudgetCharacters: 256, maxBudgetUsd: null
      },
      writePolicy: { allowedPrefixes: ['src/'], maxChangedFiles: 4, maxDiffBytes: 64 * 1024 },
      recovery: { maxAttempts: 2 }
    }
  })
  let calls = 0
  const providerRunner = async (_adapter, input) => {
    calls += 1
    return {
      process: {
        exitCode: 1, signal: null, timedOut: false, stdioDrainTimedOut: false,
        startedAt: '2026-08-30T00:00:00.000Z', finishedAt: '2026-08-30T00:00:01.000Z', durationMs: 1000,
        stdout: { sha256: 'a'.repeat(64), bytes: 0, tail: '' },
        stderr: { sha256: 'b'.repeat(64), bytes: 0, tail: '' }
      },
      metadata: {
        kind: 'provider', provider: 'codex', version: 'fixture', profile: input.profile, usage: {},
        failure: { code: 'not-authenticated', message: 'The local provider CLI is not authenticated in the filtered execution environment.' }
      }
    }
  }

  const result = await runImplementation(root, 'IMPL-1', {
    actor: 'developer', allowWrite: true, allowNetwork: true,
    providerProbe: async () => ({ available: true, version: 'codex-fixture 1.0' }),
    providerRunner
  })

  assert.equal(result.record.status, 'failed')
  assert.equal(calls, 1)
  assert.equal(result.record.attempts.length, 1)
  assert.equal(result.record.attempts[0].outcome, 'adapter-failed')
  assert.equal(result.record.verification.failure.providerFailure.code, 'not-authenticated')
})

test('a no-change provider result stops once without running Gates or blind recovery', async () => {
  const root = await approvedImplementationProject({
    providerConfig: {
      schemaVersion: 2,
      adapter: {
        kind: 'provider', provider: 'codex', network: true, timeoutMs: 30_000,
        model: null, mode: 'fast', contextBudgetCharacters: 256, maxBudgetUsd: null
      },
      writePolicy: { allowedPrefixes: ['src/'], maxChangedFiles: 4, maxDiffBytes: 64 * 1024 },
      recovery: { maxAttempts: 2 }
    }
  })
  let calls = 0
  const providerRunner = async (_adapter, input) => {
    calls += 1
    return {
      process: {
        exitCode: 0, signal: null, timedOut: false, stdioDrainTimedOut: false,
        startedAt: '2026-08-30T00:00:00.000Z', finishedAt: '2026-08-30T00:00:01.000Z', durationMs: 1000,
        stdout: { sha256: 'a'.repeat(64), bytes: 0, tail: '' },
        stderr: { sha256: 'b'.repeat(64), bytes: 0, tail: '' }
      },
      metadata: { kind: 'provider', provider: 'codex', version: 'fixture', profile: input.profile, usage: {} }
    }
  }

  const result = await runImplementation(root, 'IMPL-1', {
    actor: 'developer', allowWrite: true, allowNetwork: true,
    providerProbe: async () => ({ available: true, version: 'codex-fixture 1.0' }),
    providerRunner
  })

  assert.equal(result.record.status, 'failed')
  assert.equal(calls, 1)
  assert.equal(result.record.attempts.length, 1)
  assert.equal(result.record.attempts[0].outcome, 'no-source-change')
  assert.equal(result.record.verification.failure.code, 'implementation_no_source_change')
  assert.equal(result.record.verification.tests, null)
  assert.deepEqual(result.record.verification.gates, [])
  await assert.rejects(access(join(result.record.workspace, 'build/test-results/test/TEST-fixture.xml')), /ENOENT/)
})

test('a built-in provider cannot edit harness control files even when its prefix policy permits them', async () => {
  const root = await approvedImplementationProject({
    providerConfig: {
      schemaVersion: 2,
      adapter: {
        kind: 'provider', provider: 'claude', network: true, timeoutMs: 30_000,
        model: null, mode: 'fast', contextBudgetCharacters: 256, maxBudgetUsd: 1
      },
      writePolicy: { allowedPrefixes: ['.backend-harness/'], maxChangedFiles: 4, maxDiffBytes: 64 * 1024 },
      recovery: { maxAttempts: 1 }
    }
  })
  const providerRunner = async (_adapter, input) => {
    await writeFile(join(input.cwd, '.backend-harness/provider-owned.txt'), 'must be rejected\n', 'utf8')
    return {
      process: {
        exitCode: 0, signal: null, timedOut: false, stdioDrainTimedOut: false,
        startedAt: '2026-08-30T00:00:00.000Z', finishedAt: '2026-08-30T00:00:01.000Z', durationMs: 1000,
        stdout: { sha256: 'a'.repeat(64), bytes: 0, tail: '' },
        stderr: { sha256: 'b'.repeat(64), bytes: 0, tail: '' }
      },
      metadata: { kind: 'provider', provider: 'claude', version: 'fixture', profile: input.profile, usage: {} }
    }
  }

  const result = await runImplementation(root, 'IMPL-1', {
    actor: 'developer', allowWrite: true, allowNetwork: true,
    providerProbe: async () => ({ available: true, version: 'claude-fixture 1.0' }),
    providerRunner
  })

  assert.equal(result.record.status, 'failed')
  assert.equal(result.record.attempts[0].outcome, 'control-plane-change')
  assert.equal(result.record.attempts[0].verification.failure.code, 'protected_control_plane_changed')
})

test('a built-in provider cannot alter its ignored sealed request evidence', async () => {
  const root = await approvedImplementationProject({
    providerConfig: {
      schemaVersion: 2,
      adapter: {
        kind: 'provider', provider: 'codex', network: true, timeoutMs: 30_000,
        model: null, mode: 'fast', contextBudgetCharacters: 256, maxBudgetUsd: null
      },
      writePolicy: { allowedPrefixes: ['src/'], maxChangedFiles: 4, maxDiffBytes: 64 * 1024 },
      recovery: { maxAttempts: 1 }
    }
  })
  const providerRunner = async (_adapter, input) => {
    await writeFile(join(input.cwd, input.requestPath), '{}\n', 'utf8')
    await mkdir(join(input.cwd, 'src/main/java/example'), { recursive: true })
    await writeFile(join(input.cwd, 'src/main/java/example/Generated.java'), 'package example; class Generated {}\n', 'utf8')
    return {
      process: {
        exitCode: 0, signal: null, timedOut: false, stdioDrainTimedOut: false,
        startedAt: '2026-08-30T00:00:00.000Z', finishedAt: '2026-08-30T00:00:01.000Z', durationMs: 1000,
        stdout: { sha256: 'a'.repeat(64), bytes: 0, tail: '' },
        stderr: { sha256: 'b'.repeat(64), bytes: 0, tail: '' }
      },
      metadata: { kind: 'provider', provider: 'codex', version: 'fixture', profile: input.profile, usage: {} }
    }
  }

  const result = await runImplementation(root, 'IMPL-1', {
    actor: 'developer', allowWrite: true, allowNetwork: true,
    providerProbe: async () => ({ available: true, version: 'codex-fixture 1.0' }),
    providerRunner
  })

  assert.equal(result.record.status, 'failed')
  assert.equal(result.record.attempts[0].outcome, 'control-plane-change')
  assert.equal(result.record.attempts[0].verification.failure.code, 'implementation_request_changed')
  assert.equal(result.record.attempts[0].request.unchanged, false)
})

test('implementation refuses source writes without a fresh explicit write approval', async () => {
  const root = await approvedImplementationProject()
  await assert.rejects(runImplementation(root, 'IMPL-1', { actor: 'developer' }), /--allow-write/)
  const config = JSON.parse(await readFile(join(root, '.backend-harness/implementation.json'), 'utf8'))
  config.adapter.network = true
  await writeFile(join(root, '.backend-harness/implementation.json'), JSON.stringify(config, null, 2) + '\n', 'utf8')
  await assert.rejects(
    runImplementation(root, 'IMPL-1', { actor: 'developer', allowWrite: true }),
    /--acknowledge-network-risk/
  )
})

test('a failed verification feeds a bounded recovery attempt in the same isolated workspace', async () => {
  const root = await approvedImplementationProject({
    verificationFailsOnBrokenSource: true,
    adapterScript: [
      '#!/bin/sh',
      'set -eu',
      'mkdir -p src/main/java/example',
      'if [ "$BTH_IMPLEMENTATION_ATTEMPT" = "1" ]; then',
      '  printf "package example; class Generated { /* BROKEN */ }\\n" > src/main/java/example/Generated.java',
      'else',
      '  grep -q process_failed "$BTH_IMPLEMENTATION_REQUEST"',
      '  printf "package example; class Generated {}\\n" > src/main/java/example/Generated.java',
      'fi',
      ''
    ].join('\n')
  })

  const result = await runImplementation(root, 'IMPL-1', { actor: 'developer', allowWrite: true })

  assert.equal(result.record.status, 'passed', JSON.stringify(result.record, null, 2))
  assert.equal(result.record.attempts.length, 2)
  assert.equal(result.record.attempts[0].outcome, 'verification-failed')
  assert.equal(result.record.attempts[0].verification.failure, null)
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

test('rename detection cannot compress a large delete-add pair below the write byte budget', async () => {
  const root = await approvedImplementationProject({
    trackedLargeSourceBytes: 128 * 1024,
    adapterScript: [
      '#!/bin/sh',
      'set -eu',
      'if [ -f src/main/java/example/Large.java ]; then',
      '  mv src/main/java/example/Large.java src/main/java/example/Moved.java',
      'fi',
      ''
    ].join('\n')
  })

  const result = await runImplementation(root, 'IMPL-1', { actor: 'developer', allowWrite: true })

  assert.equal(result.record.status, 'failed')
  assert.ok(result.record.attempts.every((attempt) => attempt.outcome === 'write-policy-violation'))
  assert.match(result.record.attempts[0].verification.failure.message, /diff bytes .* exceed 65536/)
})

test('committing inside the isolated workspace cannot hide source changes', async () => {
  const root = await approvedImplementationProject({
    adapterScript: [
      '#!/bin/sh',
      'set -eu',
      'mkdir -p src/main/java/example',
      'printf "package example; class Generated {}\\n" > src/main/java/example/Generated.java',
      'git add src/main/java/example/Generated.java',
      'git -c user.name=fixture -c user.email=fixture@example.invalid commit -m generated >/dev/null',
      ''
    ].join('\n')
  })

  const result = await runImplementation(root, 'IMPL-1', { actor: 'developer', allowWrite: true })

  assert.equal(result.record.status, 'failed')
  assert.equal(result.record.attempts[0].outcome, 'workspace-history-change')
  assert.equal(result.record.attempts[0].verification.failure.code, 'implementation_workspace_history_changed')
  assert.ok(result.record.changedFiles.paths.includes('src/main/java/example/Generated.java'))
})

test('verification from IMPLEMENTING requires the passed files to be integrated first', async () => {
  const root = await approvedImplementationProject()
  const implementation = await runImplementation(root, 'IMPL-1', { actor: 'developer', allowWrite: true })

  await assert.rejects(
    verifyTask(root, 'IMPL-1'),
    /cannot start until the passed isolated implementation is integrated/
  )
  assert.equal((await loadTask(root, 'IMPL-1')).record.state, 'IMPLEMENTING')

  const source = implementation.record.implementedFiles[0].path
  await mkdir(dirname(join(root, source)), { recursive: true })
  await copyFile(join(implementation.record.workspace, source), join(root, source))
  const verified = await verifyTask(root, 'IMPL-1')

  assert.equal(verified.confirmed, true)
  assert.equal(verified.task.state, 'VERIFIED')

  const cleaned = await cleanupImplementation(root, 'IMPL-1', { actor: 'developer', discardWorkspace: true })
  assert.equal(cleaned.workspaceRemoved, true)
  assert.equal(cleaned.record.status, 'passed')
  assert.equal(cleaned.record.workspace, null)
  await access(join(root, cleaned.archivedRecord))
  await assert.rejects(access(implementation.record.workspace), /ENOENT/)
  assert.equal((await implementationStatus(root, 'IMPL-1')).record.workspaceCleanup.actor, 'developer')
})

test('VERIFY_FAILED retry remains bound to the isolated change inventory and rejects extra files', async () => {
  const root = await approvedImplementationProject()
  const implementation = await runImplementation(root, 'IMPL-1', { actor: 'developer', allowWrite: true })
  const source = implementation.record.implementedFiles[0].path
  await mkdir(dirname(join(root, source)), { recursive: true })
  await copyFile(join(implementation.record.workspace, source), join(root, source))

  const failed = await verifyTask(root, 'IMPL-1', {
    registry: {
      async execute() {
        return { passed: false, tests: { tests: 1, executed: 1, failures: 1, errors: 0, skipped: 0 }, gates: [] }
      }
    }
  })
  assert.equal(failed.task.state, 'VERIFY_FAILED')
  await writeFile(join(root, 'src/main/java/example/Extra.java'), 'package example; class Extra {}\n', 'utf8')

  await assert.rejects(
    verifyTask(root, 'IMPL-1'),
    /extra:src\/main\/java\/example\/Extra\.java/
  )
  assert.equal((await loadTask(root, 'IMPL-1')).record.state, 'VERIFY_FAILED')
})

test('an exhausted implementation recovery budget fails explicitly instead of returning a silent no-op', async () => {
  const root = await approvedImplementationProject({ adapterScript: '#!/bin/sh\nexit 9\n' })
  const first = await runImplementation(root, 'IMPL-1', { actor: 'developer', allowWrite: true })
  assert.equal(first.record.status, 'failed')
  assert.equal(first.record.attempts.length, 2)

  await assert.rejects(
    runImplementation(root, 'IMPL-1', { actor: 'developer', allowWrite: true }),
    /recovery budget is exhausted/
  )
})

test('a failed isolated implementation cannot escape into ordinary verification', async () => {
  const root = await approvedImplementationProject({ adapterScript: '#!/bin/sh\nexit 9\n' })
  const result = await runImplementation(root, 'IMPL-1', { actor: 'developer', allowWrite: true })
  assert.equal(result.record.status, 'failed')
  assert.equal((await loadTask(root, 'IMPL-1')).record.implementationMode, 'isolated')

  await assert.rejects(
    verifyTask(root, 'IMPL-1'),
    /isolated implementation is not certified as passed/
  )
  assert.equal((await loadTask(root, 'IMPL-1')).record.state, 'IMPLEMENTING')
})

test('explicit reset archives a failed record, removes its worktree, and permits a clean restart boundary', async () => {
  const root = await approvedImplementationProject({ adapterScript: '#!/bin/sh\nexit 9\n' })
  const failed = await runImplementation(root, 'IMPL-1', { actor: 'developer', allowWrite: true })

  await assert.rejects(
    resetImplementation(root, 'IMPL-1', { actor: 'developer' }),
    /--discard-workspace/
  )
  const reset = await resetImplementation(root, 'IMPL-1', { actor: 'developer', discardWorkspace: true })

  assert.equal(reset.workspaceRemoved, true)
  await access(join(root, reset.archivedRecord))
  await assert.rejects(access(failed.record.workspace), /ENOENT/)
  await assert.rejects(implementationStatus(root, 'IMPL-1'), /No implementation run exists/)
  assert.equal((await loadTask(root, 'IMPL-1')).record.state, 'IMPLEMENTING')
  assert.equal((await loadTask(root, 'IMPL-1')).record.implementationMode, 'isolated')
})

test('a revised plan can reset the stale isolated implementation record that invalidated its mode', async () => {
  const root = await approvedImplementationProject({ adapterScript: '#!/bin/sh\nexit 9\n' })
  const failed = await runImplementation(root, 'IMPL-1', { actor: 'developer', allowWrite: true })
  const source = await captureConfiguredSourceBinding(root)
  const revised = await updateTaskPlan(root, 'IMPL-1', 'Use a different implementation approach.', {
    actor: 'developer',
    sourceFingerprint: source.fingerprint
  })
  assert.equal(revised.record.state, 'CONTEXT_READY')
  assert.equal(revised.record.implementationMode, null)

  const reset = await resetImplementation(root, 'IMPL-1', { actor: 'developer', discardWorkspace: true })

  assert.equal(reset.workspaceRemoved, true)
  await assert.rejects(access(failed.record.workspace), /ENOENT/)
  await assert.rejects(implementationStatus(root, 'IMPL-1'), /No implementation run exists/)
})

test('assume-unchanged and skip-worktree index tricks cannot hide adapter writes', async () => {
  const root = await approvedImplementationProject({
    adapterScript: [
      '#!/bin/sh',
      'set -eu',
      'printf "plugins { java; application }\\n" > build.gradle.kts',
      'git update-index --assume-unchanged build.gradle.kts',
      'git update-index --skip-worktree gradlew',
      'printf "# hidden\\n" >> gradlew',
      'mkdir -p src/main/java/example',
      'printf "package example; class Generated {}\\n" > src/main/java/example/Generated.java',
      ''
    ].join('\n')
  })

  const result = await runImplementation(root, 'IMPL-1', { actor: 'developer', allowWrite: true })

  assert.equal(result.record.status, 'failed')
  assert.equal(result.record.attempts[0].outcome, 'index-flags-change')
  assert.equal(result.record.attempts[0].verification.failure.code, 'implementation_index_flags_changed')
})

test('a shared branch ref created by the adapter is detected even when detached HEAD is restored', async () => {
  const root = await approvedImplementationProject({
    adapterScript: [
      '#!/bin/sh',
      'set -eu',
      'base=$(git rev-parse HEAD)',
      'git branch adapter-hidden-ref "$base"',
      'mkdir -p src/main/java/example',
      'printf "package example; class Generated {}\\n" > src/main/java/example/Generated.java',
      ''
    ].join('\n')
  })

  const result = await runImplementation(root, 'IMPL-1', { actor: 'developer', allowWrite: true })

  assert.equal(result.record.status, 'failed')
  assert.equal(result.record.attempts[0].outcome, 'shared-refs-change')
  assert.equal(result.record.attempts[0].verification.failure.code, 'implementation_shared_refs_changed')
})

test('a Gate cannot change candidate source bytes and have those post-Gate bytes certified', async () => {
  const root = await approvedImplementationProject({ verificationMutatesCandidate: true })

  const result = await runImplementation(root, 'IMPL-1', { actor: 'developer', allowWrite: true })

  assert.equal(result.record.status, 'failed')
  assert.ok(result.record.attempts.every((attempt) => attempt.verification.failure.code === 'verification_gate_modified_candidate'))
  assert.deepEqual(result.record.implementedFiles, [])
})

test('a Gate cannot add a new source path outside the pre-Gate implementation inventory', async () => {
  const root = await approvedImplementationProject({ verificationAddsCandidate: true })

  const result = await runImplementation(root, 'IMPL-1', { actor: 'developer', allowWrite: true })

  assert.equal(result.record.status, 'failed')
  assert.equal(result.record.attempts.length, 1)
  assert.equal(result.record.attempts[0].outcome, 'gate-integrity-failure')
  assert.equal(result.record.attempts[0].verification.failure.code, 'verification_gate_changed_inventory')
  assert.deepEqual(result.record.implementedFiles, [])
  await assert.rejects(
    runImplementation(root, 'IMPL-1', { actor: 'developer', allowWrite: true }),
    /Reset the tainted workspace/
  )
})

test('an interrupted setup leaves a running record that reset can use to remove the allocation', async () => {
  const root = await approvedImplementationProject({ adapterCommand: ['./tools'] })

  await assert.rejects(
    runImplementation(root, 'IMPL-1', { actor: 'developer', allowWrite: true }),
    /executable is missing or unsafe/
  )
  const status = await implementationStatus(root, 'IMPL-1')
  assert.equal(status.record.status, 'running')
  assert.equal((await loadTask(root, 'IMPL-1')).record.implementationMode, 'isolated')

  const reset = await resetImplementation(root, 'IMPL-1', { actor: 'developer', discardWorkspace: true })
  assert.equal(reset.workspaceRemoved, true)
  await access(join(root, reset.resetReceipt))
  assert.equal((await loadTask(root, 'IMPL-1')).record.implementationAudit.action, 'reset')
})

test('a running allocation remains resettable after a plan edit clears implementation mode', async () => {
  const root = await approvedImplementationProject({ adapterCommand: ['./tools'] })
  await assert.rejects(
    runImplementation(root, 'IMPL-1', { actor: 'developer', allowWrite: true }),
    /executable is missing or unsafe/
  )
  const source = await captureConfiguredSourceBinding(root)
  const revised = await updateTaskPlan(root, 'IMPL-1', 'Revise after the interrupted allocation.', {
    actor: 'developer', sourceFingerprint: source.fingerprint
  })
  assert.equal(revised.record.implementationMode, null)

  const reset = await resetImplementation(root, 'IMPL-1', { actor: 'developer', discardWorkspace: true })

  assert.equal(reset.workspaceRemoved, true)
  await assert.rejects(implementationStatus(root, 'IMPL-1'), /No implementation run exists/)
})

test('integration inventory ignores hostile inherited GIT_DIR and still reports extra source paths', async () => {
  const root = await approvedImplementationProject()
  const implementation = await runImplementation(root, 'IMPL-1', { actor: 'developer', allowWrite: true })
  const source = implementation.record.implementedFiles[0].path
  await mkdir(dirname(join(root, source)), { recursive: true })
  await copyFile(join(implementation.record.workspace, source), join(root, source))
  await writeFile(join(root, 'src/main/java/example/Extra.java'), 'package example; class Extra {}\n', 'utf8')
  const priorGitDir = process.env.GIT_DIR
  process.env.GIT_DIR = join(root, 'missing-hostile-git-dir')
  try {
    await assert.rejects(
      verifyTask(root, 'IMPL-1'),
      /extra:src\/main\/java\/example\/Extra\.java/
    )
  } finally {
    if (priorGitDir === undefined) delete process.env.GIT_DIR
    else process.env.GIT_DIR = priorGitDir
  }
})

test('monorepo subdirectory implementation fails explicitly instead of misbinding paths', async () => {
  const repository = await mkdtemp(join(tmpdir(), 'bth-implementation-monorepo-'))
  const root = join(repository, 'services/orders')
  await mkdir(root, { recursive: true })
  await writeGradleFixture(root)
  await initProject(root)
  await writeFile(join(root, '.backend-harness/implementation.json'), JSON.stringify({
    schemaVersion: 1,
    adapter: { id: 'fixture', command: ['./tools/implement'], network: false, timeoutMs: 30_000 },
    writePolicy: { allowedPrefixes: ['src/'], maxChangedFiles: 4, maxDiffBytes: 64 * 1024 },
    recovery: { maxAttempts: 1 }
  }, null, 2) + '\n', 'utf8')
  await mkdir(join(root, 'tools'), { recursive: true })
  await writeFile(join(root, 'tools/implement'), '#!/bin/sh\nexit 0\n', 'utf8')
  await chmod(join(root, 'tools/implement'), 0o755)
  initializeGit(repository)
  await createTask(root, { id: 'MONO-1', context: 'Change one service.' })
  await advanceTask(root, 'MONO-1', 'CONTEXT_READY', { actor: 'developer' })
  const source = await captureConfiguredSourceBinding(root)
  await updateTaskPlan(root, 'MONO-1', 'Change only this service.', { actor: 'developer', sourceFingerprint: source.fingerprint })
  await advanceTask(root, 'MONO-1', 'PLAN_PROPOSED', { actor: 'developer' })
  await advanceTask(root, 'MONO-1', 'PLAN_APPROVED', { actor: 'reviewer', approved: true, currentSourceFingerprint: source.fingerprint })

  await assert.rejects(
    runImplementation(root, 'MONO-1', { actor: 'developer', allowWrite: true }),
    /requires the harness project root to be the Git top-level/
  )
})

test('an original-source isolation breach is persisted as failure evidence', async () => {
  const root = await approvedImplementationProject({
    adapterScript: [
      '#!/bin/sh',
      'set -eu',
      'mkdir -p src/main/java/example',
      'printf "package example; class Generated {}\\n" > src/main/java/example/Generated.java',
      'common=$(git rev-parse --path-format=absolute --git-common-dir)',
      'original=$(dirname "$common")',
      'mkdir -p "$original/src/main/java/example"',
      'printf "package example; class Escaped {}\\n" > "$original/src/main/java/example/Escaped.java"',
      ''
    ].join('\n')
  })

  const result = await runImplementation(root, 'IMPL-1', { actor: 'developer', allowWrite: true })

  assert.equal(result.record.status, 'failed')
  assert.equal(result.record.originalBoundSourceUnchanged, false)
  assert.equal(result.record.verification.failure.code, 'original_bound_source_changed')
  assert.equal(result.record.attempts.at(-1).outcome, 'original-source-change')
  await access(join(root, 'src/main/java/example/Escaped.java'))
})

test('an ignored declared verification input is staged but cannot be changed invisibly', async () => {
  const root = await approvedImplementationProject({
    ignoredDeclaredInput: true,
    adapterScript: [
      '#!/bin/sh',
      'set -eu',
      'test -f gradle.properties',
      'printf "fixture.mode=mutated\\n" > gradle.properties',
      'mkdir -p src/main/java/example',
      'printf "package example; class Generated {}\\n" > src/main/java/example/Generated.java',
      ''
    ].join('\n')
  })

  const result = await runImplementation(root, 'IMPL-1', { actor: 'developer', allowWrite: true })

  assert.equal(result.record.status, 'failed')
  assert.ok(result.record.attempts.every((attempt) => attempt.outcome === 'control-plane-change'))
  assert.equal(result.record.attempts[0].verification.failure.code, 'declared_verification_input_changed')
  assert.equal(await readFile(join(root, 'gradle.properties'), 'utf8'), 'fixture.mode=original\n')
})

test('deleting a declared verification input becomes a sealed failure instead of aborting without a record', async () => {
  const root = await approvedImplementationProject({
    adapterScript: [
      '#!/bin/sh',
      'set -eu',
      'rm -f gradlew',
      'mkdir -p src/main/java/example',
      'printf "package example; class Generated {}\\n" > src/main/java/example/Generated.java',
      ''
    ].join('\n')
  })

  const result = await runImplementation(root, 'IMPL-1', { actor: 'developer', allowWrite: true })

  assert.equal(result.record.status, 'failed')
  assert.equal(result.record.attempts[0].outcome, 'source-binding-failed')
  assert.equal(result.record.attempts[0].verification.failure.code, 'implementation_source_binding_failed')
  assert.match(result.record.attempts[0].verification.failure.message, /gradlew/)
})
