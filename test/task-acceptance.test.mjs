import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
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

function resultProcess(exitCode = 0, timedOut = false) {
  return { exitCode, signal: null, timedOut, stdioDrainTimedOut: false, durationMs: 1, stdout: { sha256: 'a'.repeat(64), bytes: 0 }, stderr: { sha256: 'b'.repeat(64), bytes: 0 } }
}

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
