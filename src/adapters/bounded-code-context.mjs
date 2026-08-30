import { indexProjectGraph } from '../../packs/codegraph-advisory/indexer.mjs'
import { rankCodeContext } from '../core/code-context.mjs'
import { resolveReadableRoot } from '../fs-safety.mjs'

function unavailable(reason, diagnostic, budgetCharacters) {
  return {
    status: 'unavailable',
    reason,
    diagnostic,
    authority: {
      evidenceTier: 'REPORTED',
      advisory: true,
      permittedUses: ['navigation', 'review-questions'],
      forbiddenUses: ['pass-verdict', 'test-skipping']
    },
    budget: { limitCharacters: budgetCharacters, usedCharacters: 0, omittedNodes: 0 },
    entries: []
  }
}

export async function inspectBoundSourceCodeContext(inputPath, query, options = {}) {
  const budgetCharacters = options.budgetCharacters ?? 4000
  if (budgetCharacters === 0) return unavailable('disabled', 'Context budget is zero.', 0)
  if (!Number.isSafeInteger(budgetCharacters) || budgetCharacters < 64 || budgetCharacters > 100_000) {
    throw new Error('Context budget must be zero or an integer between 64 and 100000 characters.')
  }
  if (typeof options.sourceFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(options.sourceFingerprint)) {
    return unavailable('source_fingerprint_required', 'A current source fingerprint is required.', budgetCharacters)
  }
  const root = await resolveReadableRoot(inputPath)
  try {
    const indexer = options.indexProjectGraph ?? indexProjectGraph
    const document = await indexer(root, options.indexerOptions)
    const ranked = rankCodeContext(document, query, { budgetCharacters })
    return {
      ...ranked,
      provenance: {
        mode: 'bounded-read-only-source-snapshot',
        graphGeneration: document.graph.generation,
        sourceFingerprint: options.sourceFingerprint,
        persisted: false
      }
    }
  } catch (error) {
    return unavailable('live_graph_failed', error instanceof Error ? error.message : String(error), budgetCharacters)
  }
}
