import { createHash } from 'node:crypto'

const EMPTY = { sha256: createHash('sha256').update('').digest('hex'), bytes: 0, tail: '' }

// Evaluation-only envelope. Provider time excludes harness gates and evaluator
// checks, which remain separately timed. Dollar enforcement is Claude's CLI cap,
// not an OS/network/security boundary or a promise that a provider never overruns.
export function createWorkflowBudget({ provider, timeoutMs, maxBudgetUsd = null, clock = () => performance.now() }) {
  if (!['codex', 'claude'].includes(provider) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 ||
      (maxBudgetUsd !== null && (!Number.isFinite(maxBudgetUsd) || maxBudgetUsd <= 0))) throw new Error('Invalid workflow provider budget.')
  const dollarLimit = provider === 'claude' ? maxBudgetUsd : null
  let elapsedMs = 0, invocations = 0, deniedInvocations = 0, cost = 0, costKnown = true
  return {
    async run(runner, adapter, input, options) {
      if (adapter.provider !== provider) throw new Error('Workflow provider differs from its budget.')
      const remainingMs = Math.max(0, Math.floor(timeoutMs - elapsedMs))
      const remainingUsd = dollarLimit === null ? null : costKnown ? Math.max(0, dollarLimit - cost) : null
      const failureCode = dollarLimit !== null && !costKnown ? 'workflow-provider-cost-unknown'
        : remainingMs < 1 || (remainingUsd !== null && remainingUsd < 0.000001) ? 'workflow-provider-budget-exhausted' : null
      if (failureCode) {
        deniedInvocations++
        return {
          process: { exitCode: null, signal: null, timedOut: true, stdioDrainTimedOut: false, durationMs: 0, stdout: { ...EMPTY }, stderr: { ...EMPTY } },
          metadata: { kind: 'provider', provider, providerStarted: false, version: options?.version ?? null,
            failure: { code: failureCode, message: 'No provider was started because the shared workflow allowance cannot safely fund another call.' } }
        }
      }
      const started = clock()
      invocations++
      let result
      try {
        result = await runner({ ...adapter, timeoutMs: Math.min(adapter.timeoutMs, remainingMs),
          maxBudgetUsd: remainingUsd }, input, options)
        return result
      } finally {
        elapsedMs += Math.max(0, clock() - started)
        const observedCost = result?.metadata?.usage?.costUsd
        if (typeof observedCost === 'number' && Number.isFinite(observedCost) && observedCost >= 0) cost += observedCost
        else costKnown = false
      }
    },
    snapshot() {
      return { schemaVersion: 1, provider, timeoutMs, measuredProviderWallMs: elapsedMs, invocations, deniedInvocations,
        maxBudgetUsd: dollarLimit, reportedCostUsd: costKnown && invocations > 0 ? cost : null,
        dollarLimitEnforced: dollarLimit !== null, scope: 'provider-calls-only; excludes harness verification and acceptance' }
    }
  }
}
