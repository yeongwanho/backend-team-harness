import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { initializeGit, writeGradleFixture } from '../test-support/git-project.mjs'
import { acquireProjectVerificationLock } from '../src/core/project-lock.mjs'
import { advanceTask, createTask, updateTaskPlan } from '../src/core/task-store.mjs'
import { captureConfiguredSourceBinding } from '../src/runtime/backend-harness.mjs'
import { exportApprovedPlan } from '../src/runtime/plan-export.mjs'

const cli = resolve('src/cli.mjs')

function runCli(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' })
}

async function finalizedInterview(root, id = 'PORT-1') {
  await writeGradleFixture(root)
  initializeGit(root)
  assert.equal(runCli(['init', root]).status, 0)
  assert.equal(runCli(['interview', 'start', id, root, '--requirement', 'Add safe lookup.', '--by', 'developer']).status, 0)
  for (const [question, text] of [
    ['acceptance', 'Existing returns 200 and missing returns 404.'],
    ['scope', 'Only users source and tests.'],
    ['data', 'No schema change.'],
    ['verification', 'Required tests and not-found scenario.'],
    ['constraints', 'No public contract rename.']
  ]) {
    assert.equal(runCli(['interview', 'answer', id, root, '--question', question, '--text', text, '--by', 'developer']).status, 0)
  }
  const finalized = runCli(['interview', 'finalize', id, root, '--by', 'developer', '--json'])
  assert.equal(finalized.status, 0, finalized.stderr)
  return JSON.parse(finalized.stdout)
}

test('CLI binds approval to plan.json and exports a provider-neutral approved plan', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-plan-port-'))
  const finalized = await finalizedInterview(root)
  assert.match(finalized.task.planArtifactSha256, /^[a-f0-9]{64}$/)

  const approved = runCli(['task', 'advance', 'PORT-1', 'PLAN_APPROVED', root, '--by', 'reviewer', '--approve'])
  assert.equal(approved.status, 0, approved.stderr || approved.stdout)
  const exported = runCli(['task', 'export-plan', 'PORT-1', root, '--json'])
  assert.equal(exported.status, 0, exported.stderr)
  const contract = JSON.parse(exported.stdout)
  assert.equal(contract.schemaVersion, 1)
  assert.equal(contract.authority.write, false)
  assert.equal(contract.authority.verdict, false)
  assert.equal(contract.plan.taskId, 'PORT-1')
  assert.equal(contract.planDigest, finalized.task.planArtifactSha256)
  assert.equal(contract.codeContext.status, 'unavailable')
})

test('approved plan export includes source-bound budgeted codegraph context when available', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-plan-code-context-'))
  await writeGradleFixture(root)
  await mkdir(join(root, 'src/main/java/orders'), { recursive: true })
  await writeFile(
    join(root, 'src/main/java/orders/OrdersController.java'),
    'package orders;\nimport orders.OrdersService;\nclass OrdersController {}\n',
    'utf8'
  )
  await writeFile(join(root, 'src/main/java/orders/OrdersService.java'), 'package orders;\nclass OrdersService {}\n', 'utf8')
  initializeGit(root)
  assert.equal(runCli(['init', root]).status, 0)
  assert.equal(runCli(['pack', 'install', 'codegraph-advisory', root]).status, 0)
  const checked = runCli(['check', root, '--json'])
  assert.equal(checked.status, 0, checked.stderr || checked.stdout)
  for (const command of [
    ['task', 'create', 'MAP-1', root, '--context', 'Change OrdersController lookup behavior.'],
    ['task', 'advance', 'MAP-1', 'CONTEXT_READY', root, '--by', 'developer'],
    ['task', 'plan', 'MAP-1', root, '--text', 'Inspect OrdersController and its exact project dependencies.', '--by', 'developer'],
    ['task', 'advance', 'MAP-1', 'PLAN_PROPOSED', root, '--by', 'developer'],
    ['task', 'advance', 'MAP-1', 'PLAN_APPROVED', root, '--by', 'reviewer', '--approve']
  ]) {
    const result = runCli(command)
    assert.equal(result.status, 0, result.stderr || result.stdout)
  }

  const exported = runCli(['task', 'export-plan', 'MAP-1', root, '--context-budget', '700', '--json'])
  assert.equal(exported.status, 0, exported.stderr || exported.stdout)
  const contract = JSON.parse(exported.stdout)
  assert.equal(contract.codeContext.status, 'available')
  assert.equal(contract.codeContext.entries[0].path, 'src/main/java/orders/OrdersController.java')
  assert.ok(contract.codeContext.budget.usedCharacters <= 700)
  assert.equal(contract.codeContext.authority.advisory, true)
})

test('CLI refuses approval after canonical plan artifact tampering', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-plan-tamper-'))
  await finalizedInterview(root, 'TAMPER-PLAN')
  const planPath = join(root, '.backend-harness/tasks/TAMPER-PLAN/interview/plan.json')
  const plan = JSON.parse(await readFile(planPath, 'utf8'))
  plan.objective = 'tampered'
  await writeFile(planPath, JSON.stringify(plan, null, 2) + '\n', 'utf8')

  const approved = runCli(['task', 'advance', 'TAMPER-PLAN', 'PLAN_APPROVED', root, '--by', 'reviewer', '--approve'])
  assert.equal(approved.status, 1)
  assert.match(approved.stderr + approved.stdout, /artifact has been altered|artifact stale/)
})

