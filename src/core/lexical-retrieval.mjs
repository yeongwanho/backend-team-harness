import { posix } from 'node:path'

const STOP_TERMS = new Set(['add', 'and', 'are', 'expose', 'for', 'from', 'in', 'into', 'not', 'only', 'the', 'then', 'this', 'through', 'to', 'use', 'used', 'with'])
const ALIASES = new Map([['configuration', 'config'], ['documentation', 'document']])
const MAX_TEXT = 64 * 1024
const MAX_TERMS = 64
const LEXICAL_METADATA = Object.freeze({
  id: 'bounded-binary-idf-identifier-prior',
  maximumTermsPerNode: MAX_TERMS,
  explicitIdentifierOwnershipCopies: 1
})

export function tokenizeRetrievalText(value) {
  const text = typeof value === 'string' ? value.slice(0, MAX_TEXT) : ''
  const expanded = text.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_$]+/g, ' ').toLowerCase()
  const parts = expanded.match(/[\p{L}\p{N}]{2,}/gu) ?? []
  const compact = text.toLowerCase().match(/[\p{L}\p{N}_$]{4,}/gu) ?? []
  const result = new Set()
  for (const token of [...parts, ...compact]) {
    const variants = [token]
    if (ALIASES.has(token)) variants.push(ALIASES.get(token))
    if (token.length > 4 && token.endsWith('ies')) variants.push(token.slice(0, -3) + 'y')
    else if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) variants.push(token.slice(0, -1))
    for (const variant of variants) {
      if (!STOP_TERMS.has(variant)) result.add(variant)
      if (result.size === MAX_TERMS) return [...result]
    }
  }
  return [...result]
}

function identifiers(value) {
  return value.match(/[A-Za-z_$][A-Za-z0-9_$]{3,127}/g) ?? []
}

// Keep the existing binary-term IDF prior. An explicitly named code identifier
// gets one additional IDF copy in its filename/declaration, not merely imports.
// Only query matches survive tokenization, bounding retained per-node memory.
export function personalizeCodeNodes(nodes, query) {
  const text = typeof query === 'string' ? query.slice(0, MAX_TEXT) : ''
  const queryTerms = tokenizeRetrievalText(text)
  const uniform = () => ({
    weights: nodes.map(() => 1 / nodes.length), mode: 'global-fallback',
    matchedTokens: [], seededNodeCount: 0, seededIndexes: [], lexical: LEXICAL_METADATA
  })
  if (queryTerms.length === 0 || nodes.length === 0) return uniform()
  const querySet = new Set(queryTerms)
  const compactQuery = new Set(text.toLowerCase().match(/[\p{L}\p{N}_$]{4,}/gu) ?? [])
  const explicitIdentifiers = new Set(identifiers(text)
    .filter(token => /[a-z0-9][A-Z]|[A-Z]{2}[A-Z][a-z]|[_$]/.test(token))
    .map(token => token.toLowerCase()))
  const frequency = new Map(queryTerms.map(term => [term, 0]))
  const records = nodes.map(node => {
    const terms = tokenizeRetrievalText(node.path + ' ' + node.qualifiedName + ' ' + (node.searchTerms ?? []).join(' '))
    const matches = []
    let exactMatch = false
    for (const term of terms) {
      if (compactQuery.has(term)) exactMatch = true
      if (querySet.has(term)) {
        matches.push(term)
        frequency.set(term, frequency.get(term) + 1)
      }
    }
    const identity = posix.basename(node.path) + ' ' + node.qualifiedName.split(/[.#]/).at(-1)
    const ownedIdentifiers = explicitIdentifiers.size
      ? new Set(identifiers(identity).map(token => token.toLowerCase()).filter(token => explicitIdentifiers.has(token)))
      : null
    return { matches, exactMatch, ownedIdentifiers }
  })
  const idf = new Map(queryTerms.map(term => [term, Math.log((nodes.length + 1) / (frequency.get(term) + 1)) + 1]))
  const raw = records.map(record => record.matches.reduce((score, term) =>
    score + idf.get(term) * (record.ownedIdentifiers?.has(term) ? 2 : 1), 0))
  const total = raw.reduce((sum, score) => sum + score, 0)
  if (total === 0) return uniform()
  const matchedTokens = queryTerms.filter(term => frequency.get(term) > 0)
  let strongest = 0
  for (const score of raw) strongest = Math.max(strongest, score)
  const exactIndexes = records.flatMap((record, index) => record.exactMatch ? [index] : [])
  return {
    weights: raw.map(score => score / total),
    mode: 'query-personalized',
    matchedTokens,
    seededNodeCount: raw.filter(score => score > 0).length,
    seededIndexes: exactIndexes.length ? exactIndexes : raw.flatMap((score, index) => score === strongest ? [index] : []),
    lexical: LEXICAL_METADATA
  }
}
