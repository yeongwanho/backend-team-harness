// Self-contained: init embeds this exact function in project-owned runners.
export function jestJsonToJUnit(document, projectRoot = '') {
  const limit = 16 * 1024 * 1024
  const maxCases = 100000
  const fail = (reason) => { throw new Error('Invalid Jest result: ' + reason) }
  const label = (value) => {
    if (typeof value !== 'string' || !value.trim() || value.length > 4096 ||
        /[\u0000-\u001f\ufffe\uffff]/u.test(value) ||
        /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(value)) fail('invalid test identity')
    return value
  }
  const xml = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
  const suitePath = (value) => {
    let path = label(value).replaceAll('\\', '/')
    const root = projectRoot.replaceAll('\\', '/').replace(/\/$/, '')
    if (path.startsWith('/') || /^[a-z]:\//i.test(path)) {
      const insensitive = /^[a-z]:\//i.test(path)
      const prefix = root + '/'
      if (!root || !(insensitive ? path.toLowerCase().startsWith(prefix.toLowerCase()) : path.startsWith(prefix))) fail('suite outside project')
      path = path.slice(prefix.length)
    }
    if (!path || path.split('/').some((part) => !part || part === '..' || part === '.')) fail('invalid suite path')
    return path
  }
  if (!document || typeof document !== 'object' || !Array.isArray(document.testResults) ||
      document.testResults.length > maxCases) fail('missing or excessive suites')
  if (document.wasInterrupted !== false || typeof document.success !== 'boolean') fail('incomplete run')
  if (document.numRuntimeErrorTestSuites !== 0) fail('suite execution error or missing runtime-error count')
  const counts = { passed: 0, failed: 0, pending: 0, todo: 0 }
  const suites = { passed: 0, failed: 0, skipped: 0 }
  const identities = new Set()
  const suiteNames = new Set()
  const fragments = []
  let bytes = 0
  const append = (value) => {
    bytes += Buffer.byteLength(value)
    if (bytes > limit - 512) fail('JUnit exceeds 16 MiB')
    fragments.push(value)
  }
  for (const suite of document.testResults) {
    if (!suite || !Array.isArray(suite.assertionResults) || suite.testExecError) fail('invalid suite or execution error')
    if (!['passed', 'failed', 'focused', 'skipped'].includes(suite.status)) fail('unknown suite status')
    const className = suitePath(suite.name)
    if (suiteNames.has(className)) fail('duplicate suite identity')
    suiteNames.add(className)
    let suiteFailed = 0
    let suiteExecuted = 0
    let suitePending = 0
    for (const entry of suite.assertionResults) {
      if (!entry || !['passed', 'failed', 'pending', 'todo', 'disabled', 'skipped'].includes(entry.status)) fail('unknown assertion status')
      const name = label(entry.fullName ?? entry.title)
      const key = className + '\0' + name
      if (identities.has(key)) fail('duplicate test identity')
      identities.add(key)
      if (identities.size > maxCases) fail('more than 100000 cases')
      const status = ['disabled', 'skipped'].includes(entry.status) ? 'pending' : entry.status
      counts[status]++
      if (status === 'passed' || status === 'failed') suiteExecuted++
      if (status === 'failed') suiteFailed++
      if (status === 'pending') suitePending++
      const outcome = status === 'failed' ? '<failure message="failed"/>' : status === 'passed' ? '' : '<skipped/>'
      append('<testcase classname="' + xml(className) + '" name="' + xml(name) + '">' + outcome + '</testcase>')
    }
    // Jest uses "focused" for a completed suite containing pending assertions.
    if ((suite.status === 'failed') !== (suiteFailed > 0) ||
        (suite.status === 'skipped' && suiteExecuted > 0) ||
        (suite.status === 'focused' && suitePending === 0)) fail('suite status contradicts assertions')
    suites[suite.status === 'focused' ? 'passed' : suite.status]++
  }
  const expected = {
    numTotalTests: identities.size, numPassedTests: counts.passed, numFailedTests: counts.failed,
    numPendingTests: counts.pending, numTodoTests: counts.todo,
    numTotalTestSuites: document.testResults.length, numPassedTestSuites: suites.passed,
    numFailedTestSuites: suites.failed, numPendingTestSuites: suites.skipped
  }
  for (const [field, value] of Object.entries(expected)) {
    if (!Number.isSafeInteger(document[field]) || document[field] !== value) fail('inconsistent ' + field)
  }
  if (document.success !== (counts.failed === 0)) fail('success contradicts assertions or unrepresented run failure')
  return '<?xml version="1.0" encoding="UTF-8"?><testsuite name="jest" tests="' + identities.size +
    '" failures="' + counts.failed + '" errors="0" skipped="' + (counts.pending + counts.todo) + '">' + fragments.join('') + '</testsuite>\n'
}
