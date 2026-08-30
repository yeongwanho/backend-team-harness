import test from 'node:test'
import assert from 'node:assert/strict'
import { jestJsonToJUnit } from '../src/core/jest-report.mjs'
import { jestDocument } from '../test-support/jest-document.mjs'

test('Jest converter preserves every final outcome and escapes identities without failure bodies', () => {
  const document = jestDocument(['passed', 'failed', 'pending', 'todo', 'disabled', 'skipped'], '/project/src/api.spec.ts')
  document.testResults[0].assertionResults[0].fullName = 'api < & " \' >'
  document.testResults[0].assertionResults[1].failureMessages = ['SECRET_BODY_NOT_FOR_REPORT']
  const xml = jestJsonToJUnit(document, '/project')
  assert.match(xml, /tests="6" failures="1" errors="0" skipped="4"/)
  assert.match(xml, /classname="src\/api.spec.ts"/)
  assert.match(xml, /api &lt; &amp; &quot; &apos; &gt;/)
  assert.equal((xml.match(/<skipped\/>/g) ?? []).length, 4)
  assert.doesNotMatch(xml, /SECRET_BODY|\/project/)
  assert.ok(xml.endsWith('\n'))
})

test('Jest converter supports focused suites, skipped suites, title fallback and Windows paths', () => {
  const document = jestDocument(['passed', 'pending'], 'C:\\Project\\src\\api.spec.ts')
  delete document.testResults[0].assertionResults[0].fullName
  assert.match(jestJsonToJUnit(document, 'c:\\Project'), /classname="src\/api.spec.ts" name="case 0"/)
  const skipped = jestDocument(['pending'])
  skipped.testResults[0].status = 'skipped'
  skipped.numPassedTestSuites = 0
  skipped.numPendingTestSuites = 1
  assert.match(jestJsonToJUnit(skipped), /tests="1" failures="0" errors="0" skipped="1"/)
})

test('Jest converter fails closed on incomplete, contradictory, duplicate and malformed results', () => {
  const invalid = [
    null, {}, { testResults: Array(100001) },
    ...[
      (d) => { d.wasInterrupted = true }, (d) => { delete d.success },
      (d) => { d.numRuntimeErrorTestSuites = 1 }, (d) => { d.success = false },
      (d) => { d.testResults[0].testExecError = {} }, (d) => { d.testResults[0].assertionResults = null },
      (d) => { d.testResults[0].status = 'running' }, (d) => { d.testResults[0].status = 'failed' },
      (d) => { d.testResults[0].status = 'skipped' }, (d) => { d.testResults[0].status = 'focused' },
      (d) => { d.testResults[0].assertionResults[0].status = 'focused' },
      (d) => { delete d.testResults[0].assertionResults[0].status },
      (d) => { d.testResults[0].assertionResults.push(d.testResults[0].assertionResults[0]) },
      (d) => { d.testResults.push(d.testResults[0]) },
      ...['', ' ', 'src/../escape.spec.ts', '/outside/api.spec.ts', 'src//api.spec.ts'].map((path) => (d) => { d.testResults[0].name = path }),
      ...['', 'a'.repeat(4097), 'a\0b', '\ud800', '\udc00', '\uffff'].map((name) => (d) => { d.testResults[0].assertionResults[0].fullName = name }),
      ...['numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests', 'numTodoTests', 'numTotalTestSuites', 'numPassedTestSuites', 'numFailedTestSuites', 'numPendingTestSuites'].map((field) => (d) => { d[field]++ })
    ].map((mutate) => { const d = jestDocument(); mutate(d); return d })
  ]
  for (const document of invalid) assert.throws(() => jestJsonToJUnit(document, '/project'), /Invalid Jest result/)
  const hiddenFailure = jestDocument(['failed'])
  hiddenFailure.success = true
  assert.throws(() => jestJsonToJUnit(hiddenFailure), /success contradicts/)
})

test('Jest converter bounds case traversal and expanded XML output', () => {
  const document = jestDocument()
  document.testResults[0].assertionResults = Array.from({ length: 100001 }, (_, i) => ({ fullName: 'case ' + i, status: 'passed' }))
  assert.throws(() => jestJsonToJUnit(document), /100000 cases/)
  document.testResults[0].assertionResults = Array.from({ length: 1000 }, (_, i) => ({ fullName: 'case ' + i + '&'.repeat(4000), status: 'passed' }))
  assert.throws(() => jestJsonToJUnit(document), /16 MiB/)
})
