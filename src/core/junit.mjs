import { spawn } from 'node:child_process'
import { readdir, readFile, stat, unlink } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { relative, resolve, sep } from 'node:path'
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import { assertNoSymlinkSegments, resolveSafeProjectPath, statPath } from '../fs-safety.mjs'
import { buildSafeEnvironment } from './process-runner.mjs'
import { reportGlobBase, reportGlobRegex } from './report-glob.mjs'
import { assertReportFileBytes, createReportBudget } from './report-limits.mjs'
import { junitFailureDiagnostics } from './test-failure-diagnostics.mjs'

async function filesForPattern(root, pattern) {
  const matcher = reportGlobRegex(pattern)
  const base = await resolveSafeProjectPath(root, reportGlobBase(pattern))
  const baseStat = await statPath(base)
  if (!baseStat?.isDirectory() || baseStat.isSymbolicLink()) {
    return []
  }
  const matches = []
  let visited = 0
  const visit = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      visited += 1
      if (visited > 100_000 || matches.length > 10_000) {
        throw new Error('JUnit report discovery exceeded its safety limit.')
      }
      const path = resolve(directory, entry.name)
      if (entry.isSymbolicLink()) {
        throw new Error(
          relative(root, path).split(sep).join('/') + ': symbolic link inside a structured report directory is not allowed.'
        )
      }
      if (entry.isDirectory()) {
        await visit(path)
      } else if (entry.isFile()) {
        const projectPath = relative(root, path).split(sep).join('/')
        if (matcher.test(projectPath)) {
          await assertNoSymlinkSegments(root, path)
          matches.push(path)
        }
      }
    }
  }
  await visit(base)
  return matches
}

export async function findReportFiles(root, patterns) {
  const paths = new Set()
  for (const pattern of patterns) {
    for (const path of await filesForPattern(root, pattern)) {
      paths.add(path)
    }
  }
  return [...paths].sort()
}

export async function snapshotReportFiles(root, patterns, options = {}) {
  const snapshot = new Map()
  const budget = createReportBudget(options)
  for (const path of await findReportFiles(root, patterns)) {
    const metadata = await stat(path)
    const source = relative(root, path)
    assertReportFileBytes(metadata.size, source)
    const content = await readFile(path)
    budget.consume(content.length, source)
    snapshot.set(path, {
      size: content.length,
      mtimeMs: metadata.mtimeMs,
      ctimeMs: metadata.ctimeMs,
      contentSha256: createHash('sha256').update(content).digest('hex')
    })
  }
  return snapshot
}

async function gitPathQuery(root, args, projectPaths, allowedExitCodes = [0], useStdin = false) {
  const found = []
  for (let offset = 0; offset < projectPaths.length; offset += 128) {
    const chunk = projectPaths.slice(offset, offset + 128)
    const matches = await new Promise((resolvePromise, reject) => {
      const child = spawn('git', ['-C', root, ...args, ...(useStdin ? [] : ['--', ...chunk])], {
        env: buildSafeEnvironment(),
        shell: false,
        stdio: [useStdin ? 'pipe' : 'ignore', 'pipe', 'pipe']
      })
      const stdout = []
      const stderr = []
      let bytes = 0
      child.stdout.on('data', (data) => {
        bytes += data.length
        if (bytes > 16 * 1024 * 1024) {
          child.kill('SIGKILL')
        } else {
          stdout.push(data)
        }
      })
      child.stderr.on('data', (data) => stderr.push(data))
      if (useStdin) {
        child.stdin.end(chunk.join('\0') + '\0')
      }
      child.once('error', reject)
      child.once('close', (code) => {
        if (!allowedExitCodes.includes(code) || bytes > 16 * 1024 * 1024) {
          reject(new Error('Cannot prove structured reports are disposable Git output: ' + (Buffer.concat(stderr).toString('utf8').trim() || 'git path query failed')))
          return
        }
        resolvePromise(Buffer.concat(stdout).toString('utf8').split('\0').filter(Boolean))
      })
    })
    found.push(...matches)
  }
  return found
}

