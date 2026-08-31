import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectJUnitResults, parseJUnitXml, snapshotReportFiles } from '../src/core/junit.mjs'

test('JUnit keeps bounded standard exception diagnostics without report messages or stack traces', () => {
  const result = parseJUnitXml('<testsuite><testcase classname="ViewTest" name="renders"><error type="org.xml.sax.SAXParseException; lineNumber: 16" message="token=private-message">private-source-stack</error></testcase></testsuite>')
  assert.deepEqual(result.failedTests[0].diagnostics, [{ code: 'xml_parse_error', exceptionType: 'org.xml.sax.SAXParseException' }])
  assert.doesNotMatch(JSON.stringify(result), /private|token=|lineNumber/)
  assert.equal(result.errors, 1)
  const unknown = parseJUnitXml('<testsuite><testcase name="unknown"><error type="com.company.SecretPolicyException">raw private data</error></testcase></testsuite>')
  assert.deepEqual(unknown.failedTests, [{ className: null, name: 'unknown' }])
  assert.equal(unknown.errors, 1)
})

test('JUnit diagnostic extraction covers flaky and rerun attributes, deduplicates and never trusts body text', () => {
  const result = parseJUnitXml('<testsuite><testcase name="retry"><rerunError type="java.lang.NullPointerException"/><flakyFailure type="java.lang.AssertionError"/><error type="java.lang.NullPointerException"/><system-out>org.xml.sax.SAXParseException</system-out></testcase></testsuite>')
  assert.deepEqual(result.failedTests[0].diagnostics, [
    { code: 'null_reference', exceptionType: 'java.lang.NullPointerException' },
    { code: 'assertion_failure', exceptionType: 'java.lang.AssertionError' }
  ])
  const forged = parseJUnitXml('<testsuite><testcase name="still unknown"><error type="org.xml.sax.SAXParseException.evil" message="org.xml.sax.SAXParseException">org.xml.sax.SAXParseException</error></testcase></testsuite>')
  assert.equal(forged.failedTests[0].diagnostics, undefined)
})

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
    executed: 3,
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
  assert.equal(fresh.executed, 2)
})

test('a deterministic report rewritten by the current command is accepted as fresh', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-junit-touch-'))
  const reports = join(root, 'reports')
  const report = join(reports, 'TEST-example.xml')
  const xml = '<testsuite tests="1"><testcase name="old"/></testsuite>\n'
  await mkdir(reports)
  await writeFile(report, xml, 'utf8')
  const before = await snapshotReportFiles(root, ['reports/*.xml'])

  await new Promise((resolvePromise) => setTimeout(resolvePromise, 5))
  await writeFile(report, xml, 'utf8')
  const result = await collectJUnitResults(root, ['reports/*.xml'], before, { minimumTests: 1 })

  assert.equal(result.passed, true)
  assert.equal(result.reason, null)
})

test('a fresh sibling cannot hide an unchanged JUnit report', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-junit-mixed-'))
  const reports = join(root, 'reports')
  await mkdir(reports)
  await writeFile(join(reports, 'TEST-old.xml'), '<testsuite tests="1"><testcase name="old"/></testsuite>\n', 'utf8')
  const before = await snapshotReportFiles(root, ['reports/*.xml'])
  await writeFile(join(reports, 'TEST-new.xml'), '<testsuite tests="1"><testcase name="new"/></testsuite>\n', 'utf8')

  const result = await collectJUnitResults(root, ['reports/*.xml'], before, { minimumTests: 1 })

  assert.equal(result.executed, 1)
  assert.equal(result.staleReportCount, 1)
  assert.equal(result.passed, false)
  assert.equal(result.reason, 'junit_reports_mixed_freshness')
})

test('report discovery rejects symbolic links before a Gate can follow them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-junit-symlink-'))
  const outside = await mkdtemp(join(tmpdir(), 'bth-junit-outside-'))
  await mkdir(join(root, 'reports'))
  await writeFile(join(outside, 'victim.xml'), '<testsuite/>\n', 'utf8')
  await symlink(join(outside, 'victim.xml'), join(root, 'reports/TEST-victim.xml'))

  await assert.rejects(
    snapshotReportFiles(root, ['reports/*.xml']),
    /symbolic link.*report/i
  )
})

test('report discovery rejects symbolic-link directories under a report tree', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-junit-symlink-dir-'))
  const outside = await mkdtemp(join(tmpdir(), 'bth-junit-outside-dir-'))
  await mkdir(join(root, 'reports'))
  await writeFile(join(outside, 'TEST-victim.xml'), '<testsuite/>\n', 'utf8')
  await symlink(outside, join(root, 'reports/redirect'))

  await assert.rejects(
    snapshotReportFiles(root, ['reports/**/*.xml']),
    /symbolic link.*report/i
  )
})

test('JUnit collection enforces one aggregate report budget', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-junit-budget-'))
  await mkdir(join(root, 'reports'))
  const xml = '<testsuite tests="1"><testcase name="one"/></testsuite>\n'
  await writeFile(join(root, 'reports/TEST-one.xml'), xml, 'utf8')
  await writeFile(join(root, 'reports/TEST-two.xml'), xml, 'utf8')

  await assert.rejects(
    collectJUnitResults(root, ['reports/*.xml'], new Map(), {
      minimumTests: 1,
      maximumAggregateBytes: Buffer.byteLength(xml) + 1
    }),
    /aggregate report.*limit/i
  )
})

