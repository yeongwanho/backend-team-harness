import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectJUnitResults, parseJUnitXml, snapshotReportFiles } from '../src/core/junit.mjs'

test('JUnit parser counts executed, failed, errored, and skipped test cases', () => {
  const result = parseJUnitXml([
    '<testsuite tests="4" failures="1" errors="1" skipped="1">',
    '  <testcase classname="A" name="pass"/>',
    '  <testcase classname="A" name="fail"><failure/></testcase>',
    '  <testcase classname="A" name="error"><error/></testcase>',
    '  <testcase classname="A" name="skip"><skipped/></testcase>',
    '</testsuite>'
  ].join('\n'))

  assert.deepEqual(result, {
    tests: 4,
    failures: 1,
    errors: 1,
    skipped: 1,
    failedTests: [
      { className: 'A', name: 'fail' },
      { className: 'A', name: 'error' }
    ]
  })
})

test('only reports created or changed by the current gate can confirm tests', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-junit-fresh-'))
  const reports = join(root, 'reports')
  const report = join(reports, 'TEST-example.xml')
  await mkdir(reports)
  await writeFile(report, '<testsuite tests="1"><testcase name="old"/></testsuite>\n', 'utf8')
  const before = await snapshotReportFiles(root, ['reports/*.xml'])

  const stale = await collectJUnitResults(root, ['reports/*.xml'], before, { minimumTests: 1 })
  assert.equal(stale.passed, false)
  assert.equal(stale.reason, 'junit_reports_stale')

  await writeFile(report, '<testsuite tests="2"><testcase name="one"/><testcase name="two"/></testsuite>\n', 'utf8')
  const fresh = await collectJUnitResults(root, ['reports/*.xml'], before, { minimumTests: 2 })
  assert.equal(fresh.passed, true)
  assert.equal(fresh.tests, 2)
})
