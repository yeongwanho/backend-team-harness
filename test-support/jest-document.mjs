export function jestDocument(statuses = ['passed'], suiteName = 'src/api.spec.ts') {
  const count = (status) => statuses.filter((entry) => entry === status).length
  return {
    success: !statuses.includes('failed'), wasInterrupted: false, numRuntimeErrorTestSuites: 0,
    numTotalTests: statuses.length, numPassedTests: count('passed'), numFailedTests: count('failed'),
    numPendingTests: count('pending') + count('disabled') + count('skipped'), numTodoTests: count('todo'),
    numTotalTestSuites: 1, numPassedTestSuites: statuses.includes('failed') ? 0 : 1,
    numFailedTestSuites: statuses.includes('failed') ? 1 : 0, numPendingTestSuites: 0,
    testResults: [{
      name: suiteName, status: statuses.includes('failed') ? 'failed' : statuses.includes('pending') ? 'focused' : 'passed',
      assertionResults: statuses.map((status, index) => ({ title: 'case ' + index, fullName: 'api case ' + index, status }))
    }]
  }
}
