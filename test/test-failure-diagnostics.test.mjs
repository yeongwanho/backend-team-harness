import test from 'node:test'
import assert from 'node:assert/strict'
import { compactTestFailureDiagnostics, junitFailureDiagnostics } from '../src/core/test-failure-diagnostics.mjs'

test('failure diagnostic projection has bounded input/output and exact code/type pairs', () => {
  assert.deepEqual(compactTestFailureDiagnostics(null), [])
  const valid = [
    ['xml_parse_error', 'org.xml.sax.SAXParseException'],
    ['xpath_expression_error', 'javax.xml.xpath.XPathExpressionException'],
    ['null_reference', 'java.lang.NullPointerException'],
    ['assertion_failure', 'java.lang.AssertionError'],
    ['class_loading_error', 'java.lang.ClassNotFoundException']
  ].map(([code, exceptionType]) => ({ code, exceptionType }))
  assert.deepEqual(compactTestFailureDiagnostics(valid), valid.slice(0, 4))
  assert.deepEqual(compactTestFailureDiagnostics(Array(32).fill(null).concat(valid)), [])
  assert.deepEqual(compactTestFailureDiagnostics([{}, { code: 'xml_parse_error', exceptionType: 'unknown' },
    { code: 'timeout', exceptionType: 'java.lang.NullPointerException' }]), [])
})

test('JUnit classification ignores missing/oversized types, payloads and unknown elements', () => {
  assert.deepEqual(junitFailureDiagnostics(null), [])
  assert.deepEqual(junitFailureDiagnostics([null, { error: [] }, { error: [], ':@': { type: 8 } },
    { error: [], ':@': { type: 'org.xml.sax.SAXParseException;' + 'x'.repeat(4096) } },
    { 'system-out': [], ':@': { type: 'org.xml.sax.SAXParseException' } }]), [])
})
