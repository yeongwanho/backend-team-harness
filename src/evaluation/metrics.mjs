function uniquePaths(values, label) {
  if (!Array.isArray(values)) throw new Error(label + ' must be an array.')
  const normalized = []
  for (const value of values) {
    if (typeof value !== 'string' || !value) throw new Error(label + ' must contain non-empty paths.')
    if (!normalized.includes(value)) normalized.push(value)
  }
  return normalized
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

export function recallAt(rankedPaths, goldPaths, limit) {
  const ranked = uniquePaths(rankedPaths, 'rankedPaths')
  const gold = new Set(uniquePaths(goldPaths, 'goldPaths'))
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('limit must be a positive integer.')
  if (!gold.size) throw new Error('goldPaths must not be empty.')
  return ranked.slice(0, limit).filter((path) => gold.has(path)).length / gold.size
}

export function ndcgAt(rankedPaths, goldPaths, limit) {
  const ranked = uniquePaths(rankedPaths, 'rankedPaths')
  const gold = new Set(uniquePaths(goldPaths, 'goldPaths'))
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('limit must be a positive integer.')
  if (!gold.size) throw new Error('goldPaths must not be empty.')
  const gain = ranked.slice(0, limit).reduce((sum, path, index) => {
    return sum + (gold.has(path) ? 1 / Math.log2(index + 2) : 0)
  }, 0)
  const ideal = Array.from({ length: Math.min(limit, gold.size) }, (_, index) => 1 / Math.log2(index + 2))
    .reduce((sum, value) => sum + value, 0)
  return ideal === 0 ? 0 : gain / ideal
}

export function scoreLocalization(task, rankedPaths) {
  if (!task || typeof task.id !== 'string') throw new Error('task.id is required.')
  return {
    taskId: task.id,
    goldPathCount: task.goldPaths.length,
    rankedPathCount: uniquePaths(rankedPaths, 'rankedPaths').length,
    recallAt5: recallAt(rankedPaths, task.goldPaths, 5),
    recallAt20: recallAt(rankedPaths, task.goldPaths, 20),
    ndcgAt20: ndcgAt(rankedPaths, task.goldPaths, 20)
  }
}

export function aggregateLocalization(scores) {
  if (!Array.isArray(scores) || !scores.length) throw new Error('scores must contain at least one task result.')
  return {
    taskCount: scores.length,
    meanRecallAt5: mean(scores.map((entry) => entry.recallAt5)),
    meanRecallAt20: mean(scores.map((entry) => entry.recallAt20)),
    meanNdcgAt20: mean(scores.map((entry) => entry.ndcgAt20)),
    zeroRecallAt20Tasks: scores.filter((entry) => entry.recallAt20 === 0).map((entry) => entry.taskId).sort()
  }
}
