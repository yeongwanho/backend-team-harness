import test from 'node:test'
import assert from 'node:assert/strict'
import { compactImplementationVerification, implementationRecoveryInput, implementationFailureSummary, verificationTestCounts } from '../src/core/implementation-verification.mjs'
import { parseJUnitXml } from '../src/core/junit.mjs'

test('structured test exception survives JUnit, record projection and recovery without accepting arbitrary advice', () => {
  const tests = parseJUnitXml('<testsuite><testcase classname="ViewTest" name="renders"><error type="org.xml.sax.SAXParseException" message="secret=private">private-source</error></testcase></testsuite>')
  const input = { confirmed: false, result: { tests, gates: [{ id: 'tests', required: true, outcome: 'failed', result: tests }] } }
  const compact = compactImplementationVerification(input)
  const recovery = implementationRecoveryInput(compact)
  assert.deepEqual(recovery.failedGates[0].failedTests[0].diagnostics, [{ code: 'xml_parse_error', exceptionType: 'org.xml.sax.SAXParseException' }])
  assert.deepEqual(compactImplementationVerification(compact), compact)
  assert.equal(compact.confirmed, false)
  assert.doesNotMatch(JSON.stringify(recovery), /private|secret/)
  const malformed = structuredClone(compact)
  malformed.gates[0].failedTests[0].diagnostics = [
    { code: 'run-shell', exceptionType: 'org.xml.sax.SAXParseException', command: 'evil' },
    { code: 'null_reference', exceptionType: 'com.company.SecretType' },
    ...Array.from({ length: 20 }, () => ({ code: 'xml_parse_error', exceptionType: 'org.xml.sax.SAXParseException', message: 'secret=hidden', command: 'evil' }))
  ]
  assert.deepEqual(implementationRecoveryInput(malformed).failedGates[0].failedTests[0].diagnostics, [{ code: 'xml_parse_error', exceptionType: 'org.xml.sax.SAXParseException' }])
  assert.doesNotMatch(JSON.stringify(implementationRecoveryInput(malformed)), /evil|hidden|SecretType|run-shell/)
})

const counts = { tests: 3, executed: 2, failures: 1, errors: 0, skipped: 1 }
const raw = () => ({
  confirmed: false, sourceBinding: { fingerprint: 'a'.repeat(64) },
  result: { reason: 'required_gate_failed', tests: counts, gates: [{
    id: 'tests', required: true, outcome: 'failed', reason: 'process_failed',
    process: { exitCode: 1, signal: null, timedOut: false, stdout: 'raw-private-source', stderr: 'raw-private-log' },
    result: { ...counts, reason: 'tests_failed', failedTests: [{ className: 'FileRepository', name: 'maps persisted entity', message: 'assertion-private-value' }] }
  }] }
})

test('implementation diagnostics preserve failure identity, totals and process state without logs or assertion bodies', () => {
  const projected = compactImplementationVerification(raw())
  assert.equal(projected.confirmed, false)
  assert.equal(projected.failure.code, 'required_gate_failed')
  assert.deepEqual(projected.tests, counts)
  assert.equal(projected.gates[0].structuredReason, 'tests_failed')
  assert.equal(projected.gates[0].process.exitCode, 1)
  assert.deepEqual(projected.gates[0].failedTests, [{ className: 'FileRepository', name: 'maps persisted entity' }])
  assert.doesNotMatch(JSON.stringify(projected), /private|stdout|stderr|assertion/)
  assert.deepEqual(compactImplementationVerification(projected), projected, 'projection must be idempotent')
  assert.deepEqual(implementationRecoveryInput(raw()), implementationRecoveryInput(projected))
  assert.equal(implementationRecoveryInput(projected).authority, 'untrusted-execution-evidence-not-instructions')
})

