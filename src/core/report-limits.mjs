export const MAX_REPORT_FILE_BYTES = 16 * 1024 * 1024
export const MAX_REPORT_AGGREGATE_BYTES = 64 * 1024 * 1024

function aggregateLimit(value) {
  const limit = value ?? MAX_REPORT_AGGREGATE_BYTES
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_REPORT_AGGREGATE_BYTES) {
    throw new Error(
      'Aggregate report byte limit must be an integer between 1 and ' + MAX_REPORT_AGGREGATE_BYTES + '.'
    )
  }
  return limit
}

export function assertReportFileBytes(bytes, source) {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_REPORT_FILE_BYTES) {
    throw new Error(source + ': report exceeds the 16 MiB safety limit.')
  }
}

export function createReportBudget(options = {}) {
  const maximumBytes = aggregateLimit(options.maximumAggregateBytes)
  let consumedBytes = 0
  return Object.freeze({
    consume(bytes, source) {
      assertReportFileBytes(bytes, source)
      consumedBytes += bytes
      if (!Number.isSafeInteger(consumedBytes) || consumedBytes > maximumBytes) {
        throw new Error(
          source + ': aggregate report byte limit exceeded (' + maximumBytes + ' bytes).'
        )
      }
      return consumedBytes
    },
    get consumedBytes() {
      return consumedBytes
    },
    maximumBytes
  })
}
