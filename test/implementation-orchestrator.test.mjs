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
import { applyImplementation } from '../src/runtime/implementation-apply.mjs'
import { answerInterview, completeInterview, startInterview } from '../src/runtime/interview-orchestrator.mjs'
import { advanceTask, createTask, loadTask, updateTaskPlan } from '../src/core/task-store.mjs'
import { initializeGit, writeGradleFixture } from '../test-support/git-project.mjs'
import { loadBudgetedCodeContext } from '../src/core/code-context.mjs'
import { exportApprovedPlan } from '../src/runtime/plan-export.mjs'
import { saveImplementationRecord, snapshotImplementedFiles } from '../src/core/implementation-record-store.mjs'

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
  for (const [path, content] of Object.entries(options.projectFiles ?? {})) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), content, 'utf8')
    if ((options.executableFiles ?? []).includes(path)) await chmod(join(root, path), 0o755)
  }
  if (options.verificationConfig) {
    await writeFile(join(root, '.backend-harness/verification.json'), JSON.stringify(options.verificationConfig, null, 2) + '\n', 'utf8')
  }
  initializeGit(root, { forcePaths: ['.gitignore', '.backend-harness/.gitignore'] })
  await createTask(root, { id: 'IMPL-1', context: options.taskContext ?? 'Add one generated fixture class.' })
  await advanceTask(root, 'IMPL-1', 'CONTEXT_READY', { actor: 'developer' })
  const source = await captureConfiguredSourceBinding(root)
  await updateTaskPlan(root, 'IMPL-1', options.taskPlan ?? 'Create src/main/java/example/Generated.java and preserve all verification Gates.', {
    actor: 'developer', sourceFingerprint: source.fingerprint
  })
  await advanceTask(root, 'IMPL-1', 'PLAN_PROPOSED', { actor: 'developer' })
  await advanceTask(root, 'IMPL-1', 'PLAN_APPROVED', {
    actor: 'reviewer', approved: true, currentSourceFingerprint: source.fingerprint
  })
  return root
}

const formattingTarget = 'src/main/java/example/Generated.java'
const formattingOriginal = 'package example; class Generated {} // BROKEN\n'
async function formattingProject(options = {}) {
  const formatting = { command: ['./tools/format'], network: false, inputs: ['.style.json'], timeoutMs: 3000, ...options.formatting }
  return approvedImplementationProject({
    verificationFailsOnBrokenSource: true,
    adapterScript: options.adapterScript ?? '#!/bin/sh\nset -eu\nmkdir -p src/main/java/example\nprintf "package example; class Generated {} // BROKEN\\n" > src/main/java/example/Generated.java\n',
    providerConfig: {
      schemaVersion: 2, adapter: { kind: 'command', id: 'fixture', command: ['./tools/implement'], network: false, timeoutMs: 30000 },
      writePolicy: { allowedPrefixes: ['src/'], maxChangedFiles: 4, maxDiffBytes: 65536 }, recovery: { maxAttempts: 2 },
      formatting: options.disabled ? null : formatting
    },
    projectFiles: {
      '.style.json': '{}\n',
      'src/main/java/example/Unchanged.java': 'class Unchanged {}\n',
      'tools/format': '#!/usr/bin/env node\n' + (options.formatter ?? "const fs = require('node:fs'); const p = 'src/main/java/example/Generated.java'; fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(' // BROKEN', '')); console.log('private-source-do-not-copy');\n")
    }, executableFiles: ['tools/format'],
    verificationConfig: { schemaVersion: 1, gates: [{ id: 'tests', required: true, command: ['./gradlew', 'test'],
      inputs: options.inputs ?? ['build.gradle.kts', 'tools/format', '.style.json'], timeoutMs: 30000,
      result: { type: 'junit', reports: ['build/test-results/test/*.xml'], minimumTests: 1 } }] }
  })
}
const formattingOptions = { actor: 'developer', allowWrite: true }

