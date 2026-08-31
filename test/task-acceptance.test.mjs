import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { parseTaskAcceptance } from '../src/evaluation/provider-benchmark-config.mjs'
import { evaluateTaskAcceptance } from '../src/evaluation/task-acceptance.mjs'
import { parseJUnitXml } from '../src/core/junit.mjs'
import { initializeGit, runGit } from '../test-support/git-project.mjs'

const acceptance = {
  kind: 'target-tests', testPaths: ['test/oracle.mjs'], command: ['./gradlew'],
  reports: ['reports/TEST-oracle.xml'], cases: [{ className: 'Acceptance', name: 'requiredBehavior' }]
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'bth-oracle-fixture-'))
  await mkdir(join(root, 'test'))
  await writeFile(join(root, '.gitignore'), 'reports/\n')
  await writeFile(join(root, 'value.txt'), 'incorrect')
  await writeFile(join(root, 'remove.txt'), 'remove me')
  await writeFile(join(root, 'test/oracle.mjs'), '// old test\n')
  await writeFile(join(root, 'gradlew'), '#!/bin/sh\nexec "' + process.execPath + '" test/oracle.mjs\n')
  await chmod(join(root, 'gradlew'), 0o755)
  await writeFile(join(root, 'gradlew.bat'), '@echo off\r\n"' + process.execPath + '" test/oracle.mjs\r\n')
  initializeGit(root, { forcePaths: ['.gitignore'] })
  const baseSha = runGit(root, ['rev-parse', 'HEAD'])
  await writeFile(join(root, 'value.txt'), 'correct')
  await writeFile(join(root, 'test/oracle.mjs'), [
    "import { mkdir, readFile, writeFile } from 'node:fs/promises'",
    "const passed = (await readFile('value.txt', 'utf8')) === 'correct'",
    "await mkdir('reports', { recursive: true })",
    "await writeFile('reports/TEST-oracle.xml', '<testsuite><testcase classname=\"Acceptance\" name=\"requiredBehavior\">' + (passed ? '' : '<failure/>') + '</testcase></testsuite>')",
    'process.exitCode = passed ? 0 : 1'
  ].join('\n'))
  runGit(root, ['add', '.'])
  runGit(root, ['commit', '-qm', 'behavior with regression'])
  const targetSha = runGit(root, ['rev-parse', 'HEAD'])
  runGit(root, ['checkout', '-q', '--detach', baseSha])
  return { root, input: { mirror: root, task: { baseSha, targetSha }, acceptance, timeoutMs: 10_000 } }
}

test('pinned regression controls and candidate are executed in separate snapshots', async () => {
  const { root, input } = await fixture()
  await writeFile(join(root, 'value.txt'), 'correct')
  await writeFile(join(root, 'extra.txt'), 'candidate untracked file')
  await rm(join(root, 'remove.txt'))
  const before = runGit(root, ['status', '--porcelain=v1'])
  const result = await evaluateTaskAcceptance({ ...input, candidateRoot: root })
  assert.equal(result.controlsConfirmed, true, JSON.stringify(result))
  assert.equal(result.controls.base.regressionReproduced, true)
  assert.equal(result.controls.target.passed, true)
  assert.equal(result.candidatePassed, true)
  assert.equal(result.candidateUntouched, true)
  assert.equal(runGit(root, ['status', '--porcelain=v1']), before)
  assert.equal(await readFile(join(root, 'test/oracle.mjs'), 'utf8'), '// old test\n', 'hidden tests must not overwrite candidate tests')
  assert.match(result.testFiles[0].sha256, /^[a-f0-9]{64}$/)

  await writeFile(join(root, 'value.txt'), 'still wrong')
  const failed = await evaluateTaskAcceptance({ ...input, candidateRoot: root })
  assert.equal(failed.controlsConfirmed, true)
  assert.equal(failed.candidatePassed, false)
  assert.equal(failed.candidate.cases[0].outcome, 'failed')
})

test('control-only run has no candidate success, and missing oracle remains unmeasured', async () => {
  const { input } = await fixture()
  const result = await evaluateTaskAcceptance(input)
  assert.equal(result.controlsConfirmed, true)
  assert.equal(result.candidatePassed, null)
  assert.equal(result.reason, 'candidate-not-provided')
  assert.equal((await evaluateTaskAcceptance({})).reason, 'task-oracle-not-defined')
  await assert.rejects(evaluateTaskAcceptance({ ...input, task: { baseSha: 'HEAD' } }), /full pinned/)
  await assert.rejects(evaluateTaskAcceptance({ ...input, timeoutMs: 0 }), /timeout/)
})

test('Node oracle uses the evaluator runtime for one pinned test file and disallows argument expansion', async () => {
  const { input } = await fixture()
  const nodeOracle = { ...input.acceptance, command: ['node', 'test/oracle.mjs'] }
  const result = await evaluateTaskAcceptance({ ...input, acceptance: nodeOracle })
  assert.equal(result.controlsConfirmed, true)
  for (const command of [['node', '-e', 'process.exit(0)'], ['node', 'test/unpinned.js'], ['node', '--import', 'test/oracle.mjs'], ['node', 'test/oracle.mjs', '--extra']]) {
    assert.throws(() => parseTaskAcceptance({ ...nodeOracle, command }), /one pinned JavaScript/)
  }
})

