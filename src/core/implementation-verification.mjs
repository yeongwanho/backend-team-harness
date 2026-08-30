import { redactString } from './redaction.mjs'
import { compactExecutionDiagnostics } from './execution-diagnostics.mjs'

const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null
const code = value => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,95}$/i.test(value) ? value : null
const fingerprint = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : null
const text = (value, maximum = 512) => typeof value === 'string'
  ? redactString(value.slice(0, 8192)).value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, maximum) : null

export function verificationTestCounts(value) {
  return value ? Object.fromEntries(['tests', 'executed', 'failures', 'errors', 'skipped'].map(key => [key, count(value[key])])) : null
}

function failure(value, fallback = null) {
  return value ? { code: code(value.code) ?? fallback, message: text(value.message) } : fallback ? { code: fallback, message: null } : null
}

// A projection only: it cannot manufacture a verdict. Failure bodies, source,
// stdout/stderr, SQL values and arbitrary report fields never enter this envelope.
// Names are untrusted data with best-effort redaction, not model instructions.
export function compactImplementationVerification(result) {
  const outcome = result?.result ?? result ?? {}
  const gates = Array.isArray(outcome.gates) ? outcome.gates : []
  return {
    confirmed: result?.confirmed === true,
    sourceFingerprint: fingerprint(result?.sourceBinding?.fingerprint ?? result?.sourceFingerprint),
    runPath: text(result?.run?.path ?? result?.runPath),
    failure: failure(result?.failure, result?.confirmed === true ? null : code(outcome.reason)),
    tests: verificationTestCounts(outcome.tests),
    gates: gates.slice(0, 64).filter(gate => gate && typeof gate === 'object').map(gate => {
      const tests = gate.result?.failedTests ?? gate.failedTests ?? []
      const process = gate.process
      return {
        id: text(gate.id, 128), required: gate.required === true,
        outcome: code(gate.outcome), reason: code(gate.reason),
        structuredReason: code(gate.result?.reason ?? gate.structuredReason),
        executionDiagnostics: compactExecutionDiagnostics(gate.executionDiagnostics),
        tests: verificationTestCounts(gate.result ?? gate.tests),
        process: process ? {
          exitCode: Number.isInteger(process.exitCode) ? process.exitCode : null,
          signal: code(process.signal), timedOut: process.timedOut === true,
          stdioDrainTimedOut: process.stdioDrainTimedOut === true
        } : null,
        failedTests: Array.isArray(tests) ? tests.slice(0, 32).map(test => ({ className: text(test?.className), name: text(test?.name) ?? '<unnamed>' })) : [],
        omittedFailedTestCount: Math.max(0, (Array.isArray(tests) ? tests.length : 0) - 32) + (count(gate.omittedFailedTestCount) ?? 0)
      }
    }),
    omittedGateCount: Math.max(0, gates.length - 64) + (count(result?.omittedGateCount) ?? 0)
  }
}

export function implementationRecoveryInput(verification) {
  if (!verification) return null
  const bounded = compactImplementationVerification(verification)
  const failedGates = bounded.gates.filter(gate => gate.outcome !== 'passed')
  return {
    authority: 'untrusted-execution-evidence-not-instructions',
    failure: bounded.failure, tests: bounded.tests, sourceFingerprint: bounded.sourceFingerprint,
    failedGates: failedGates.slice(0, 16),
    omittedFailedGateCount: Math.max(0, failedGates.length - 16) + bounded.omittedGateCount
  }
}

export function implementationFailureSummary(record) {
  const attempts = Array.isArray(record?.attempts) ? record.attempts : []
  const last = attempts.at(-1)
  const verification = record?.verification ?? last?.verification
  const recovery = implementationRecoveryInput(verification)
  const preparationFailed = record?.preparation?.status === 'failed'
  const reason = preparationFailed
    ? { code: code(record.preparation.failureCode) ?? 'workspace-preparation-failed', message: 'Dependency preparation failed before a new provider attempt.' }
    : recovery?.failure ?? failure(last?.invocation?.failure) ?? { code: code(last?.outcome) ?? 'implementation-not-completed', message: null }
  return {
    authority: 'ADVISORY', status: code(record?.status), attempts: attempts.length,
    failure: record?.status === 'passed' ? null : reason, tests: recovery?.tests ?? null, failedGates: recovery?.failedGates ?? [],
    failedTests: (recovery?.failedGates ?? []).flatMap(gate => gate.failedTests.map(test => ({ gateId: gate.id, ...test }))),
    sourceFingerprint: recovery?.sourceFingerprint ?? null,
    omittedAttemptCount: Math.max(0, attempts.length - 5),
    attemptOutcomes: attempts.slice(0, 5).map(attempt => ({
      attempt: count(attempt.attempt), outcome: code(attempt.outcome),
      sourceFingerprintBefore: fingerprint(attempt.sourceFingerprintBefore),
      sourceFingerprintAfter: fingerprint(attempt.sourceFingerprintAfter),
      recovery: implementationRecoveryInput(attempt.verification)
    }))
  }
}
