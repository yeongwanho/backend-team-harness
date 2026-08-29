import { loadLatestTaskRun } from '../core/run-record-store.mjs'
import { loadTask } from '../core/task-store.mjs'

function compactFailure(gate) {
  return {
    id: gate.id,
    required: gate.required,
    outcome: gate.outcome,
    reason: gate.reason ?? gate.result?.error ?? null,
    exitCode: gate.process?.exitCode ?? null,
    resultType: gate.result?.type ?? null
  }
}

export async function diagnoseTaskFailure(inputPath, taskId) {
  const task = await loadTask(inputPath, taskId)
  const latest = await loadLatestTaskRun(task.root, taskId)
  if (latest.record.verdict !== 'failed') {
    throw new Error('Latest task run did not fail; there is no failed run to diagnose.')
  }
  const failedGates = latest.record.gates
    .filter((gate) => gate.outcome === 'failed' || gate.outcome === 'blocked')
    .map(compactFailure)
  const failedTests = latest.record.gates.flatMap((gate) => (gate.result?.failedTests ?? []).map((test) => ({
    gateId: gate.id,
    ...test
  })))
  const failure = latest.record.failure ?? null
  const nextActions = [
    failure
      ? 'Resolve the pre-execution control failure before retrying: ' + failure.message
      : 'Inspect the failed Gate and test names; reproduce only with the sealed rerun command.',
    task.record.state === 'VERIFY_FAILED'
      ? 'Return the task to IMPLEMENTING before changing code, then preserve the approval boundary.'
      : 'Resolve the current task state before another verification attempt.',
    'After the fix, run exactly: ' + latest.record.rerun.join(' ')
  ]
  return {
    schemaVersion: 1,
    taskId,
    taskState: task.record.state,
    evidenceTier: latest.record.evidenceTier,
    failedGates,
    failedTests,
    failure,
    rerun: latest.record.rerun,
    nextActions,
    runRecord: latest.path,
    authority: 'ADVISORY'
  }
}
