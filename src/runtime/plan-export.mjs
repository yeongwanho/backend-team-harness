import { createHash } from 'node:crypto'
import { canonicalJson } from '../core/canonical-json.mjs'
import { loadInterview } from '../core/interview-store.mjs'
import { loadTask } from '../core/task-store.mjs'
import { captureConfiguredSourceBinding } from './backend-harness.mjs'
import { loadBudgetedCodeContext } from '../core/code-context.mjs'
import { sourceBindingMatchesFingerprint } from '../core/source-binding.mjs'
import { withProjectVerificationLock } from '../core/project-lock.mjs'

function sha256(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function planQuery(plan) {
  const values = []
  const visit = (value) => {
    if (typeof value === 'string') {
      values.push(value)
    } else if (Array.isArray(value)) {
      value.forEach(visit)
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(visit)
    }
  }
  visit(plan)
  return values.join('\n').slice(0, 64 * 1024)
}

async function exportApprovedPlanUnlocked(inputPath, taskId, options = {}) {
  const loaded = await loadTask(inputPath, taskId)
  const task = loaded.record
  if (!task.approvalReceipt || !['PLAN_APPROVED', 'IMPLEMENTING', 'VERIFYING', 'VERIFY_FAILED', 'VERIFIED', 'DONE'].includes(task.state)) {
    throw new Error('A human-approved task plan is required before export.')
  }
  if (
    task.approvalReceipt.contextSha256 !== sha256({ context: task.context }) ||
    task.approvalReceipt.planSha256 !== sha256({ plan: task.plan })
  ) {
    throw new Error('Approved task context or plan no longer matches its approval receipt.')
  }
  const currentSource = await captureConfiguredSourceBinding(loaded.root)
  const sourceMatchesApproval = !task.approvalReceipt.sourceFingerprint ||
    sourceBindingMatchesFingerprint(currentSource, task.approvalReceipt.sourceFingerprint)
  if (task.state === 'PLAN_APPROVED' && !sourceMatchesApproval) {
    throw new Error('Source changed since plan approval. Rebind and approve a fresh plan before export.')
  }

  let plan
  let planDigest
  let source = 'manual-task-plan'
  if (task.planArtifactSha256) {
    const interview = await loadInterview(loaded.root, taskId)
    if (interview.record.status !== 'FINALIZED' || interview.record.artifactDigests?.plan !== task.planArtifactSha256) {
      throw new Error('Approved plan artifact stale or inconsistent with the task record.')
    }
    plan = interview.artifacts.plan
    planDigest = task.planArtifactSha256
    source = interview.path + '/plan.json'
  } else {
    plan = {
      schemaVersion: 1,
      taskId,
      sourceFingerprint: task.planSourceFingerprint,
      objective: task.context,
      planText: task.plan
    }
    planDigest = sha256(plan)
  }

  const codeContext = await loadBudgetedCodeContext(loaded.root, planQuery(plan), {
    budgetCharacters: options.contextBudget ?? 4000,
    sourceFingerprint: currentSource.fingerprint
  })

  return {
    schemaVersion: 1,
    type: 'bth.approved-execution-plan',
    taskId,
    taskState: task.state,
    planDigest,
    plan,
    codeContext,
    approval: task.approvalReceipt,
    provenance: {
      source,
      taskRevision: task.revision,
      sourceFingerprint: task.approvalReceipt.sourceFingerprint,
      currentSourceFingerprint: currentSource.fingerprint,
      sourceMatchesApproval
    },
    authority: {
      write: false,
      verdict: false,
      note: 'This export is a read-only plan contract. A provider adapter must enforce its own tool permissions, and only BTH verification may confirm completion.'
    }
  }
}

export function exportApprovedPlan(inputPath, taskId, options = {}) {
  return withProjectVerificationLock(inputPath, options.projectLock, () =>
    exportApprovedPlanUnlocked(inputPath, taskId, options)
  )
}