export async function clearReportFiles(root, patterns) {
  const paths = await findReportFiles(root, patterns)
  const projectPaths = paths.map((path) => relative(root, path).split(sep).join('/'))
  const tracked = await gitPathQuery(root, ['ls-files', '-z'], projectPaths)
  if (tracked.length > 0) {
    throw new Error('Refusing to delete a tracked project file declared as structured report: ' + tracked.sort()[0])
  }
  const ignored = new Set(await gitPathQuery(root, ['check-ignore', '--no-index', '--stdin', '-z'], projectPaths, [0, 1], true))
  const notIgnored = projectPaths.find((path) => !ignored.has(path))
  if (notIgnored) {
    throw new Error('Refusing to delete a non-ignored project file declared as structured report: ' + notIgnored)
  }

  const removed = []
  for (const [index, path] of paths.entries()) {
    await assertNoSymlinkSegments(root, path)
    await unlink(path)
    removed.push(projectPaths[index])
  }
  return removed
}

function containsXmlDeclaration(text) {
  // Rendered HTML in MockMvc's CDATA is log text, not an XML DTD. Scan once,
  // skipping inert sections; XMLValidator below still rejects unclosed sections.
  const declaration = /<!\s*(?:DOCTYPE|ENTITY)\b/iy
  let cursor = 0
  while (cursor < text.length) {
    const start = text.indexOf('<', cursor)
    if (start === -1) return false
    const endMarker = text.startsWith('<![CDATA[', start) ? ']]>'
      : text.startsWith('<!--', start) ? '-->'
        : text.startsWith('<?', start) ? '?>' : null
    if (endMarker) {
      const end = text.indexOf(endMarker, start + (endMarker === ']]>' ? 9 : endMarker === '-->' ? 4 : 2))
      if (end === -1) return false
      cursor = end + endMarker.length
    } else {
      declaration.lastIndex = start
      if (declaration.test(text)) return true
      cursor = start + 1
    }
  }
  return false
}

export function parseJUnitXml(text, source = '<inline>', options = {}) {
  const selectedCases = options.selectedCases
  if (selectedCases !== undefined && (!Array.isArray(selectedCases) || selectedCases.length < 1 || selectedCases.length > 256 ||
    selectedCases.some((entry) => typeof entry?.className !== 'string' || typeof entry?.name !== 'string' || entry.className.length > 512 || entry.name.length > 512))) {
    throw new Error('selectedCases must contain 1-256 bounded className/name pairs.')
  }
  const selectedIds = new Set((selectedCases ?? []).map((entry) => JSON.stringify([entry.className, entry.name])))
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 16 * 1024 * 1024) {
    throw new Error(source + ': JUnit XML must be a string no larger than 16 MiB.')
  }
  if (containsXmlDeclaration(text)) {
    throw new Error(source + ': DTD and ENTITY declarations are not allowed in JUnit XML.')
  }
  const validation = XMLValidator.validate(text, { allowBooleanAttributes: false })
  if (validation !== true) {
    const detail = validation?.err?.msg ? ': ' + validation.err.msg : ''
    throw new Error(source + ': malformed JUnit XML' + detail)
  }

  const tree = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    preserveOrder: true,
    processEntities: false,
    removeNSPrefix: true
  }).parse(text)
  const summary = { tests: 0, executed: 0, failures: 0, errors: 0, skipped: 0, failedTests: [] }
  if (selectedCases) summary.selectedTests = []
  let suiteFound = false
  let declaredFailures = 0
  let declaredErrors = 0

  const declaredCount = (attributes, name) => {
    const value = attributes?.[name]
    return typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : 0
  }

  const containsElement = (nodes, expected) => {
    if (!Array.isArray(nodes)) {
      return false
    }
    for (const node of nodes) {
      if (!node || typeof node !== 'object') {
        continue
      }
      for (const [name, children] of Object.entries(node)) {
        if (name === ':@') {
          continue
        }
        if (name === expected || containsElement(children, expected)) {
          return true
        }
      }
    }
    return false
  }

  const countTestcase = (node, children) => {
    const failed = ['failure', 'flakyFailure', 'rerunFailure'].some((element) => containsElement(children, element))
    const errored = ['error', 'flakyError', 'rerunError'].some((element) => containsElement(children, element))
    const skipped = !failed && !errored && containsElement(children, 'skipped')
    summary.tests += 1
    summary.executed += skipped ? 0 : 1
    summary.failures += failed ? 1 : 0
    summary.errors += errored ? 1 : 0
    summary.skipped += skipped ? 1 : 0
    const className = typeof node[':@']?.classname === 'string' ? node[':@'].classname : ''
    const name = typeof node[':@']?.name === 'string' ? node[':@'].name : ''
    if (selectedIds.has(JSON.stringify([className, name]))) {
      if (summary.selectedTests.length >= 512) throw new Error(source + ': too many selected testcase occurrences.')
      summary.selectedTests.push({ className, name, outcome: failed ? 'failed' : errored ? 'error' : skipped ? 'skipped' : 'passed' })
    }
    if (summary.tests > 1_000_000) {
      throw new Error(source + ': JUnit XML exceeds the 1000000-test safety limit.')
    }
    if (failed || errored) {
      const diagnostics = junitFailureDiagnostics(children)
      summary.failedTests.push({
        className: typeof node[':@']?.classname === 'string' ? node[':@'].classname : null,
        name: typeof node[':@']?.name === 'string' ? node[':@'].name : '<unnamed>',
        ...(diagnostics.length ? { diagnostics } : {})
      })
    }
  }

  const visitSuiteChildren = (nodes) => {
    if (!Array.isArray(nodes)) {
      return
    }
    for (const node of nodes) {
      if (!node || typeof node !== 'object') {
        continue
      }
      for (const [name, children] of Object.entries(node)) {
        if (name === ':@') {
          continue
        }
        if (name === 'testsuite') {
          suiteFound = true
          declaredFailures = Math.max(declaredFailures, declaredCount(node[':@'], 'failures'))
          declaredErrors = Math.max(declaredErrors, declaredCount(node[':@'], 'errors'))
          visitSuiteChildren(children)
          continue
        }
        if (name === 'testsuites') {
          visitSuiteChildren(children)
          continue
        }
        if (name === 'testcase') {
          countTestcase(node, children)
          continue
        }
      }
    }
  }

  const roots = []
  for (const node of tree) {
    for (const [name, children] of Object.entries(node)) {
      if (name !== ':@' && !name.startsWith('?') && !name.startsWith('#')) {
        roots.push({ name, children })
      }
    }
  }
  if (roots.length !== 1 || !['testsuite', 'testsuites'].includes(roots[0].name)) {
    throw new Error(source + ': document root must be testsuite or testsuites.')
  }
  visitSuiteChildren(tree)
  if (!suiteFound) {
    throw new Error(source + ': no JUnit testsuite element found.')
  }
  summary.failures = Math.max(summary.failures, declaredFailures)
  summary.errors = Math.max(summary.errors, declaredErrors)
  if ((summary.failures > 0 || summary.errors > 0) && summary.failedTests.length === 0) {
    summary.failedTests.push({ className: null, name: '<suite-declared-failure>' })
  }
  return summary
}

