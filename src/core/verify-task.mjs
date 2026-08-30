import { ToolPermissionError } from '../policy/tool-gate.mjs'
import { recordEvidence } from './evidence-store.mjs'
import { implementationIntegrationStatus, loadImplementationRecord } from './implementation-record-store.mjs'
import { recordRun } from './run-record-store.mjs'
import { advanceTask, loadTask } from './task-store.mjs'
import { transitionTaskRecord } from './task-state.mjs'

function verificationOutcome(result) {
  return result?.passed === true && result.tests?.executed > 0
}

function stripOutputTails(result) {
  return {
    ...result,
    gates: result.gates?.map((gate) => gate.process ? {
      ...gate,
      process: {
        ...gate.process,
        stdout: { sha256: gate.process.stdout.sha256, bytes: gate.process.stdout.bytes },
        stderr: { sha256: gate.process.stderr.sha256, bytes: gate.process.stderr.bytes }
      }
    } : gate)
  }
}

export async function verifyTask(inputPath, taskId, options = {}) {
  const registry = options.registry
  if (!registry || typeof registry.execute !== 'function') {
    throw new Error('Verification requires an injected tool registry.')
  }
  const loaded = await loadTask(inputPath, taskId)
  const transitionInput = {
    actor: options.actor ?? 'bth.verify',
    reason: 'Source-bound verification gates started.'
  }
  const preview = transitionTaskRecord(loaded.record, 'VERIFYING', transitionInput)
  if (!preview.applied) {
    const error = new Error('Verification cannot start: ' + preview.audit.reason)
    error.audit = preview.audit
    throw error
  }
  const sourceBinding = options.sourceBinding ?? await options.captureSourceBinding?.()
  if (!sourceBinding?.fingerprint) {
    throw new Error('Verification requires a Git source binding.')
  }
  const implementation = await loadImplementationRecord(loaded.root, taskId)
  if (loaded.record.implementationMode === 'isolated' || implementation.record) {
    if (!implementation.record) {
      throw new Error('Verification cannot start because this task is in isolated implementation mode but has no sealed implementation record. Run `bth implement run` or explicitly reset the failed run first.')
    }
    if (implementation.record.status !== 'passed' || implementation.record.originalBoundSourceUnchanged !== true) {
      const code = implementation.record.verification?.failure?.code ?? 'implementation_not_passed'
      throw new Error('Verification cannot start because the isolated implementation is not certified as passed (' + code + ').')
    }
    const integration = await implementationIntegrationStatus(loaded.root, implementation.record, { currentSourceBinding: sourceBinding })
    if (!integration.integrated) {
      const detail = integration.mismatches?.length ? ' Mismatched paths: ' + integration.mismatches.join(', ') : ''
      throw new Error('Verification cannot start until the passed isolated implementation is integrated into the bound source. ' + integration.reason + detail)
    }
  }
  const started = await advanceTask(loaded.root, taskId, 'VERIFYING', transitionInput)
  if (!started.applied) {
    const error = new Error('Verification cannot start: ' + started.audit.reason)
    error.audit = started.audit
    throw error
  }

  const toolId = options.toolId ?? 'verification.run'
  let result
  try {
    result = await registry.execute(toolId, {}, {
      root: loaded.root,
      task: started.record,
      sourceBinding,
      approval: { network: options.allowNetwork === true, write: false }
    })
  } catch (error) {
    const permissionDenied = error instanceof ToolPermissionError
    const evidence = await recordEvidence(loaded.root, taskId, {
      evidenceTier: 'CONTROL',
      type: permissionDenied ? 'tool_blocked' : 'tool_error',
      toolId,
      outcome: permissionDenied ? 'blocked' : 'failed',
      confirmed: false,
      sourceBinding,
      error: {
        code: error?.code ?? null,
        message: error instanceof Error ? error.message : String(error)
      }
    }, options.evidence)
    const run = await recordRun(loaded.root, taskId, {
      evidenceTier: 'CONTROL',
      confirmed: false,
      sourceBinding,
      evidenceId: evidence.record.id,
      failure: evidence.record.error,
      recordedAt: evidence.record.recordedAt
    })
    const finished = await advanceTask(loaded.root, taskId, permissionDenied ? 'PERMISSION_DENIED' : 'VERIFY_FAILED', {
      actor: 'bth.verify',
      reason: permissionDenied ? 'Permission gate blocked tool execution.' : 'Tool execution failed before a confirmed result.',
      evidence: { id: evidence.record.id, confirmed: false }
    })
    if (!finished.applied) {
      throw new Error('Tool failure could not update task state: ' + finished.audit.reason)
    }
    return { root: loaded.root, confirmed: false, task: finished.record, evidence, run }
  }

  const confirmed = verificationOutcome(result)
  const evidence = await recordEvidence(loaded.root, taskId, {
    evidenceTier: 'EXECUTED',
    type: 'tool_execution',
    toolId,
    outcome: confirmed ? 'confirmed' : 'failed',
    confirmed,
    sourceBinding,
    result: stripOutputTails(result)
  }, options.evidence)
  const run = await recordRun(loaded.root, taskId, {
    evidenceTier: 'EXECUTED',
    confirmed,
    sourceBinding,
    evidenceId: evidence.record.id,
    result,
    recordedAt: evidence.record.recordedAt
  })
  const finished = await advanceTask(loaded.root, taskId, confirmed ? 'VERIFIED' : 'VERIFY_FAILED', {
    actor: 'bth.verify',
    reason: confirmed ? 'Required gates and structured tests passed.' : 'Required gates or structured tests did not pass.',
    evidence: { id: evidence.record.id, confirmed }
  })
  if (!finished.applied) {
    throw new Error('Verification result could not update task state: ' + finished.audit.reason)
  }
  return { root: loaded.root, confirmed, task: finished.record, evidence, run, execution: result }
}