test('project formatter fixes a candidate before fresh tests without a model retry, preserving original and recovery bytes', async () => {
  const root = await formattingProject()
  const result = await runImplementation(root, 'IMPL-1', formattingOptions)
  assert.equal(result.record.status, 'passed')
  assert.equal(result.record.attempts.length, 1)
  const receipt = result.record.attempts[0].formatting
  assert.equal(receipt.status, 'passed')
  assert.deepEqual(receipt.changedPaths, [formattingTarget])
  assert.ok(result.record.verification.tests.executed > 0)
  assert.equal(await readFile(join(result.record.workspace, formattingTarget), 'utf8'), formattingOriginal.replace(' // BROKEN', ''))
  await assert.rejects(access(join(root, formattingTarget)), /ENOENT/)
  assert.equal(await readFile(join(root, receipt.backup, formattingTarget), 'utf8'), formattingOriginal)
  assert.doesNotMatch(JSON.stringify(result.record), /private-source-do-not-copy/)
})

test('no source change skips formatter and verification; disabled formatting preserves existing behavior', async () => {
  const noChange = await formattingProject({ adapterScript: '#!/bin/sh\nexit 0\n' })
  const result = await runImplementation(noChange, 'IMPL-1', formattingOptions)
  assert.equal(result.record.attempts.length, 1)
  assert.equal(result.record.attempts[0].outcome, 'no-source-change')
  assert.equal(result.record.attempts[0].formatting, undefined)
  assert.equal(result.record.verification.tests, null)
  const disabled = await formattingProject({ disabled: true })
  const failed = await runImplementation(disabled, 'IMPL-1', formattingOptions)
  assert.equal(failed.record.status, 'failed')
  assert.equal(failed.record.attempts.length, 2)
  assert.equal(failed.record.attempts[0].formatting, undefined)
})

test('formatter network and unbound command/config inputs refuse before provider writes', async () => {
  for (const options of [{ formatting: { network: true } }, { inputs: ['build.gradle.kts'] }, { inputs: ['build.gradle.kts', 'tools/format'] }]) {
    const root = await formattingProject(options)
    await assert.rejects(runImplementation(root, 'IMPL-1', formattingOptions), error => ['formatting_network_not_acknowledged', 'formatting_input_not_bound'].includes(error.code))
    await assert.rejects(access(join(root, formattingTarget)), /ENOENT/)
  }
})

test('failed or timed-out formatter stops without wasting provider retries or passing tests', async () => {
  for (const options of [{ formatter: 'process.exit(7)\n' }, { formatter: 'setInterval(() => {}, 1000)\n', formatting: { timeoutMs: 1000 } }]) {
    const root = await formattingProject(options)
    const result = await runImplementation(root, 'IMPL-1', formattingOptions)
    assert.equal(result.record.status, 'failed')
    assert.equal(result.record.attempts.length, 1)
    assert.equal(result.record.attempts[0].outcome, 'formatting-failed')
    assert.equal(result.record.verification.failure.code, 'formatting_process_failed')
    assert.equal(result.record.verification.tests, null)
  }
})

test('formatter cannot expand changed-file scope, delete candidates or change file mode', async () => {
  for (const operation of [
    "fs.writeFileSync('src/main/java/example/Unchanged.java', 'class Changed {}')",
    "fs.writeFileSync('src/main/java/example/Extra.java', 'class Extra {}')",
    "fs.unlinkSync('src/main/java/example/Generated.java')",
    "fs.chmodSync('src/main/java/example/Generated.java', 0o755)"
  ]) {
    const root = await formattingProject({ formatter: "const fs = require('node:fs'); " + operation + '\n' })
    const result = await runImplementation(root, 'IMPL-1', formattingOptions)
    assert.equal(result.record.status, 'failed')
    assert.equal(result.record.attempts.length, 1)
    assert.equal(result.record.attempts[0].outcome, 'formatting-integrity-failure')
    assert.equal(result.record.verification.tests, null)
    await assert.rejects(runImplementation(root, 'IMPL-1', formattingOptions), /Reset/)
    await assert.rejects(applyImplementation(root, 'IMPL-1', formattingOptions))
    assert.equal(await readFile(join(root, 'src/main/java/example/Unchanged.java'), 'utf8'), 'class Unchanged {}\n')
  }
})

