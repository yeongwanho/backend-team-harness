import { homedir, tmpdir } from 'node:os'

const SECRET_PATTERNS = [
  [/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, '<redacted-aws-key>'],
  [/\b(?:sk|rk|pk)-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g, '<redacted-api-token>'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, '<redacted-slack-token>'],
  [/\bAIza[0-9A-Za-z_-]{20,}\b/g, '<redacted-google-api-key>'],
  [/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, '<redacted-github-token>'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '<redacted-jwt>'],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*\b/gi, '$1 <redacted>'],
  [/(-----BEGIN [A-Z ]*PRIVATE KEY-----)[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----)/g, '$1\n<redacted>\n$2'],
  [/(^|[^A-Za-z0-9])(password|passwd|secret|token|api[_-]?key|authorization|cookie|set-cookie)\s*([=:])\s*([^\s,;&]+)/gi, '$1$2$3<redacted>'],
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi, '$1<redacted>@'],
  [/([?;&](?:password|passwd|secret|token|api[_-]?key)=)[^&#\s]*/gi, '$1<redacted>'],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '<redacted-email>']
]

const SENSITIVE_CONTENT_KEYS = new Set([
  'authorization', 'cookie', 'set-cookie', 'fileContent', 'prompt', 'rawOutput',
  'requestBody', 'responseBody', 'sourceText', 'stderrTail', 'stdoutTail'
])

function escaped(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function redactString(value, options = {}) {
  let output = value
  let count = 0
  const locations = [
    [options.projectRoot, '<project>'],
    [homedir(), '<home>'],
    [tmpdir(), '<tmp>']
  ].filter(([path]) => typeof path === 'string' && path.length > 1)
  for (const [path, replacement] of locations) {
    const pattern = new RegExp(escaped(path), 'g')
    output = output.replace(pattern, () => {
      count += 1
      return replacement
    })
  }
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    output = output.replace(pattern, (...args) => {
      count += 1
      return typeof replacement === 'string'
        ? replacement.replace(/\$(\d+)/g, (_match, index) => args[Number(index)] ?? '')
        : replacement
    })
  }
  return { value: output, count }
}

export function redactForShare(value, options = {}) {
  let count = 0
  const visit = (entry, key = null) => {
    if (key && SENSITIVE_CONTENT_KEYS.has(key) && entry !== null && entry !== undefined) {
      count += 1
      return '<redacted-sensitive-content>'
    }
    if (typeof entry === 'string') {
      const redacted = redactString(entry, options)
      count += redacted.count
      return redacted.value
    }
    if (Array.isArray(entry)) {
      return entry.map((child) => visit(child))
    }
    if (entry && typeof entry === 'object') {
      return Object.fromEntries(Object.entries(entry).map(([childKey, child]) => [childKey, visit(child, childKey)]))
    }
    return entry
  }
  return { value: visit(value), redactionsApplied: count }
}