test('CLI refuses to export a not-yet-started plan after source drift', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-plan-export-drift-'))
  await finalizedInterview(root, 'DRIFT-EXPORT')
  const approved = runCli(['task', 'advance', 'DRIFT-EXPORT', 'PLAN_APPROVED', root, '--by', 'reviewer', '--approve'])
  assert.equal(approved.status, 0, approved.stderr || approved.stdout)
  await writeFile(join(root, 'unexpected-source.txt'), 'drift\n', 'utf8')

  const exported = runCli(['task', 'export-plan', 'DRIFT-EXPORT', root, '--json'])
  assert.equal(exported.status, 1)
  assert.match(exported.stderr + exported.stdout, /Source changed since plan approval/)
})

test('CLI diagnose returns failed gates, failed tests, and the sealed rerun command', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-diagnose-'))
  await writeGradleFixture(root, { exitCode: 7, failures: 1 })
  initializeGit(root)
  assert.equal(runCli(['init', root]).status, 0)
  const verificationPath = join(root, '.backend-harness/verification.json')
  const verification = JSON.parse(await readFile(verificationPath, 'utf8'))
  verification.gates.push({
    ...verification.gates[0],
    id: 'after-tests',
    result: {
      ...verification.gates[0].result,
      reports: ['build/test-results/after-tests/**/*.xml']
    }
  })
  await writeFile(verificationPath, JSON.stringify(verification, null, 2) + '\n', 'utf8')
  for (const command of [
    ['task', 'create', 'FAIL-1', root, '--context', 'Known failure'],
    ['task', 'advance', 'FAIL-1', 'CONTEXT_READY', root, '--by', 'developer'],
    ['task', 'plan', 'FAIL-1', root, '--text', 'Run tests.', '--by', 'developer'],
    ['task', 'advance', 'FAIL-1', 'PLAN_PROPOSED', root, '--by', 'developer'],
    ['task', 'advance', 'FAIL-1', 'PLAN_APPROVED', root, '--by', 'reviewer', '--approve']
  ]) {
    const result = runCli(command)
    assert.equal(result.status, 0, result.stderr || result.stdout)
  }
  assert.equal(runCli(['verify', 'FAIL-1', root]).status, 1)

  const diagnosed = runCli(['diagnose', 'FAIL-1', root, '--json'])
  assert.equal(diagnosed.status, 0, diagnosed.stderr)
  const result = JSON.parse(diagnosed.stdout)
  assert.equal(result.taskState, 'VERIFY_FAILED')
  assert.deepEqual(result.rerun, ['bth', 'verify', 'FAIL-1', '.'])
  assert.equal(result.failedGates[0].id, 'tests')
  assert.equal(result.failedGates[1].id, 'after-tests')
  assert.equal(result.failedGates[1].outcome, 'skipped')
  assert.equal(result.failedGates[1].reason, 'required_gate_failed')
  assert.equal(result.failedTests[0].name, 'works-1')
  assert.equal(result.authority, 'ADVISORY')
})

test('approved plan export accepts the compatible 0.7 source fingerprint', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-plan-v07-compat-'))
  await writeGradleFixture(root)
  initializeGit(root)
  assert.equal(runCli(['init', root]).status, 0)
  const source = await captureConfiguredSourceBinding(root)
  assert.match(source.legacyFingerprint, /^[a-f0-9]{64}$/)
  await createTask(root, { id: 'V07-PLAN', context: 'Keep the same source.' })
  await advanceTask(root, 'V07-PLAN', 'CONTEXT_READY', { actor: 'developer' })
  await updateTaskPlan(root, 'V07-PLAN', 'Run the approved change.', {
    actor: 'developer',
    sourceFingerprint: source.legacyFingerprint
  })
  await advanceTask(root, 'V07-PLAN', 'PLAN_PROPOSED', { actor: 'developer' })
  await advanceTask(root, 'V07-PLAN', 'PLAN_APPROVED', {
    actor: 'reviewer',
    approved: true,
    currentSourceFingerprint: source.legacyFingerprint
  })

  const exported = await exportApprovedPlan(root, 'V07-PLAN')

  assert.equal(exported.taskState, 'PLAN_APPROVED')
})

test('approved plan export shares the project verification lock', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-plan-export-lock-'))
  await finalizedInterview(root, 'LOCKED-EXPORT')
  assert.equal(runCli(['task', 'advance', 'LOCKED-EXPORT', 'PLAN_APPROVED', root, '--by', 'reviewer', '--approve']).status, 0)
  const release = await acquireProjectVerificationLock(root)
  try {
    await assert.rejects(
      exportApprovedPlan(root, 'LOCKED-EXPORT', { projectLock: { timeoutMs: 40, retryMs: 5 } }),
      (error) => error.code === 'project_verification_locked'
    )
  } finally {
    await release()
  }
})
