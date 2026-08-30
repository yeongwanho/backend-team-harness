import { loadVerificationConfig, resolveGateExecutable } from '../config/verification.mjs'
import { clearReportFiles, collectJUnitResults, snapshotReportFiles } from '../core/junit.mjs'
import { runProcess } from '../core/process-runner.mjs'
import { extractExecutionDiagnostics } from '../core/execution-diagnostics.mjs'
import { captureToolchain } from '../core/toolchain.mjs'
import { collectFindingsResults } from '../core/findings.mjs'
import { ToolPermissionError } from '../policy/tool-gate.mjs'
import { buildGateSchedule } from '../core/gate-scheduler.mjs'
import { loadGateHistory, recordGateObservations } from '../core/gate-history-store.mjs'

function processPassed(result) {
  return result.exitCode === 0 && result.signal === null && result.timedOut === false && result.stdioDrainTimedOut !== true
}

function emptyTestSummary() {
  return { tests: 0, executed: 0, failures: 0, errors: 0, skipped: 0 }
}

function addTests(target, source) {
  target.tests += source.tests
  target.executed += source.executed
  target.failures += source.failures
  target.errors += source.errors
  target.skipped += source.skipped
}

function changedPathMatchesPrefix(path, prefix) {
  return path === prefix || path.startsWith(prefix.endsWith('/') ? prefix : prefix + '/')
}

export function selectVerificationGates(gates, scope = { mode: 'full' }) {
  if (scope?.mode !== 'feedback') return [...gates]
  const changedPaths = Array.isArray(scope.changedPaths) ? scope.changedPaths : []
  const selectedIds = new Set(gates
    .filter((gate) => gate.feedback === true)
    .filter((gate) => {
      const prefixes = Array.isArray(gate.pathPrefixes) ? gate.pathPrefixes : []
      return prefixes.length === 0 || changedPaths.some((path) => prefixes.some((prefix) => changedPathMatchesPrefix(path, prefix)))
    })
    .map((gate) => gate.id))
  const byId = new Map(gates.map((gate) => [gate.id, gate]))
  const includeDependencies = (id) => {
    const gate = byId.get(id)
    for (const dependency of gate?.dependsOn ?? []) {
      if (!selectedIds.has(dependency)) {
        selectedIds.add(dependency)
        includeDependencies(dependency)
      }
    }
  }
  for (const id of [...selectedIds]) includeDependencies(id)
  return gates.filter((gate) => selectedIds.has(gate.id))
}