test('provider cannot change the formatter before invocation; formatter control-plane writes cannot pass', async () => {
  const providerRoot = await formattingProject({ adapterScript: '#!/bin/sh\nprintf "#!/bin/sh\\nexit 0\\n" > tools/format\nmkdir -p src/main/java/example\nprintf "class Generated {}" > src/main/java/example/Generated.java\n' })
  const providerResult = await runImplementation(providerRoot, 'IMPL-1', formattingOptions)
  assert.equal(providerResult.record.status, 'failed')
  assert.equal(providerResult.record.attempts[0].formatting, undefined)
  for (const operation of [
    "require('node:fs').writeFileSync('.style.json', '{\"changed\":true}')",
    "require('node:child_process').execFileSync('git', ['update-index', '--assume-unchanged', 'src/main/java/example/Unchanged.java'])",
    "require('node:child_process').execFileSync('git', ['branch', 'formatter-tamper'])"
  ]) {
    const root = await formattingProject({ formatter: operation + '\n' })
    const result = await runImplementation(root, 'IMPL-1', formattingOptions)
    assert.equal(result.record.status, 'failed')
    assert.equal(result.record.attempts.length, 1)
    assert.equal(result.record.attempts[0].outcome, 'formatting-integrity-failure')
    assert.equal(result.record.verification.tests, null)
  }
})

const preservationFile = 'src/main/java/example/Customer.java'
const guardedCustomer = 'class Customer { @OneToMany List<Order> orders; void add(Order o) { if(o.isNew()) orders.add(o); } }\n'
const recoveredCustomer = guardedCustomer.replace(' }\n', ' int count() { return orders.size(); } }\n')
const unguardedCustomer = guardedCustomer.replace('if(o.isNew())', '')
async function preservationProject() {
  return approvedImplementationProject({
    taskContext: 'Intentionally allow already-persisted orders to be associated after reviewing the changed guard.',
    projectFiles: { [preservationFile]: guardedCustomer }, providerConfig: {
    schemaVersion: 2,
    adapter: { kind: 'provider', provider: 'codex', network: true, timeoutMs: 30_000, model: null, mode: 'fast', contextBudgetCharacters: 256, maxBudgetUsd: null },
    writePolicy: { allowedPrefixes: ['src/'], maxChangedFiles: 4, maxDiffBytes: 65536 }, recovery: { maxAttempts: 2 }
  } })
}
function syntheticProvider(input) {
  return {
    process: { exitCode: 0, signal: null, timedOut: false, stdioDrainTimedOut: false,
      startedAt: '2026-08-31T00:00:00Z', finishedAt: '2026-08-31T00:00:01Z', durationMs: 1000,
      stdout: { sha256: 'a'.repeat(64), bytes: 0, tail: '' }, stderr: { sha256: 'b'.repeat(64), bytes: 0, tail: '' } },
    metadata: { kind: 'provider', provider: 'codex', version: 'fixture', profile: input.profile, usage: {} }
  }
}
const preservationOptions = { actor: 'developer', allowWrite: true, allowNetwork: true, providerProbe: async () => ({ available: true, version: 'fixture' }) }