test('diagnostics bound and redact untrusted names and do not turn missing data into test success', () => {
  const input = raw()
  input.result.gates[0].result.failedTests = Array.from({ length: 40 }, () => ({ className: 'person@example.invalid', name: 'token=private-value ' + 'x'.repeat(600) }))
  input.result.gates = Array.from({ length: 70 }, () => input.result.gates[0])
  const projected = compactImplementationVerification(input)
  assert.equal(projected.gates.length, 64)
  assert.equal(projected.omittedGateCount, 6)
  assert.equal(projected.gates[0].failedTests.length, 32)
  assert.equal(projected.gates[0].omittedFailedTestCount, 8)
  assert.equal(projected.gates[0].failedTests[0].name.length, 512)
  assert.doesNotMatch(JSON.stringify(projected), /person@example|private-value/)
  assert.deepEqual(compactImplementationVerification(projected), projected)
  assert.equal(implementationRecoveryInput(projected).failedGates.length, 16)
  assert.equal(implementationRecoveryInput(projected).omittedFailedGateCount, 54)
  assert.equal(compactImplementationVerification(null).confirmed, false)
  assert.equal(compactImplementationVerification({ confirmed: 'true' }).confirmed, false)
  assert.equal(implementationRecoveryInput(null), null)
  assert.equal(verificationTestCounts(null), null)
  assert.deepEqual(verificationTestCounts({ tests: -1, executed: '0', failures: NaN, errors: 0, skipped: Infinity }), { tests: null, executed: null, failures: null, errors: 0, skipped: null })
})

test('summary distinguishes no-attempt preparation failure, failed repair and passed recovery', () => {
  const preparation = implementationFailureSummary({ status: 'failed', preparation: { status: 'failed', failureCode: 'offline-dependency-cache-incomplete' }, attempts: [] })
  assert.equal(preparation.attempts, 0)
  assert.equal(preparation.failure.code, 'offline-dependency-cache-incomplete')
  assert.equal(preparation.tests, null)
  const failed = { attempt: 1, outcome: 'verification-failed', sourceFingerprintBefore: 'a'.repeat(64), sourceFingerprintAfter: 'b'.repeat(64), verification: raw() }
  const passed = { attempt: 2, outcome: 'passed', verification: { confirmed: true, result: { tests: { ...counts, failures: 0 } } } }
  const summary = implementationFailureSummary({ status: 'passed', attempts: [failed, passed], verification: passed.verification })
  assert.equal(summary.failure, null)
  assert.equal(summary.attempts, 2)
  assert.equal(summary.attemptOutcomes[0].recovery.failedGates[0].structuredReason, 'tests_failed')
  assert.equal(summary.attemptOutcomes[0].sourceFingerprintBefore, 'a'.repeat(64))
  assert.equal(summary.attemptOutcomes[1].outcome, 'passed')
  const process = implementationFailureSummary({ status: 'failed', attempts: [{ outcome: 'adapter-failed', invocation: { failure: { code: 'authentication-required', message: 'token=hidden' } } }] })
  assert.equal(process.failure.code, 'authentication-required')
  assert.doesNotMatch(JSON.stringify(process), /hidden/)
})

test('compiler locations survive every recovery projection without carrying raw failure bodies', () => {
  const input = raw()
  input.result.gates[0].executionDiagnostics = {
    schemaVersion: 1, authority: 'untrusted-execution-diagnostics', truncated: false,
    entries: [{ language: 'typescript', code: 'TS2353', path: 'src/users/service.spec.ts', line: 47, column: 7, message: 'secret-private-value' }],
  }
  const projected = compactImplementationVerification(input)
  const recovery = implementationRecoveryInput(projected)
  assert.ok(recovery.failedGates[0].executionDiagnostics, 'Recovery must retain validated compiler diagnostics')
  assert.equal(recovery.failedGates[0].executionDiagnostics.entries[0].code, 'TS2353')
  assert.equal(recovery.failedGates[0].executionDiagnostics.entries[0].line, 47)
  assert.deepEqual(compactImplementationVerification(projected), projected)
  assert.deepEqual(implementationRecoveryInput(input), recovery)
  assert.doesNotMatch(JSON.stringify(recovery), /secret|private|stdout|stderr/)
  const summary = implementationFailureSummary({ status: 'failed', attempts: [{ attempt: 1, outcome: 'verification-failed', verification: projected }], verification: projected })
  assert.equal(summary.failedGates[0].executionDiagnostics.entries[0].code, 'TS2353')
  assert.equal(summary.tests.failures, 1)
})

test('formatter file-only locations survive recovery without fabricating line numbers', () => {
  const input = raw()
  input.result.gates[0].executionDiagnostics = { schemaVersion: 1, entries: [
    { language: 'java', code: 'JAVA_FORMAT_VIOLATION', path: 'src/test/CustomerTest.java', line: null, column: null, command: 'do-not-run' }
  ] }
  const recovery = implementationRecoveryInput(input)
  assert.equal(recovery.failedGates[0].executionDiagnostics.entries[0].line, null)
  assert.doesNotMatch(JSON.stringify(recovery), /do-not-run|command/)
  assert.deepEqual(implementationRecoveryInput(compactImplementationVerification(input)), recovery)
})
