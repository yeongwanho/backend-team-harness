import test from 'node:test'
import assert from 'node:assert/strict'
import { compactImplementationVerification, implementationRecoveryInput, implementationFailureSummary, verificationTestCounts } from '../src/core/implementation-verification.mjs'

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