test('hash-pinned evaluator fixtures validate both controls without exposing tests to the candidate', async (t) => {
  const { root, input } = await fixture()
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'bth-owned-regression-'))
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }))
  const bytes = runGit(root, ['show', input.task.targetSha + ':test/oracle.mjs']) + '\n'
  await writeFile(join(fixtureRoot, 'oracle.mjs'), bytes)
  const owned = {
    kind: 'fixture-tests',
    files: [{ path: 'test/oracle.mjs', fixture: 'oracle.mjs', sha256: createHash('sha256').update(bytes).digest('hex') }],
    command: acceptance.command, reports: acceptance.reports, cases: acceptance.cases
  }
  assert.deepEqual(parseTaskAcceptance(parseTaskAcceptance(owned)), owned, 'parsed config can be revalidated')
  const result = await evaluateTaskAcceptance({ ...input, acceptance: owned, fixtureRoot, candidateRoot: root })
  assert.equal(result.controlsConfirmed, true)
  assert.equal(result.candidatePassed, false)
  assert.equal(result.candidateUntouched, true)
  assert.equal(await readFile(join(root, 'test/oracle.mjs'), 'utf8'), '// old test\n')

  let invoked = false
  const options = { processRunner: async () => { invoked = true; throw new Error('must not execute') } }
  await assert.rejects(evaluateTaskAcceptance({ ...input, acceptance: owned }, options), /fixture root/i)
  await writeFile(join(fixtureRoot, 'oracle.mjs'), '// changed fixture')
  await assert.rejects(evaluateTaskAcceptance({ ...input, acceptance: owned, fixtureRoot }, options), /hash/i)
  await writeFile(join(fixtureRoot, 'oracle.mjs'), 'x'.repeat(1024 * 1024 + 1))
  await assert.rejects(evaluateTaskAcceptance({ ...input, acceptance: owned, fixtureRoot }, options), /bounded regular file/i)
  if (process.platform !== 'win32') {
    await rm(join(fixtureRoot, 'oracle.mjs'))
    await symlink(join(root, 'test/oracle.mjs'), join(fixtureRoot, 'oracle.mjs'))
    await assert.rejects(evaluateTaskAcceptance({ ...input, acceptance: owned, fixtureRoot }, options), /symbolic link|regular file/)
  }
  assert.equal(invoked, false)
})

test('evaluator fixture config refuses production overwrites, duplicate paths, traversal and unpinned files', () => {
  const file = { path: 'test/regression.mjs', fixture: 'fixtures/regression.mjs', sha256: 'a'.repeat(64) }
  const valid = { kind: 'fixture-tests', files: [file], command: acceptance.command, reports: acceptance.reports, cases: acceptance.cases }
  for (const files of [[], [file, file], [{ ...file, path: 'src/main/App.java' }], [{ ...file, path: '.git/test/config' }], [{ ...file, path: 'node_modules/pkg/test/spec.mjs' }], [{ ...file, fixture: '../outside.mjs' }], [{ ...file, sha256: 'HEAD' }], [{ ...file, extra: true }]]) {
    assert.throws(() => parseTaskAcceptance({ ...valid, files }))
  }
  assert.throws(() => parseTaskAcceptance({ ...valid, testPaths: ['test/unpinned.mjs'] }))
  assert.throws(() => parseTaskAcceptance({ ...valid, reports: ['.backend-harness/state.xml'] }))
})

function resultProcess(exitCode = 0, timedOut = false) {
  return { exitCode, signal: null, timedOut, stdioDrainTimedOut: false, durationMs: 1, stdout: { sha256: 'a'.repeat(64), bytes: 0 }, stderr: { sha256: 'b'.repeat(64), bytes: 0 } }
}

test('completed acceptance snapshots are released before the next dependency-heavy stage', async t => {
  const { root, input } = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'value.txt'), 'correct')
  await writeFile(join(root, 'untracked.txt'), 'keep candidate')
  const before = runGit(root, ['status', '--porcelain=v1']), visited = []
  const result = await evaluateTaskAcceptance({ ...input, candidateRoot: root }, { processRunner: async ({ cwd }) => {
    for (const previous of visited) await assert.rejects(lstat(previous), { code: 'ENOENT' })
    visited.push(cwd)
    const base = basename(cwd) === 'base'
    await mkdir(join(cwd, 'reports'), { recursive: true })
    await writeFile(join(cwd, acceptance.reports[0]), '<testsuite><testcase classname="Acceptance" name="requiredBehavior">' + (base ? '<failure/>' : '') + '</testcase></testsuite>')
    return resultProcess(base ? 1 : 0)
  } })
  assert.deepEqual(visited.map(path => basename(path)), ['base', 'target', 'candidate'])
  assert.equal(result.controlsConfirmed, true)
  assert.equal(result.candidatePassed, true)
  for (const path of visited) await assert.rejects(lstat(path), { code: 'ENOENT' })
  assert.equal(runGit(root, ['status', '--porcelain=v1']), before)
  assert.equal(await readFile(join(root, 'untracked.txt'), 'utf8'), 'keep candidate')
})