test('fresh JUnit exception reaches the next implementation attempt without copying diagnostic bodies', async () => {
  const root = await approvedImplementationProject({
    providerConfig: { schemaVersion: 2, adapter: { kind: 'provider', provider: 'codex', network: true, mode: 'fast' },
      writePolicy: { allowedPrefixes: ['src/'], maxChangedFiles: 4, maxDiffBytes: 65536 }, recovery: { maxAttempts: 2 } },
    projectFiles: { gradlew: '#!/bin/sh\nset -eu\nmkdir -p build/test-results/test\nif grep -q BROKEN src/main/java/example/Generated.java; then\nprintf \'%s\\n\' \'<testsuite><testcase classname="ViewTest" name="renders"><error type="org.xml.sax.SAXParseException" message="token=private">private-source-stack</error></testcase></testsuite>\' > build/test-results/test/TEST-fixture.xml\nexit 1\nfi\nprintf \'%s\\n\' \'<testsuite><testcase classname="ViewTest" name="renders"/></testsuite>\' > build/test-results/test/TEST-fixture.xml\n' },
    executableFiles: ['gradlew']
  })
  let calls = 0
  const result = await runImplementation(root, 'IMPL-1', { ...preservationOptions, providerRunner: async (_adapter, input) => {
    calls++
    const request = JSON.parse(await readFile(join(input.cwd, input.requestPath), 'utf8'))
    if (calls === 2) {
      assert.deepEqual(request.recovery.failedGates[0].failedTests[0].diagnostics,
        [{ code: 'xml_parse_error', exceptionType: 'org.xml.sax.SAXParseException' }])
      assert.doesNotMatch(JSON.stringify(request.recovery), /private|token=|stack/)
    }
    await mkdir(join(input.cwd, 'src/main/java/example'), { recursive: true })
    await writeFile(join(input.cwd, 'src/main/java/example/Generated.java'), 'class Generated {} // ' + (calls === 1 ? 'BROKEN' : 'fixed') + '\n')
    return syntheticProvider(input)
  } })
  assert.equal(calls, 2)
  assert.equal(result.record.status, 'passed')
  assert.equal(result.record.attempts[0].verification.confirmed, false)
  assert.equal(result.record.attempts[0].verification.tests.errors, 1)
  assert.equal(result.record.attempts[1].verification.tests.errors, 0)
  assert.equal(result.record.originalBoundSourceUnchanged, true)
})

test('intended structural change runs tests once and awaits exact-candidate review without blind repair', async () => {
  const root = await preservationProject()
  const result = await runImplementation(root, 'IMPL-1', { ...preservationOptions, providerRunner: async (_adapter, input) => {
    const request = JSON.parse(await readFile(join(input.cwd, input.requestPath), 'utf8'))
    assert.equal(request.verification.preservation.scope, 'changed-java-direct-relationship-writes')
    assert.equal(request.attempt, 1)
    await writeFile(join(input.cwd, preservationFile), unguardedCustomer)
    return syntheticProvider(input)
  } })
  assert.equal(result.record.status, 'passed')
  assert.equal(result.record.attempts.length, 1)
  assert.equal(result.record.attempts[0].verification.preservation.status, 'review-required')
  assert.equal(result.preservationReview.status, 'required')
  assert.match(result.preservationReview.fingerprint, /^[a-f0-9]{64}$/)
  assert.ok(result.record.verification.tests.executed > 0)
  assert.equal(await readFile(join(root, preservationFile), 'utf8'), guardedCustomer)
  await assert.rejects(applyImplementation(root, 'IMPL-1', preservationOptions), { code: 'apply_preservation_review_required' })
  const status = await implementationStatus(root, 'IMPL-1')
  assert.equal(status.preservationReview.fingerprint, result.preservationReview.fingerprint)
  const cliStatus = spawnSync(process.execPath, ['src/cli.mjs', 'implement', 'status', 'IMPL-1', root, '--json'], { encoding: 'utf8' })
  assert.equal(cliStatus.status, 2, cliStatus.stderr)
  assert.equal(JSON.parse(cliStatus.stdout).preservationReview.fingerprint, status.preservationReview.fingerprint)
  const cliApply = spawnSync(process.execPath, ['src/cli.mjs', 'implement', 'apply', 'IMPL-1', root, '--by', 'developer', '--allow-write',
    '--accept-preservation-review', status.preservationReview.fingerprint,
    '--review-note', 'Reviewed the intentional association behavior and its exact candidate diff.', '--json'], { encoding: 'utf8' })
  assert.equal(cliApply.status, 0, cliApply.stderr)
  const apply = JSON.parse(cliApply.stdout)
  assert.equal(apply.integration.integrated, true)
  const receipt = JSON.parse(await readFile(join(root, apply.receipt), 'utf8'))
  assert.equal(receipt.preservationReview.fingerprint, status.preservationReview.fingerprint)
  assert.equal(receipt.preservationReview.actor, 'developer')
  assert.equal(await readFile(join(root, preservationFile), 'utf8'), unguardedCustomer)
})

