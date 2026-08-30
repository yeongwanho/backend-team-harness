export class BthError extends Error {
  constructor(code, message, details = null, options = {}) {
    super(message, options)
    this.name = 'BthError'
    this.code = code
    this.details = details
  }
}

export function bthError(code, message, details = null, options = {}) {
  return new BthError(code, message, details, options)
}

export function asBthError(error, fallbackCode = 'operation_failed') {
  if (error instanceof BthError) return error
  const message = error instanceof Error ? error.message : String(error)
  return new BthError(fallbackCode, message, null, error instanceof Error ? { cause: error } : {})
}
