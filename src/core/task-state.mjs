import { createHash } from 'node:crypto'
import { canonicalJson } from './canonical-json.mjs'

const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export function assertTaskId(taskId) {
  if (typeof taskId !== 'string' || !TASK_ID_PATTERN.test(taskId) || taskId === '.' || taskId === '..') {
    throw new Error('Task id must use 1-64 letters, numbers, dots, underscores, or hyphens and cannot traverse paths.')
  }
  return taskId
}

export const TASK_STATES = Object.freeze([
  'CONTEXT_MISSING',
  'CONTEXT_READY',
  'PLAN_PROPOSED',
  'PLAN_APPROVED',
  'IMPLEMENTING',
  'VERIFYING',
  'VERIFIED',
  'VERIFY_FAILED',
  'CONTEXT_STALE',
  'POLICY_BLOCKED',
  'PERMISSION_DENIED',
  'DONE'
])

const STATE_SET = new Set(TASK_STATES)

export const ALLOWED_TRANSITIONS = Object.freeze({
  CONTEXT_MISSING: ['CONTEXT_READY'],
  CONTEXT_READY: ['PLAN_PROPOSED', 'CONTEXT_STALE', 'POLICY_BLOCKED'],
  PLAN_PROPOSED: ['PLAN_APPROVED', 'CONTEXT_READY', 'POLICY_BLOCKED'],
  PLAN_APPROVED: ['IMPLEMENTING', 'VERIFYING', 'CONTEXT_STALE', 'POLICY_BLOCKED'],
  IMPLEMENTING: ['VERIFYING', 'CONTEXT_STALE', 'POLICY_BLOCKED', 'PERMISSION_DENIED'],
  VERIFYING: ['VERIFYING', 'VERIFIED', 'VERIFY_FAILED', 'PERMISSION_DENIED'],
  VERIFIED: ['DONE'],
  VERIFY_FAILED: ['IMPLEMENTING', 'VERIFYING', 'CONTEXT_READY'],
  CONTEXT_STALE: ['CONTEXT_READY'],
  POLICY_BLOCKED: ['CONTEXT_READY'],
  PERMISSION_DENIED: ['PLAN_PROPOSED', 'IMPLEMENTING'],
  DONE: []
})

export function normalizeTaskText(value, label, maxBytes) {
  const normalized = typeof value === 'string' && value.trim() ? value.trim() : null
  if (normalized && Buffer.byteLength(normalized, 'utf8') > maxBytes) {
    throw new Error('Task ' + label + ' exceeds the ' + maxBytes + '-byte safety limit.')
  }
  return normalized
}

export function isTaskState(value) {
  return STATE_SET.has(value)
}

export function createTaskRecord(input, options = {}) {
  const now = options.at ?? new Date().toISOString()
  return {
    schemaVersion: 2,
    id: input.id,
    title: normalizeTaskText(input.title, 'title', 256) ?? input.id,
    context: normalizeTaskText(input.context, 'context', 256 * 1024),
    plan: normalizeTaskText(input.plan, 'plan', 256 * 1024),
    state: 'CONTEXT_MISSING',
    revision: 0,
    createdAt: now,
    updatedAt: now,
    lastEvidenceId: null,
    planSourceFingerprint: null,
    planArtifactSha256: null,
    approvalReceipt: null
  }
}

function rejected(record, to, reason) {
  return {
    applied: false,
    record,
    audit: {
      type: 'transition_rejected',
      from: record.state,
      to,
      reason
    }
  }
}

export function transitionTaskRecord(record, to, input = {}) {
  if (!record || !isTaskState(record.state)) {
    throw new Error('Task record has an unknown current state.')
  }
  if (!isTaskState(to)) {
    return rejected(record, to, 'unknown_target_state')
  }
  if (!ALLOWED_TRANSITIONS[record.state].includes(to)) {
    return rejected(record, to, 'transition_not_allowed')
  }

  const actor = normalizeTaskText(input.actor, 'actor', 128)
  if (!actor) {
    return rejected(record, to, 'actor_required')
  }
  if (to === 'CONTEXT_READY' && !normalizeTaskText(record.context, 'context', 256 * 1024)) {
    return rejected(record, to, 'context_required')
  }
  if (to === 'PLAN_PROPOSED' && !normalizeTaskText(record.plan, 'plan', 256 * 1024)) {
    return rejected(record, to, 'plan_required')
  }
  if (to === 'PLAN_APPROVED' && input.approved !== true) {
    return rejected(record, to, 'explicit_human_approval_required')
  }
  if (
    to === 'PLAN_APPROVED' &&
    record.planSourceFingerprint &&
    input.currentSourceFingerprint !== record.planSourceFingerprint &&
    !(input.compatibleSourceFingerprints ?? []).includes(record.planSourceFingerprint)
  ) {
    return rejected(record, to, 'approved_plan_source_stale')
  }
  if (
    to === 'PLAN_APPROVED' &&
    record.planArtifactSha256 &&
    input.currentPlanArtifactSha256 !== record.planArtifactSha256
  ) {
    return rejected(record, to, 'approved_plan_artifact_stale')
  }
  if (to === 'VERIFIED' && (!input.evidence?.id || input.evidence.confirmed !== true)) {
    return rejected(record, to, 'confirmed_evidence_required')
  }
  if (to === 'DONE' && !record.lastEvidenceId) {
    return rejected(record, to, 'verified_evidence_required')
  }

  const at = input.at ?? new Date().toISOString()
  const evidenceId = input.evidence?.id ?? record.lastEvidenceId
  const approvalReceipt = to === 'PLAN_APPROVED'
    ? {
        actor,
        at,
        sourceFingerprint: record.planSourceFingerprint ?? input.currentSourceFingerprint ?? null,
        planArtifactSha256: record.planArtifactSha256 ?? null,
        contextSha256: createHash('sha256').update(canonicalJson({ context: record.context })).digest('hex'),
        planSha256: createHash('sha256').update(canonicalJson({ plan: record.plan })).digest('hex')
      }
    : record.approvalReceipt ?? null
  const next = {
    ...record,
    state: to,
    revision: record.revision + 1,
    updatedAt: at,
    lastEvidenceId: evidenceId,
    approvalReceipt
  }

  return {
    applied: true,
    record: next,
    audit: {
      type: 'transition_applied',
      from: record.state,
      to,
      actor,
      reason: normalizeTaskText(input.reason, 'reason', 2048),
      evidenceId: input.evidence?.id ?? null,
      evidenceConfirmed: input.evidence?.confirmed === true,
      approved: input.approved === true,
      approvalReceipt: to === 'PLAN_APPROVED' ? approvalReceipt : null,
      at
    }
  }
}