test('wrong review, missing or secret note, and edited candidate cannot apply or stage files', async () => {
  const root = await preservationProject()
  const result = await runImplementation(root, 'IMPL-1', { ...preservationOptions, providerRunner: async (_adapter, input) => {
    await writeFile(join(input.cwd, preservationFile), unguardedCustomer)
    return syntheticProvider(input)
  } })
  assert.equal(result.record.status, 'passed')
  const accepted = { ...preservationOptions, acceptPreservationReview: result.preservationReview.fingerprint, reviewNote: 'Reviewed the exact candidate.' }
  for (const invalid of [
    { ...accepted, acceptPreservationReview: 'f'.repeat(64) },
    { ...accepted, reviewNote: undefined },
    { ...accepted, reviewNote: 'Reviewed secret=fixture-only' }
  ]) await assert.rejects(applyImplementation(root, 'IMPL-1', invalid), error => error.code.startsWith('apply_preservation_'))
  await assert.rejects(access(join(root, '.backend-harness/local/apply')), /ENOENT/)
  await writeFile(join(result.record.workspace, preservationFile), unguardedCustomer + '// changed after review\n')
  await assert.rejects(applyImplementation(root, 'IMPL-1', accepted), { code: 'apply_candidate_changed' })
  await assert.rejects(implementationStatus(root, 'IMPL-1'), { code: 'implementation_candidate_changed' })
  assert.equal(await readFile(join(root, preservationFile), 'utf8'), guardedCustomer)
})

test('old sealed candidates get fresh review metadata without rewriting their record or auto-applying', async () => {
  const root = await preservationProject()
  const result = await runImplementation(root, 'IMPL-1', { ...preservationOptions, providerRunner: async (_adapter, input) => {
    await writeFile(join(input.cwd, preservationFile), recoveredCustomer)
    return syntheticProvider(input)
  } })
  assert.equal(result.record.status, 'passed')
  await writeFile(join(result.record.workspace, preservationFile), unguardedCustomer)
  const { recordSha256, ...fields } = result.record
  // Construct an old valid seal: candidate bytes are unchanged relative to that seal,
  // so only the newly independent preservation recheck can reject it.
  const legacy = await saveImplementationRecord(join(root, result.path), {
    ...fields, verification: { ...fields.verification, preservation: undefined },
    implementedFiles: await snapshotImplementedFiles(result.record.workspace, [preservationFile])
  })
  const before = await readFile(join(root, result.path), 'utf8')
  const reused = await runImplementation(root, 'IMPL-1', preservationOptions)
  assert.equal(reused.preservationReview.status, 'required')
  assert.equal(reused.record.recordSha256, legacy.recordSha256)
  await assert.rejects(applyImplementation(root, 'IMPL-1', preservationOptions), { code: 'apply_preservation_review_required' })
  assert.equal(await readFile(join(root, preservationFile), 'utf8'), guardedCustomer)
  assert.equal(await readFile(join(root, result.path), 'utf8'), before)
  assert.match(legacy.recordSha256, /^[a-f0-9]{64}$/)
  await assert.rejects(access(join(root, '.backend-harness/local/apply')), /ENOENT/)
})

test('incomplete old candidate inspection cannot be waived with a previously valid review fingerprint', async () => {
  const root = await preservationProject()
  const result = await runImplementation(root, 'IMPL-1', { ...preservationOptions, providerRunner: async (_adapter, input) => {
    await writeFile(join(input.cwd, preservationFile), unguardedCustomer)
    return syntheticProvider(input)
  } })
  await writeFile(join(result.record.workspace, preservationFile), 'class Customer { @OneToMany List<Order> orders; void broken( {')
  const { recordSha256, ...fields } = result.record
  await saveImplementationRecord(join(root, result.path), { ...fields,
    implementedFiles: await snapshotImplementedFiles(result.record.workspace, [preservationFile]) })
  const status = await implementationStatus(root, 'IMPL-1')
  assert.equal(status.preservationReview.status, 'unavailable')
  await assert.rejects(applyImplementation(root, 'IMPL-1', { ...preservationOptions,
    acceptPreservationReview: result.preservationReview.fingerprint, reviewNote: 'Reviewed the old candidate.' }), { code: 'apply_preservation_incomplete' })
  await assert.rejects(access(join(root, '.backend-harness/local/apply')), /ENOENT/)
  assert.equal(await readFile(join(root, preservationFile), 'utf8'), guardedCustomer)
})