export async function collectJUnitResults(root, patterns, before = new Map(), options = {}) {
  const matched = await findReportFiles(root, patterns)
  const budget = createReportBudget(options)
  const summary = {
    type: 'junit',
    evidenceTier: 'EXECUTED',
    tests: 0,
    executed: 0,
    failures: 0,
    errors: 0,
    skipped: 0,
    failedTests: [],
    reportFiles: [],
    staleReportCount: 0
  }
  let freshCount = 0
  for (const path of matched) {
    const metadata = await stat(path)
    const source = relative(root, path)
    assertReportFileBytes(metadata.size, source)
    const contentBuffer = await readFile(path)
    budget.consume(contentBuffer.length, source)
    const content = contentBuffer.toString('utf8')
    const previous = before.get(path)
    const contentSha256 = createHash('sha256').update(content).digest('hex')
    const changed = !previous ||
      previous.contentSha256 !== contentSha256 ||
      previous.size !== contentBuffer.length ||
      previous.mtimeMs !== metadata.mtimeMs ||
      previous.ctimeMs !== metadata.ctimeMs
    if (!changed) {
      summary.staleReportCount += 1
      continue
    }
    freshCount += 1
    const parsed = parseJUnitXml(content, source)
    summary.tests += parsed.tests
    summary.executed += parsed.executed
    summary.failures += parsed.failures
    summary.errors += parsed.errors
    summary.skipped += parsed.skipped
    summary.failedTests.push(...parsed.failedTests.slice(0, Math.max(0, 50 - summary.failedTests.length)))
    summary.reportFiles.push(relative(root, path).split(sep).join('/'))
  }

  const minimumTests = options.minimumTests ?? 1
  let reason = null
  if (freshCount === 0) {
    reason = matched.length === 0 ? 'junit_reports_missing' : 'junit_reports_stale'
  } else if (summary.staleReportCount > 0) {
    reason = 'junit_reports_mixed_freshness'
  } else if (summary.executed < minimumTests) {
    reason = 'minimum_executed_tests_not_met'
  } else if (summary.failures > 0 || summary.errors > 0) {
    reason = 'tests_failed'
  }
  return { ...summary, minimumTests, passed: reason === null, reason }
}
