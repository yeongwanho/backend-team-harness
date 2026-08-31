// Known standard exception identities only. Report messages and stack bodies
// can contain source/secrets or instructions and must never enter this channel.
const DIAGNOSTICS = new Map([
  ['org.xml.sax.SAXParseException', 'xml_parse_error'],
  ['javax.xml.xpath.XPathExpressionException', 'xpath_expression_error'],
  ['java.lang.NullPointerException', 'null_reference'],
  ['java.lang.AssertionError', 'assertion_failure'],
  ['org.opentest4j.AssertionFailedError', 'assertion_failure'],
  ['java.lang.ClassNotFoundException', 'class_loading_error'],
  ['java.lang.NoClassDefFoundError', 'class_loading_error'],
  ['java.util.concurrent.TimeoutException', 'timeout']
])
const FAILURE_ELEMENTS = new Set(['failure', 'error', 'flakyFailure', 'flakyError', 'rerunFailure', 'rerunError'])

export function compactTestFailureDiagnostics(value) {
  if (!Array.isArray(value)) return []
  const result = [], seen = new Set()
  for (const item of value.slice(0, 32)) {
    if (!item || typeof item !== 'object' || typeof item.exceptionType !== 'string' ||
        DIAGNOSTICS.get(item.exceptionType) !== item.code || typeof item.code !== 'string' || seen.has(item.exceptionType)) continue
    result.push({ code: item.code, exceptionType: item.exceptionType })
    seen.add(item.exceptionType)
    if (result.length === 4) break
  }
  return result
}

export function junitFailureDiagnostics(children) {
  if (!Array.isArray(children)) return []
  const candidates = []
  for (const node of children.slice(0, 32)) {
    if (!node || typeof node !== 'object' || !Object.keys(node).some(key => FAILURE_ELEMENTS.has(key))) continue
    const raw = node[':@']?.type
    if (typeof raw !== 'string' || raw.length > 4096) continue
    // Some SAX implementations append location data to their reported type.
    // Ignore that suffix; never infer type from the message or stack body.
    const exceptionType = raw.split(';', 1)[0].trim()
    const code = DIAGNOSTICS.get(exceptionType)
    if (code) candidates.push({ code, exceptionType })
  }
  return compactTestFailureDiagnostics(candidates)
}
