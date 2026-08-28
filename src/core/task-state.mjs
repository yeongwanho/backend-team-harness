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
  VERIFYING: ['VERIFIED', 'VERIFY_FAILED', 'PERMISSION_DENIED'],
  VERIFIED: ['DONE'],
  VERIFY_FAILED: ['IMPLEMENTING', 'VERIFYING', 'CONTEXT_READY'],
  CONTEXT_STALE: ['CONTEXT_READY'],
  POLICY_BLOCKED: ['CONTEXT_READY'],
  PERMISSION_DENIED: ['PLAN_PROPOSED', 'IMPLEMENTING'],
  DONE: []
})

function cleanText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function isTaskState(value) {
  return STATE_SET.has(value)
}

export function createTaskRecord(input, options = {}) {
  const now = options.at ?? new Date().toISOString()
  return {
    schemaVersion: 1,
    id: input.id,
    title: cleanText(input.title) ?? input.id,
    context: cleanText(input.context),
    plan: cleanText(input.plan),
    state: 'CONTEXT_MISSING',
    revision: 0,
    createdAt: now,
    updatedAt: now,
    lastEvidenceId: null
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

  const actor = cleanText(input.actor)
  if (!actor) {
    return rejected(record, to, 'actor_required')
  }
  if (to === 'CONTEXT_READY' && !cleanText(record.context)) {
    return rejected(record, to, 'context_required')
  }
  if (to === 'PLAN_PROPOSED' && !cleanText(record.plan)) {
    return rejected(record, to, 'plan_required')
  }
  if (to === 'PLAN_APPROVED' && input.approved !== true) {
    return rejected(record, to, 'explicit_human_approval_required')
  }
  if (to === 'VERIFIED' && (!input.evidence?.id || input.evidence.confirmed !== true)) {
    return rejected(record, to, 'confirmed_evidence_required')
  }
  if (to === 'DONE' && !record.lastEvidenceId) {
    return rejected(record, to, 'verified_evidence_required')
  }

  const at = input.at ?? new Date().toISOString()
  const evidenceId = input.evidence?.id ?? record.lastEvidenceId
  const next = {
    ...record,
    state: to,
    revision: record.revision + 1,
    updatedAt: at,
    lastEvidenceId: evidenceId
  }

  return {
    applied: true,
    record: next,
    audit: {
      type: 'transition_applied',
      from: record.state,
      to,
      actor,
      reason: cleanText(input.reason),
      evidenceId: input.evidence?.id ?? null,
      evidenceConfirmed: input.evidence?.confirmed === true,
      approved: input.approved === true,
      at
    }
  }
}
