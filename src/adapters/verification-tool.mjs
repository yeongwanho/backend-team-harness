import { loadVerificationConfig, resolveGateExecutable } from '../config/verification.mjs'
import { collectJUnitResults, snapshotReportFiles } from '../core/junit.mjs'
import { runProcess } from '../core/process-runner.mjs'

function processPassed(result) {
  return result.exitCode === 0 && result.signal === null && result.timedOut === false
}

function emptyTestSummary() {
  return { tests: 0, failures: 0, errors: 0, skipped: 0 }
}

function addTests(target, source) {
  target.tests += source.tests
  target.failures += source.failures
  target.errors += source.errors
  target.skipped += source.skipped
}

export function createVerificationTool(options = {}) {
  const processRunner = options.processRunner ?? runProcess
  const sourceBinder = options.captureSourceBinding
  return Object.freeze({
    id: 'verification.run',
    description: 'Run project-declared verification gates and ingest structured test results.',
    allowedStates: ['VERIFYING'],
    network: false,
    mutatesSource: false,
    async execute(_invocation, context) {
      const loaded = await loadVerificationConfig(context.root)
      const gateResults = []
      const tests = emptyTestSummary()
      let blocked = false

      for (const gate of loaded.config.gates) {
        if (blocked) {
          gateResults.push({
            id: gate.id,
            required: gate.required,
            outcome: 'skipped',
            reason: 'required_gate_failed'
          })
          continue
        }

        const executable = await resolveGateExecutable(context.root, gate.command)
        const reportSnapshot = gate.result.type === 'junit'
          ? await snapshotReportFiles(context.root, gate.result.reports)
          : null
        const processResult = await processRunner({
          program: executable.path,
          args: gate.command.slice(1),
          cwd: context.root,
          timeoutMs: gate.timeoutMs
        })

        let structuredResult = null
        let reason = processPassed(processResult) ? null :
          processResult.timedOut ? 'process_timed_out' :
            processResult.signal ? 'process_signalled' : 'process_failed'
        if (gate.result.type === 'junit') {
          try {
            structuredResult = await collectJUnitResults(
              context.root,
              gate.result.reports,
              reportSnapshot,
              { minimumTests: gate.result.minimumTests }
            )
            if (gate.required) {
              addTests(tests, structuredResult)
            }
            reason ??= structuredResult.reason
          } catch (error) {
            reason ??= 'junit_parse_failed'
            structuredResult = {
              ...emptyTestSummary(),
              passed: false,
              reason: 'junit_parse_failed',
              error: error instanceof Error ? error.message : String(error),
              reportFiles: [],
              staleReportCount: 0,
              minimumTests: gate.result.minimumTests
            }
          }
        }

        const passed = reason === null
        gateResults.push({
          id: gate.id,
          required: gate.required,
          command: [executable.displayPath, ...gate.command.slice(1)],
          outcome: passed ? 'passed' : 'failed',
          reason,
          process: processResult,
          result: structuredResult
        })
        if (gate.required && !passed) {
          blocked = true
        }
      }

      const postSourceBinding = sourceBinder ? await sourceBinder() : null
      const sourceStable = !postSourceBinding ||
        !context.sourceBinding ||
        postSourceBinding.fingerprint === context.sourceBinding.fingerprint
      const requiredGates = gateResults.filter((gate) => gate.required)
      const gatesPassed = requiredGates.length > 0 && requiredGates.every((gate) => gate.outcome === 'passed') && tests.tests > 0
      const passed = gatesPassed && sourceStable
      return {
        adapter: 'configured-verification',
        configuration: loaded.source,
        passed,
        reason: !sourceStable ? 'source_changed_during_run' : gatesPassed ? null : 'required_gate_failed',
        sourceStable,
        postSourceFingerprint: postSourceBinding?.fingerprint ?? null,
        tests,
        gates: gateResults
      }
    }
  })
}
