import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { initializeGit, writeGradleFixture } from '../test-support/git-project.mjs'
import { acquireProjectVerificationLock } from '../src/core/project-lock.mjs'

const cli = resolve('src/cli.mjs')

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    ...options
  })
}

test('CLI help exposes the actual task and verification commands', () => {
  const result = runCli(['--help'])
  assert.equal(result.status, 0)
  assert.match(result.stdout, /bth task create/)
  assert.match(result.stdout, /bth verify/)
  assert.match(result.stdout, /bth check/)
  assert.match(result.stdout, /bth pack install/)
  assert.match(result.stdout, /bth baseline update/)
  assert.match(result.stdout, /bth interview start/)
  assert.match(result.stdout, /bth intelligence inspect/)
  assert.match(result.stdout, /bth implement run/)
})

test('CLI exposes deterministic project intelligence and evaluated rules', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-cli-intelligence-'))
  await writeGradleFixture(root)
  initializeGit(root)
  assert.equal(runCli(['init', root]).status, 0)

  const inspected = runCli(['intelligence', 'inspect', root, '--json'])
  assert.equal(inspected.status, 0, inspected.stderr || inspected.stdout)
  const result = JSON.parse(inspected.stdout)
  assert.equal(result.intelligence.authority.modelGenerated, false)
  assert.equal(result.intelligence.evaluation.blocking, false)
  assert.ok(result.intelligence.facts.some((fact) => fact.id === 'verification.required-junit-gate.present'))
  assert.ok(result.intelligence.evaluation.results.some((rule) => rule.id === 'required-junit-evidence'))
})

test('CLI runs the native requirement interview through PLAN_PROPOSED', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-cli-interview-'))
  await writeGradleFixture(root)
  initializeGit(root)
  assert.equal(runCli(['init', root]).status, 0)

  const started = runCli([
    'interview', 'start', 'CLI-INT-1', root,
    '--requirement', 'Add a safe lookup.',
    '--by', 'developer',
    '--json'
  ])
  assert.equal(started.status, 0, started.stderr)
  assert.equal(JSON.parse(started.stdout).progress.currentQuestion.id, 'acceptance')

  const answers = [
    ['acceptance', '200 for present and 404 for missing.'],
    ['scope', 'Only users module and tests.'],
    ['data', 'No database change.'],
    ['verification', 'Unit and integration tests.'],
    ['constraints', 'No API rename.']
  ]
  for (const [question, text] of answers) {
    const answered = runCli([
      'interview', 'answer', 'CLI-INT-1', root,
      '--question', question,
      '--text', text,
      '--by', 'developer'
    ])
    assert.equal(answered.status, 0, answered.stderr || answered.stdout)
  }

  const finalized = runCli(['interview', 'finalize', 'CLI-INT-1', root, '--by', 'developer', '--json'])
  assert.equal(finalized.status, 0, finalized.stderr || finalized.stdout)
  assert.equal(JSON.parse(finalized.stdout).task.state, 'PLAN_PROPOSED')

  await writeFile(join(root, 'source-drift.txt'), 'changed after planning\n', 'utf8')
  const staleApproval = runCli([
    'task', 'advance', 'CLI-INT-1', 'PLAN_APPROVED', root,
    '--by', 'reviewer',
    '--approve'
  ])
  assert.equal(staleApproval.status, 1)
  assert.match(staleApproval.stdout, /approved_plan_source_stale/)
})

test('CLI check provides a one-command local verification loop', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-cli-check-'))
  await writeGradleFixture(root)
  initializeGit(root)
  assert.equal(runCli(['init', root]).status, 0)

  const checked = runCli(['check', root, '--json'])

  assert.equal(checked.status, 0, checked.stderr || checked.stdout)
  const result = JSON.parse(checked.stdout)
  assert.equal(result.confirmed, true)
  assert.equal(result.result.tests.tests, 1)
  assert.doesNotMatch(checked.stdout, /synthetic output that must not be copied|synthetic error/)
  assert.match(result.result.gates[0].process.stdout.sha256, /^[a-f0-9]{64}$/)
  assert.equal('tail' in result.result.gates[0].process.stdout, false)
  const localRecord = JSON.parse(await readFile(join(root, result.run.path), 'utf8'))
  assert.equal(localRecord.taskId, null)
  assert.deepEqual(localRecord.rerun, ['bth', 'check', '.'])
})

test('CLI task mutations share the verification lock', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-cli-task-project-lock-'))
  await writeGradleFixture(root)
  initializeGit(root)
  assert.equal(runCli(['init', root]).status, 0)
  const release = await acquireProjectVerificationLock(root)
  const child = spawn(process.execPath, [cli, 'task', 'create', 'LOCKED-1', root, '--context', 'Known'], {
    encoding: 'utf8'
  })
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const completed = new Promise((resolvePromise) => child.once('close', (code) => resolvePromise(code)))

  await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  await assert.rejects(access(join(root, '.backend-harness/tasks/LOCKED-1')))
  await release()

  assert.equal(await completed, 0, stderr)
  await access(join(root, '.backend-harness/tasks/LOCKED-1/task.json'))
})

test('CLI refuses implicit force overwrite in the current directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-cli-force-'))
  await writeFile(join(root, 'build.gradle.kts'), 'plugins { java }\n', 'utf8')

  const result = runCli(['init', '--force'], {
    cwd: root,
    encoding: 'utf8'
  })

  assert.equal(result.status, 1)
  assert.match(result.stderr, /requires an explicit project path/)
})

test('CLI drives one approved task through real guarded verification', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-cli-flow-'))
  await writeGradleFixture(root)
  initializeGit(root)

  const commands = [
    ['init', root],
    ['task', 'create', 'CLI-1', root, '--context', 'Synthetic requirement'],
    ['task', 'advance', 'CLI-1', 'CONTEXT_READY', root, '--by', 'developer'],
    ['task', 'plan', 'CLI-1', root, '--text', 'Run the fixed test wrapper.', '--by', 'developer'],
    ['task', 'advance', 'CLI-1', 'PLAN_PROPOSED', root, '--by', 'developer'],
    ['task', 'advance', 'CLI-1', 'PLAN_APPROVED', root, '--by', 'reviewer', '--approve'],
    ['task', 'advance', 'CLI-1', 'IMPLEMENTING', root, '--by', 'developer'],
    ['verify', 'CLI-1', root]
  ]

  for (const command of commands) {
    const result = runCli(command)
    assert.equal(result.status, 0, result.stderr || result.stdout)
  }

  const status = runCli(['task', 'status', 'CLI-1', root, '--json'])
  assert.equal(status.status, 0, status.stderr)
  assert.equal(JSON.parse(status.stdout).record.state, 'VERIFIED')

  const done = runCli(['task', 'advance', 'CLI-1', 'DONE', root, '--by', 'developer'])
  assert.equal(done.status, 0, done.stderr)
})