test('acceptance exceptions release allocated stages without deleting the caller source', async t => {
  const { root, input } = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  let allocated
  const failure = new Error('synthetic stage failure')
  await assert.rejects(evaluateTaskAcceptance(input, { processRunner: async ({ cwd }) => {
    allocated = cwd; throw failure
  } }), error => error === failure)
  await assert.rejects(lstat(allocated), { code: 'ENOENT' })
  assert.equal(await readFile(join(root, 'value.txt'), 'utf8'), 'incorrect')
})

test('pytest/JUnit setup errors cannot count as reproduced behavior even when the target passes', async t => {
  const { root, input } = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const mode of ['selected-setup-error', 'unrelated-setup-error']) {
    const result = await evaluateTaskAcceptance(input, { processRunner: async ({ cwd }) => {
      const base = basename(cwd) === 'base'
      const selected = base ? mode === 'selected-setup-error' ? '<error/>' : '<failure/>' : ''
      const unrelated = base && mode === 'unrelated-setup-error' ? '<testcase classname="Environment" name="setup"><error/></testcase>' : ''
      await mkdir(join(cwd, 'reports'), { recursive: true })
      await writeFile(join(cwd, acceptance.reports[0]), '<testsuite><testcase classname="Acceptance" name="requiredBehavior">' + selected + '</testcase>' + unrelated + '</testsuite>')
      return resultProcess(base ? 1 : 0)
    } })
    assert.equal(result.controls.target.passed, true)
    assert.equal(result.controls.base.regressionReproduced, false, mode)
    assert.equal(result.controlsConfirmed, false, mode)
  }
})

test('compiler exits, absent/skipped/duplicate cases, and source mutation cannot validate controls', async () => {
  const { input } = await fixture()
  for (const mode of ['missing', 'skipped', 'duplicate', 'mutated', 'timeout', 'unrelated-failure', 'malformed']) {
    const result = await evaluateTaskAcceptance(input, { processRunner: async ({ cwd }) => {
      if (mode === 'missing') return resultProcess(1)
      const base = basename(cwd) === 'base'
      const inner = mode === 'skipped' ? '<skipped/>' : base ? '<failure/>' : ''
      const testcase = '<testcase classname="Acceptance" name="requiredBehavior">' + inner + '</testcase>'
      const xml = mode === 'unrelated-failure' ? '<testsuite><testcase name="unrelated"><failure/></testcase></testsuite>' : mode === 'malformed' ? 'not xml' : '<testsuite>' + testcase + (mode === 'duplicate' ? testcase : '') + '</testsuite>'
      await mkdir(join(cwd, 'reports'), { recursive: true })
      await writeFile(join(cwd, acceptance.reports[0]), xml)
      if (mode === 'mutated') await writeFile(join(cwd, 'value.txt'), 'changed by verifier')
      return resultProcess(base ? 1 : 0, mode === 'timeout')
    } })
    assert.equal(result.controlsConfirmed, false, mode)
    assert.equal(result.candidatePassed, null, mode)
  }
})

test('oracle config rejects scope expansion, traversal, wildcard reports, and duplicate cases', () => {
  for (const invalid of [
    { ...acceptance, kind: 'model-opinion' },
    { ...acceptance, testPaths: ['src/main/Production.java'] },
    { ...acceptance, testPaths: ['../test/a.js'] },
    { ...acceptance, reports: ['reports/*.xml'] },
    { ...acceptance, reports: ['reports/output.txt'] },
    { ...acceptance, reports: [] },
    { ...acceptance, cases: [] },
    { ...acceptance, cases: [acceptance.cases[0], acceptance.cases[0]] },
    { ...acceptance, cases: [{ className: '', name: 'x' }] },
    { ...acceptance, unknown: true }
  ]) assert.throws(() => parseTaskAcceptance(invalid))
})

test('named JUnit selections retain outcomes without changing the default parser contract', () => {
  const xml = '<testsuite><testcase classname="A" name="ok"/><testcase classname="A" name="error"><error/></testcase><testcase classname="A" name="skip"><skipped/></testcase></testsuite>'
  assert.equal(parseJUnitXml(xml).selectedTests, undefined)
  const selectedCases = ['ok', 'error', 'skip'].map((name) => ({ className: 'A', name }))
  assert.deepEqual(parseJUnitXml(xml, '<fixture>', { selectedCases }).selectedTests.map((entry) => entry.outcome), ['passed', 'error', 'skipped'])
  assert.throws(() => parseJUnitXml(xml, '<fixture>', { selectedCases: [] }), /selectedCases/)
})

test('oracle refuses candidate symlinks without following them', async (t) => {
  if (process.platform === 'win32') return t.skip('symlink creation requires Windows privileges')
  const { root, input } = await fixture()
  await symlink('/etc/passwd', join(root, 'extra.txt'))
  await assert.rejects(evaluateTaskAcceptance({ ...input, candidateRoot: root }), /symbolic link|regular files/)
})