test('a narrow TEST glob ignores Maven Failsafe summary metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-junit-failsafe-summary-'))
  const reports = join(root, 'target/failsafe-reports')
  await mkdir(reports, { recursive: true })
  await writeFile(join(reports, 'failsafe-summary.xml'), '<failsafe-summary result="254"/>\n', 'utf8')
  await writeFile(
    join(reports, 'TEST-integration.xml'),
    '<testsuite tests="1"><testcase name="integration"/></testsuite>\n',
    'utf8'
  )

  const result = await collectJUnitResults(
    root,
    ['target/failsafe-reports/TEST-*.xml'],
    new Map(),
    { minimumTests: 1 }
  )

  assert.equal(result.passed, true)
  assert.deepEqual(result.reportFiles, ['target/failsafe-reports/TEST-integration.xml'])
})

test('skipped test cases do not satisfy the executed-test minimum', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-junit-skipped-'))
  const reports = join(root, 'reports')
  await mkdir(reports)
  await writeFile(
    join(reports, 'TEST-skipped.xml'),
    '<testsuite tests="1" skipped="1"><testcase name="disabled"><skipped/></testcase></testsuite>\n',
    'utf8'
  )

  const result = await collectJUnitResults(root, ['reports/*.xml'], new Map(), { minimumTests: 1 })

  assert.equal(result.tests, 1)
  assert.equal(result.executed, 0)
  assert.equal(result.passed, false)
  assert.equal(result.reason, 'minimum_executed_tests_not_met')
})

test('rendered HTML declarations inside inert JUnit logs do not hide testcase failures', () => {
  const xml = [
    '<?display <!DOCTYPE html>?>',
    '<testsuite tests="1" failures="1">',
    '<!-- log example: <!DOCTYPE html> -->',
    '<testcase classname="Visit" name="minimumDate">',
    '<failure message="wrong minimum"/>',
    '<system-out><![CDATA[<!DOCTYPE html><html>Rendered response</html><!ENTITY inert "text">]]></system-out>',
    '</testcase></testsuite>'
  ].join('\n')
  let result
  assert.doesNotThrow(() => {
    result = parseJUnitXml(xml, '<fixture>', { selectedCases: [{ className: 'Visit', name: 'minimumDate' }] })
  })
  assert.equal(result.failures, 1)
  assert.equal(result.selectedTests[0].outcome, 'failed')
  for (const xml of [
    '<!-- inert <!DOCTYPE html> --><!DOCTYPE testsuite SYSTEM "https://example.invalid/external.dtd"><testsuite/>',
    '<testsuite><system-out><![CDATA[inert]]></system-out><!ENTITY x SYSTEM "file:///must-not-read"></testsuite>',
    '<testsuite><system-out><![CDATA[unterminated <!DOCTYPE html></system-out></testsuite>',
    '<testsuite><!-- unterminated <!DOCTYPE html></testsuite>'
  ]) assert.throws(() => parseJUnitXml(xml), /DTD and ENTITY|malformed JUnit XML/)
})

test('CDATA cannot hide a real failure after a literal testcase closing tag', () => {
  const result = parseJUnitXml([
    '<testsuite tests="1" failures="1">',
    '  <testcase classname="A" name="poison">',
    '    <system-out><![CDATA[literal </testcase> text]]></system-out>',
    '    <failure message="real failure"/>',
    '  </testcase>',
    '</testsuite>'
  ].join('\n'))

  assert.equal(result.tests, 1)
  assert.equal(result.executed, 1)
  assert.equal(result.failures, 1)
  assert.deepEqual(result.failedTests, [{ className: 'A', name: 'poison' }])
})

test('malformed XML and DTD input fail closed', () => {
  assert.throws(
    () => parseJUnitXml('<testsuite><testcase name="broken"></testsuite>'),
    /malformed JUnit XML/
  )
  assert.throws(
    () => parseJUnitXml('<!DOCTYPE testsuite [<!ENTITY x "value">]><testsuite/>'),
    /DTD and ENTITY declarations are not allowed/
  )
  assert.throws(
    () => parseJUnitXml('<root><testsuite/><testcase name="outside-suite"/></root>'),
    /document root must be testsuite or testsuites/
  )
})

test('testcase-shaped elements in metadata do not count as executed tests', () => {
  const result = parseJUnitXml([
    '<testsuite tests="0">',
    '  <properties><property name="payload"><testcase name="not-a-test"/></property></properties>',
    '</testsuite>'
  ].join('\n'))

  assert.equal(result.tests, 0)
  assert.equal(result.executed, 0)
})

test('suite-level and retry-flaky failures cannot be hidden by testcase shape', () => {
  const declared = parseJUnitXml('<testsuite tests="1" failures="1"><testcase name="looks-clean"/></testsuite>')
  assert.equal(declared.failures, 1)
  assert.deepEqual(declared.failedTests, [{ className: null, name: '<suite-declared-failure>' }])

  const flaky = parseJUnitXml('<testsuite tests="1"><testcase name="retried"><flakyFailure/></testcase></testsuite>')
  assert.equal(flaky.failures, 1)
  assert.equal(flaky.executed, 1)
})
