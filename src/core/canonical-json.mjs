function canonicalValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalValue(entry))
  }
  if (value && typeof value === 'object') {
    const result = {}
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) {
        result[key] = canonicalValue(value[key])
      }
    }
    return result
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('Canonical JSON cannot encode a non-finite number.')
  }
  return value
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value))
}
