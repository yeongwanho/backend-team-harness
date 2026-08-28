import { ToolPermissionError } from '../policy/tool-gate.mjs'
import { recordEvidence } from './evidence-store.mjs'
import { advanceTask, loadTask } from './task-store.mjs'

function verificationOutcome(result) {
  return result.exitCode === 0 && result.signal === null && result.timedOut === false
}

export async function verifyTask(inputPath, taskId, options = {}) {
  const registry = options.registry
  if (!registry || typeof registry.execute !== 'function') {
    throw new Error('Verification requires an injected tool registry.')
  }
  const loaded = await loadTask(inputPath, taskId)
  const started = await advanceTask(loaded.root, taskId, 'VERIFYING', {
    actor: options.actor ?? 'bth.verify',
    reason: 'Deterministic build verification started.'
  })
  if (!started.applied) {
    const error = new Error('Verification cannot start: ' + started.audit.reason)
    error.audit = started.audit
    throw error
  }

  const toolId = options.toolId ?? 'build.test'
  let result
  try {
    result = await registry.execute(toolId, {}, {
      root: loaded.root,
      task: started.record,
      approval: { network: false, write: false }
    })
  } catch (error) {
    const permissionDenied = error instanceof ToolPermissionError
    const evidence = await recordEvidence(loaded.root, taskId, {
      type: permissionDenied ? 'tool_blocked' : 'tool_error',
      toolId,
      outcome: permissionDenied ? 'blocked' : 'failed',
      confirmed: false,
      error: {
        code: error?.code ?? null,
        message: error instanceof Error ? error.message : String(error)
      }
    }, options.evidence)
    const finished = await advanceTask(loaded.root, taskId, permissionDenied ? 'PERMISSION_DENIED' : 'VERIFY_FAILED', {
      actor: 'bth.verify',
      reason: permissionDenied ? 'Permission gate blocked tool execution.' : 'Tool execution failed before a confirmed result.',
      evidence: { id: evidence.record.id, confirmed: false }
    })
    if (!finished.applied) {
      throw new Error('Tool failure could not update task state: ' + finished.audit.reason)
    }
    return { root: loaded.root, confirmed: false, task: finished.record, evidence }
  }

  const confirmed = verificationOutcome(result)
  const evidence = await recordEvidence(loaded.root, taskId, {
    type: 'tool_execution',
    toolId,
    outcome: confirmed ? 'confirmed' : 'failed',
    confirmed,
    result
  }, options.evidence)
  const finished = await advanceTask(loaded.root, taskId, confirmed ? 'VERIFIED' : 'VERIFY_FAILED', {
    actor: 'bth.verify',
    reason: confirmed ? 'Build wrapper returned a verified success.' : 'Build wrapper did not return a verified success.',
    evidence: { id: evidence.record.id, confirmed }
  })
  if (!finished.applied) {
    throw new Error('Verification result could not update task state: ' + finished.audit.reason)
  }
  return { root: loaded.root, confirmed, task: finished.record, evidence }
}