export function createVerificationTool(options = {}) {
  const processRunner = options.processRunner ?? runProcess
  const sourceBinder = options.captureSourceBinding
  return Object.freeze({
    id: 'verification.run',
    description: 'Run project-declared verification gates and ingest structured test results.',
    allowedStates: ['CHECKING', 'VERIFYING'],
    network: false,
    mutatesSource: false,
    async execute(_invocation, context) {
      if (typeof sourceBinder !== 'function' || typeof context.sourceBinding?.fingerprint !== 'string') {
        throw new Error('Verification requires pre-run and post-run Git source binding.')
      }
      const loaded = await loadVerificationConfig(context.root)
      const scope = context.verificationScope?.mode === 'feedback'
        ? { mode: 'feedback', changedPaths: context.verificationScope.changedPaths ?? [] }
        : { mode: 'full', changedPaths: [] }
      const scopedGates = selectVerificationGates(loaded.config.gates, scope)
      const networkGate = scopedGates.find((gate) => gate.network)
      if (networkGate && context.approval?.network !== true) {
        throw new ToolPermissionError(
          'network_approval_required',
          'Gate ' + networkGate.id + ' may use the network. Re-run with --acknowledge-network-risk; BTH does not isolate operating-system egress.'
        )
      }
      const toolchain = await captureToolchain(context.root, loaded.config)
      const gateHistory = await loadGateHistory(context.root)
      const schedule = buildGateSchedule(scopedGates, gateHistory.entries, loaded.config.scheduling)
      const gateResults = []
      const observations = []
      const outcomes = new Map()
      const tests = emptyTestSummary()
      const executionBatches = []
      let blocked = false

      async function executeGate(gate) {
        const executable = await resolveGateExecutable(context.root, gate.command)
        let reportSnapshot = null
        if (gate.result.type !== 'exit-code') {
          await clearReportFiles(context.root, gate.result.reports)
          reportSnapshot = await snapshotReportFiles(context.root, gate.result.reports)
        }
        const processResult = await processRunner({
          program: executable.path,
          args: gate.command.slice(1),
          cwd: context.root,
          timeoutMs: gate.timeoutMs
        })

        let structuredResult = null
        let reason = processPassed(processResult) ? null :
          processResult.timedOut ? 'process_timed_out' :
            processResult.stdioDrainTimedOut ? 'process_stdio_drain_timed_out' :
              processResult.signal ? 'process_signalled' : 'process_failed'
        if (gate.result.type === 'junit') {
          try {
            structuredResult = await collectJUnitResults(
              context.root,
              gate.result.reports,
              reportSnapshot,
              { minimumTests: gate.result.minimumTests }
            )
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
        } else if (gate.result.type === 'findings' || gate.result.type === 'observation') {
          try {
            structuredResult = await collectFindingsResults(
              context.root,
              gate.result.reports,
              reportSnapshot,
              { type: gate.result.type, blockingSeverities: gate.result.blockingSeverities }
            )
            reason ??= structuredResult.reason
          } catch (error) {
            reason ??= 'findings_parse_failed'
            structuredResult = {
              type: gate.result.type,
              evidenceTier: 'REPORTED',
              passed: false,
              reason: 'findings_parse_failed',
              error: error instanceof Error ? error.message : String(error),
              findings: [],
              counts: {},
              blockingCount: 0,
              reportFiles: [],
              reportDigests: [],
              staleReportCount: 0,
              tools: [],
              metrics: {}
            }
          }
        }

        const passed = reason === null
        return {
          gate,
          passed,
          testResult: gate.required && gate.result.type === 'junit' ? structuredResult : null,
          observation: { gate, outcome: passed ? 'passed' : 'failed', durationMs: processResult.durationMs },
          result: {
            id: gate.id,
            required: gate.required,
            network: gate.network,
            command: [executable.displayPath, ...gate.command.slice(1)],
            outcome: passed ? 'passed' : 'failed',
            reason,
            evidenceTier: gate.result.type === 'junit' || gate.result.type === 'exit-code' ? 'EXECUTED' : 'REPORTED',
            process: processResult,
            executionDiagnostics: passed ? null : await extractExecutionDiagnostics(processResult, context.root),
            result: structuredResult
          }
        }
      }

      for (let cursor = 0; cursor < schedule.gates.length;) {
        const gate = schedule.gates[cursor]
        if (blocked) {
          const skipped = {
            id: gate.id,
            required: gate.required,
            outcome: 'skipped',
            reason: 'required_gate_failed'
          }
          gateResults.push(skipped)
          outcomes.set(gate.id, skipped.outcome)
          cursor += 1
          continue
        }
        const failedDependency = (gate.dependsOn ?? []).find((dependency) => outcomes.get(dependency) !== 'passed')
        if (failedDependency) {
          const skipped = {
            id: gate.id,
            required: gate.required,
            outcome: 'skipped',
            reason: 'dependency_failed',
            dependency: failedDependency
          }
          gateResults.push(skipped)
          outcomes.set(gate.id, skipped.outcome)
          if (gate.required) blocked = true
          cursor += 1
          continue
        }

        const batch = [gate]
        const resources = new Set([gate.resourceClass])
        if (loaded.config.scheduling.maxParallel > 1 && gate.parallelSafe) {
          for (let next = cursor + 1; next < schedule.gates.length && batch.length < loaded.config.scheduling.maxParallel; next += 1) {
            const candidate = schedule.gates[next]
            if (!candidate.parallelSafe || resources.has(candidate.resourceClass)) break
            const batchIds = new Set(batch.map((entry) => entry.id))
            if ((candidate.dependsOn ?? []).some((dependency) => batchIds.has(dependency) || outcomes.get(dependency) !== 'passed')) break
            batch.push(candidate)
            resources.add(candidate.resourceClass)
          }
        }
        executionBatches.push({
          ids: batch.map((entry) => entry.id),
          parallel: batch.length > 1,
          resourceClasses: batch.map((entry) => entry.resourceClass)
        })
        // Wait for every process in a parallel batch to settle before releasing the
        // project lock. Promise.all would reject early and could leave a sibling
        // Gate running against the project after the caller had already returned.
        const settled = await Promise.allSettled(batch.map(executeGate))
        const rejected = settled.find((entry) => entry.status === 'rejected')
        if (rejected) throw rejected.reason
        const executed = settled.map((entry) => entry.value)
        for (const entry of executed) {
          gateResults.push(entry.result)
          outcomes.set(entry.gate.id, entry.result.outcome)
          observations.push(entry.observation)
          if (entry.testResult) addTests(tests, entry.testResult)
          if (entry.gate.required && !entry.passed) blocked = true
        }
        cursor += batch.length
      }

      const postSourceBinding = await sourceBinder()
      if (typeof postSourceBinding?.fingerprint !== 'string') {
        throw new Error('Post-run Git source binding is missing.')
      }
      const sourceStable = postSourceBinding.fingerprint === context.sourceBinding.fingerprint
      const requiredGates = gateResults.filter((gate) => gate.required)
      const gatesPassed = scope.mode === 'feedback'
        ? gateResults.every((gate) => gate.outcome === 'passed')
        : requiredGates.length > 0 && requiredGates.every((gate) => gate.outcome === 'passed') && tests.executed > 0
      const passed = gatesPassed && sourceStable
      let historyUpdate
      if (!sourceStable) {
        historyUpdate = {
          status: gateHistory.status,
          path: gateHistory.path,
          updated: false,
          entryCount: gateHistory.entries.length,
          diagnostic: 'history not updated because source changed during verification.'
        }
      } else {
        try {
          const recorded = await recordGateObservations(context.root, gateHistory, observations)
          historyUpdate = {
            status: recorded.status,
            path: recorded.path,
            updated: recorded.updated,
            entryCount: recorded.entries.length,
            diagnostic: recorded.diagnostic
          }
        } catch (error) {
          historyUpdate = {
            status: gateHistory.status,
            path: gateHistory.path,
            updated: false,
            entryCount: gateHistory.entries.length,
            diagnostic: 'history update failed: ' + (error instanceof Error ? error.message : String(error))
          }
        }
      }
      return {
        adapter: 'configured-verification',
        configuration: loaded.source,
        scope: {
          mode: scope.mode,
          changedPaths: scope.changedPaths.slice(0, 4096),
          selectedGateIds: scopedGates.map((gate) => gate.id)
        },
        evidenceTier: 'EXECUTED',
        networkPolicy: {
          declaredNetworkGate: scopedGates.some((gate) => gate.network),
          riskAcknowledged: context.approval?.network === true,
          egressIsolation: 'not-enforced'
        },
        toolchain,
        passed,
        reason: !sourceStable ? 'source_changed_during_run' : gatesPassed ? null : 'required_gate_failed',
        sourceStable,
        postSourceFingerprint: postSourceBinding?.fingerprint ?? null,
        scheduling: {
          ...schedule.decision,
          maxParallel: loaded.config.scheduling.maxParallel,
          executionBatches,
          history: historyUpdate
        },
        tests,
        reported: gateResults
          .filter((gate) => gate.evidenceTier === 'REPORTED')
          .map((gate) => ({
            gateId: gate.id,
            outcome: gate.outcome,
            reason: gate.reason,
            counts: gate.result?.counts ?? {},
            blockingCount: gate.result?.blockingCount ?? 0,
            metrics: gate.result?.metrics ?? {}
          })),
        gates: gateResults
      }
    }
  })
}
