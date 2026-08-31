import test from 'node:test'
import assert from 'node:assert/strict'
import { preservationReview, acknowledgePreservationReview } from '../src/core/preservation-review.mjs'

const record = { recordSha256: 'a'.repeat(64) }
const observed = {
  schemaVersion: 1, status: 'review-required', omittedFileCount: 0,
  files: [{ path: 'src/Customer.java', status: 'review-required', baseSha256: 'b'.repeat(64), candidateSha256: 'c'.repeat(64),
    findings: [{ code: 'relationship_guard_drift', line: 8, baselineLine: 4 }] }]
}
const options = { actor: 'reviewer', reviewNote: 'Approved the intended association change after reviewing the exact diff.' }

test('review is deterministic and bound to both the sealed record and current findings', () => {
  const review = preservationReview(record, observed)
  assert.equal(review.status, 'required')
  assert.match(review.fingerprint, /^[a-f0-9]{64}$/)
  assert.deepEqual(preservationReview(record, structuredClone(observed)), review)
  assert.notEqual(preservationReview({ recordSha256: 'd'.repeat(64) }, observed).fingerprint, review.fingerprint)
  const changed = structuredClone(observed)
  changed.files[0].candidateSha256 = 'e'.repeat(64)
  assert.notEqual(preservationReview(record, changed).fingerprint, review.fingerprint)
  const receipt = acknowledgePreservationReview(review, { ...options, acceptPreservationReview: review.fingerprint })
  assert.equal(receipt.fingerprint, review.fingerprint)
  assert.equal(receipt.actor, 'reviewer')
  assert.equal(receipt.note, options.reviewNote)
  assert.equal(receipt.authority, 'human-acknowledgement-not-semantic-proof')
})

test('missing, wrong, stale or incomplete review cannot be acknowledged', () => {
  const review = preservationReview(record, observed)
  for (const accepted of [undefined, '', 'x', 'd'.repeat(64)]) {
    assert.throws(() => acknowledgePreservationReview(review, { ...options, acceptPreservationReview: accepted }), { code: 'apply_preservation_review_required' })
  }
  for (const value of [null, { ...observed, status: 'incomplete' }, { ...observed, omittedFileCount: 1 },
    { ...observed, files: [{ ...observed.files[0], baseSha256: null }] },
    { ...observed, files: [{ ...observed.files[0], status: 'incomplete' }] }]) {
    const incomplete = preservationReview(record, value)
    assert.equal(incomplete.status, 'unavailable')
    assert.equal(incomplete.fingerprint, null)
    assert.throws(() => acknowledgePreservationReview(incomplete, { ...options, acceptPreservationReview: review.fingerprint }), { code: 'apply_preservation_incomplete' })
  }
  assert.equal(preservationReview({}, observed).status, 'unavailable')
})

test('review notes and actor are bounded, single-line and reject detected sensitive text', () => {
  const review = preservationReview(record, observed)
  const accepted = { ...options, acceptPreservationReview: review.fingerprint }
  for (const reviewNote of [undefined, '', 'ok', 'x'.repeat(513), 'Reviewed\nchanged guard', 'Reviewed password=fixture-only', 'Contact reviewer@example.com']) {
    assert.throws(() => acknowledgePreservationReview(review, { ...accepted, reviewNote }), { code: 'apply_preservation_note_invalid' })
  }
  for (const actor of ['', 'x'.repeat(129), 'reviewer\nother', 'reviewer@example.com']) {
    assert.throws(() => acknowledgePreservationReview(review, { ...accepted, actor }), { code: 'apply_preservation_actor_invalid' })
  }
})

test('clear candidates need no review and reject irrelevant acknowledgement flags', () => {
  for (const status of ['clear', 'not-applicable']) {
    const review = preservationReview(record, { schemaVersion: 1, status, omittedFileCount: 0, files: [] })
    assert.equal(review.status, 'not-required')
    assert.equal(acknowledgePreservationReview(review, {}), null)
    for (const options of [{ reviewNote: 'Reviewed exact diff.' }, { acceptPreservationReview: 'a'.repeat(64) }]) {
      assert.throws(() => acknowledgePreservationReview(review, options), { code: 'apply_preservation_review_not_required' })
    }
  }
})