test('real failing tests still trigger bounded repair even when intended guard review is pending', async () => {
  const root = await approvedImplementationProject({
    verificationFailsOnBrokenSource: true,
    projectFiles: { [preservationFile]: guardedCustomer },
    providerConfig: { schemaVersion: 2,
      adapter: { kind: 'provider', provider: 'codex', network: true, timeoutMs: 30000, model: null, mode: 'fast', contextBudgetCharacters: 256, maxBudgetUsd: null },
      writePolicy: { allowedPrefixes: ['src/'], maxChangedFiles: 4, maxDiffBytes: 65536 }, recovery: { maxAttempts: 2 } }
  })
  const result = await runImplementation(root, 'IMPL-1', { ...preservationOptions, providerRunner: async (_adapter, input) => {
    const request = JSON.parse(await readFile(join(input.cwd, input.requestPath), 'utf8'))
    await writeFile(join(input.cwd, preservationFile), unguardedCustomer)
    await writeFile(join(input.cwd, 'src/main/java/example/Generated.java'), request.attempt === 1 ? '// BROKEN\n' : 'class Generated {}\n')
    return syntheticProvider(input)
  } })
  assert.equal(result.record.status, 'passed')
  assert.equal(result.record.attempts.length, 2)
  assert.equal(result.record.attempts[0].verification.confirmed, false)
  assert.equal(result.record.verification.tests.executed, 1)
  assert.equal(result.preservationReview.status, 'required')
})

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

