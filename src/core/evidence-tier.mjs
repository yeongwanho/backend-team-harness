const EVIDENCE_TIERS = new Set(['EXECUTED', 'REPORTED', 'CONTROL'])

export function assertEvidenceTier(value) {
  if (!EVIDENCE_TIERS.has(value)) {
    throw new Error('Evidence tier must be EXECUTED, REPORTED, or CONTROL.')
  }
  return value
}

export function evidenceTierFor(input) {
  return assertEvidenceTier(input.evidenceTier ?? (input.result ? 'EXECUTED' : 'CONTROL'))
}
