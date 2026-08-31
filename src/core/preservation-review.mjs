import { createHash } from 'node:crypto'
import { canonicalJson } from './canonical-json.mjs'
import { bthError } from './errors.mjs'
import { compactPreservation } from './implementation-preservation.mjs'
import { redactString } from './redaction.mjs'

const AUTHORITY = 'human-acknowledgement-not-semantic-proof'
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)

// A discovered condition is an observation, not an immutable team policy.
// The caller validates the candidate seal; this binds review to that exact seal.
export function preservationReview(record, value) {
  const preservation = compactPreservation(value)
  const unavailable = !sha(record?.recordSha256) || !preservation || preservation.status === 'incomplete' ||
    preservation.omittedFileCount > 0 || preservation.files.some(file =>
      !file.path || file.status === 'incomplete' ||
      (file.status === 'review-required' && (!sha(file.baseSha256) || !sha(file.candidateSha256) || !file.findings.length)))
  const required = preservation?.status === 'review-required' || preservation?.files.some(file => file.status === 'review-required')
  const status = unavailable ? 'unavailable' : required ? 'required' : 'not-required'
  const fingerprint = status === 'required'
    ? createHash('sha256').update(canonicalJson({ kind: 'preservation-review-v1', recordSha256: record.recordSha256, preservation })).digest('hex')
    : null
  return { schemaVersion: 1, authority: AUTHORITY, status, fingerprint, preservation }
}

function safeText(value, min, max) {
  return typeof value === 'string' && value.length <= max && value.trim().length >= min &&
    !/[\x00-\x1f\x7f\u2028\u2029]/.test(value) && redactString(value).count === 0
}

export function acknowledgePreservationReview(review, options = {}) {
  if (!review || review.status === 'unavailable') {
    throw bthError('apply_preservation_incomplete', 'Structural inspection is incomplete; acknowledgement cannot waive missing evidence. No source files were staged or changed.', { preservationReview: review })
  }
  if (review.status === 'not-required') {
    if (options.acceptPreservationReview !== undefined || options.reviewNote !== undefined) {
      throw bthError('apply_preservation_review_not_required', 'This candidate has no pending structural review; remove the acknowledgement options.')
    }
    return null
  }
  if (review.status !== 'required' || !sha(review.fingerprint) || options.acceptPreservationReview !== review.fingerprint) {
    throw bthError('apply_preservation_review_required', 'Tests do not resolve changed baseline conditions. Review the exact candidate, then pass its current fingerprint and a non-secret review note. No source files were staged or changed.', { preservationReview: review })
  }
  if (!safeText(options.actor, 1, 128)) {
    throw bthError('apply_preservation_actor_invalid', 'Review actor must be 1–128 characters on one line without detected sensitive data.')
  }
  if (!safeText(options.reviewNote, 12, 512)) {
    throw bthError('apply_preservation_note_invalid', 'Review note must be 12–512 characters on one line without detected sensitive data. Describe the decision; do not paste source or credentials.')
  }
  return { schemaVersion: 1, authority: AUTHORITY, fingerprint: review.fingerprint, actor: options.actor.trim(), note: options.reviewNote.trim() }
}