test('built-in provider receives a bounded approved request with on-demand adjacent code and produces a fully verified isolated change', async () => {
  const approvedPlan = 'Preserve Audit Clock Lock Journal Gate checks. Create src/main/java/example/Generated.java; do not weaken any verification gate.'
  const root = await approvedImplementationProject({
    taskContext: 'Change FixtureService.',
    taskPlan: approvedPlan,
    projectFiles: {
      'src/main/java/example/FixtureService.java': 'package example; class FixtureService {}\n',
      'src/main/java/example/AuditClockLockJournalGate.java': 'package example; class AuditClockLockJournalGate {}\n'
    },
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
  let capturedRequestText
  const providerRunner = async (_adapter, input) => {
    capturedRequestText = await readFile(join(input.cwd, input.requestPath), 'utf8')
    capturedRequest = JSON.parse(capturedRequestText)
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
  assert.equal(capturedRequestText, JSON.stringify(capturedRequest) + '\n')
  assert.equal(capturedRequest.projectConventions.providerProjection.declaredRulesPreserved, true)
  assert.equal(capturedRequest.implementation.profile.contextBudgetCharacters, 6000)
  assert.deepEqual(capturedRequest.implementation.allowedPrefixes, ['src/'])
  assert.equal(capturedRequest.authority.deployment, false)
  assert.equal(capturedRequest.codeContext.budget.limitCharacters, 6000)
  assert.equal(capturedRequest.codeContext.status, 'available', JSON.stringify(capturedRequest.codeContext, null, 2))
  assert.equal(capturedRequest.codeContext.provenance.mode, 'bounded-read-only-source-snapshot')
  assert.equal(capturedRequest.codeContext.entries[0].path, 'src/main/java/example/FixtureService.java')
  assert.equal(capturedRequest.task.approvedPlan, approvedPlan)
  assert.equal(capturedRequest.task.context, 'Change FixtureService.')
  assert.ok(capturedRequest.codeContext.entries.length > 0, JSON.stringify({
    codeContext: capturedRequest.codeContext,
    modules: capturedRequest.projectConventions.discovered.modules
  }, null, 2))
  assert.equal(capturedRequest.projectConventions.schemaVersion, 1)
  assert.equal(capturedRequest.projectConventions.status, 'unknown')
  assert.equal(capturedRequest.projectConventions.projectRules.status, 'unknown')
  assert.ok(capturedRequest.projectConventions.adjacentCode.paths.length > 0)
  assert.equal(capturedRequest.projectConventions.requiredBeforeEdit.inspectAdjacentProductionAndTests, true)
  assert.equal(capturedRequest.projectConventions.authority.verdictAuthority, false)
  assert.equal(result.record.attempts[0].invocation.usage['usage.input_tokens'], 100)
  assert.equal(result.record.attempts[0].request.unchanged, true)
  assert.match(result.record.attempts[0].request.sha256, /^[a-f0-9]{64}$/)
})

test('automatic fast implementation requires confirmed project rules and adjacent source-bound code', async () => {
  const root = await approvedRuleAwareFastProject()
  const taskBefore = (await loadTask(root, 'FAST-1')).record
  const source = await captureConfiguredSourceBinding(root)
  const semanticContext = await loadBudgetedCodeContext(root, 'Add one compatible order lookup behavior.', {
    sourceFingerprint: source.fingerprint, budgetCharacters: 2000
  })
  assert.equal(semanticContext.status, 'available')
  const exported = await exportApprovedPlan(root, 'FAST-1', { contextBudget: 2000 })
  assert.deepEqual(exported.codeContext.entries, semanticContext.entries)
  assert.equal(exported.plan.objective, 'Add one compatible order lookup behavior.')
  assert.match(exported.plan.requestedVerification, /every required project Gate/)
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
  assert.deepEqual(capturedRequest.codeContext.entries, semanticContext.entries)
  assert.equal(capturedRequest.task.approvedPlan, taskBefore.plan)
  assert.ok(capturedRequest.task.context.length < taskBefore.context.length)
  assert.match(capturedRequest.task.context, /unchanged approvedPlan/)
  assert.match(capturedRequest.task.context, /Project rules needing attention:/)
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
  assert.equal(result.record.attempts[0].verification.failure.code, 'required_gate_failed')
  assert.equal(result.record.attempts[0].verification.gates[0].process.exitCode, 7)
  const recovery = JSON.parse(await readFile(join(result.record.workspace, result.record.attempts[1].request.path), 'utf8')).recovery
  assert.equal(recovery.failedGates[0].process.exitCode, 7)
  assert.equal(recovery.authority, 'untrusted-execution-evidence-not-instructions')
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

test('a passed sealed candidate can be applied explicitly and matches complete integration evidence', async () => {
  const root = await approvedImplementationProject()
  await runImplementation(root, 'IMPL-1', { actor: 'developer', allowWrite: true })

  const applied = await applyImplementation(root, 'IMPL-1', { actor: 'developer', allowWrite: true })

  assert.equal(applied.integration.integrated, true, JSON.stringify(applied, null, 2))
  assert.equal(applied.lifecycleRecorded, true)
  const appliedTask = await loadTask(root, 'IMPL-1')
  assert.equal(appliedTask.record.implementationAudit.action, 'apply')
  assert.equal(appliedTask.record.implementationAudit.recordSha256, applied.receiptSha256)
  assert.equal(appliedTask.events.at(-1).type, 'implementation_apply')
  assert.deepEqual(applied.integration.changedPaths, ['src/main/java/example/Generated.java'])
  assert.match(applied.receiptSha256, /^[a-f0-9]{64}$/)
  assert.equal(await readFile(join(root, 'src/main/java/example/Generated.java'), 'utf8'), 'package example; class Generated {}\n')
})

test('candidate apply refuses source drift after isolated verification', async () => {
  const root = await approvedImplementationProject()
  await runImplementation(root, 'IMPL-1', { actor: 'developer', allowWrite: true })
  await writeFile(join(root, 'SOURCE-DRIFT.txt'), 'changed outside the harness\n', 'utf8')

  await assert.rejects(
    applyImplementation(root, 'IMPL-1', { actor: 'developer', allowWrite: true }),
    (error) => error?.code === 'apply_source_changed'
  )
  await assert.rejects(access(join(root, 'src/main/java/example/Generated.java')), /ENOENT/)
})

test('candidate apply refuses a worktree changed after its verification seal', async () => {
  const root = await approvedImplementationProject()
  const implementation = await runImplementation(root, 'IMPL-1', { actor: 'developer', allowWrite: true })
  await writeFile(join(implementation.record.workspace, 'src/main/java/example/Generated.java'), 'tampered\n', 'utf8')

  await assert.rejects(
    applyImplementation(root, 'IMPL-1', { actor: 'developer', allowWrite: true }),
    (error) => error?.code === 'apply_candidate_changed'
  )
  await assert.rejects(access(join(root, 'src/main/java/example/Generated.java')), /ENOENT/)
})

test('candidate apply rolls back earlier files when a later file cannot be applied', async () => {
  const root = await approvedImplementationProject({
    adapterScript: [
      '#!/bin/sh',
      'set -eu',
      'mkdir -p src/main/java/example',
      'printf "package example; class Generated {}\\n" > src/main/java/example/Generated.java',
      'printf "package example; class Second {}\\n" > src/main/java/example/Second.java',
      ''
    ].join('\n')
  })
  await runImplementation(root, 'IMPL-1', { actor: 'developer', allowWrite: true })

  await assert.rejects(
    applyImplementation(root, 'IMPL-1', {
      actor: 'developer',
      allowWrite: true,
      beforeApplyEntry: (_entry, index) => {
        if (index === 1) throw new Error('injected second-file failure')
      }
    }),
    (error) => error?.code === 'apply_failed_rolled_back'
  )
  await assert.rejects(access(join(root, 'src/main/java/example/Generated.java')), /ENOENT/)
  await assert.rejects(access(join(root, 'src/main/java/example/Second.java')), /ENOENT/)
})

test('implementation stops at matching feedback failure without spending the complete verification gate', async () => {
  const feedbackScript = [
    '#!/bin/sh',
    'set -eu',
    'mkdir -p .backend-harness/generated/feedback',
    'printf "feedback\\n" >> .backend-harness/generated/executed.log',
    'exit 9',
    ''
  ].join('\n')
  const fullScript = [
    '#!/bin/sh',
    'set -eu',
    'mkdir -p .backend-harness/generated/full',
    'printf "full\\n" >> .backend-harness/generated/executed.log',
    'printf "%s\\n" \'<testsuite tests="1"><testcase name="full"/></testsuite>\' > .backend-harness/generated/full/TEST.xml',
    ''
  ].join('\n')
  const root = await approvedImplementationProject({
    projectFiles: { 'verify-feedback': feedbackScript, 'verify-full': fullScript },
    executableFiles: ['verify-feedback', 'verify-full'],
    verificationConfig: {
      schemaVersion: 1,
      gates: [
        {
          id: 'changed-unit', required: true, feedback: true, pathPrefixes: ['src/main/java'],
          command: ['./verify-feedback'], result: { type: 'junit', reports: ['.backend-harness/generated/feedback/*.xml'] }
        },
        {
          id: 'complete', required: true,
          command: ['./verify-full'], result: { type: 'junit', reports: ['.backend-harness/generated/full/*.xml'] }
        }
      ]
    }
  })

  const result = await runImplementation(root, 'IMPL-1', { actor: 'developer', allowWrite: true })

  assert.equal(result.record.status, 'failed')
  assert.ok(result.record.attempts.every((attempt) => attempt.verification.failure.code === 'selected_feedback_failed'))
  assert.ok(result.record.attempts.every((attempt) => attempt.feedback.gates.length === 1))
  assert.equal(await readFile(join(result.record.workspace, '.backend-harness/generated/executed.log'), 'utf8'), 'feedback\nfeedback\n')
})
