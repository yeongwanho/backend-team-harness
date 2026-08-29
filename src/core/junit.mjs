import { readdir, readFile, stat } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { assertNoSymlinkSegments, resolveSafeProjectPath, statPath } from '../fs-safety.mjs'

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
}

function globRegex(pattern) {
  let expression = '^'
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]
    if (char === '*' && pattern[index + 1] === '*') {
      index += 1
      if (pattern[index + 1] === '/') {
        index += 1
        expression += '(?:.*/)?'
      } else {
        expression += '.*'
      }
    } else if (char === '*') {
      expression += '[^/]*'
    } else if (char === '?') {
      expression += '[^/]'
    } else {
      expression += escapeRegex(char)
    }
  }
  return new RegExp(expression + '$')
}

function fixedGlobBase(pattern) {
  const segments = pattern.split('/')
  const fixed = []
  for (const segment of segments) {
    if (/[*?]/.test(segment)) {
      break
    }
    fixed.push(segment)
  }
  if (fixed.length === segments.length) {
    fixed.pop()
  }
  return fixed.join('/') || '.'
}

async function filesForPattern(root, pattern) {
  const matcher = globRegex(pattern)
  const base = await resolveSafeProjectPath(root, fixedGlobBase(pattern))
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
      if (entry.isSymbolicLink()) {
        continue
      }
      const path = resolve(directory, entry.name)
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

export async function snapshotReportFiles(root, patterns) {
  const snapshot = new Map()
  for (const path of await findReportFiles(root, patterns)) {
    const metadata = await stat(path)
    snapshot.set(path, {
      size: metadata.size,
      mtimeMs: metadata.mtimeMs,
      ctimeMs: metadata.ctimeMs
    })
  }
  return snapshot
}

function decodeXml(value) {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
}

function attribute(source, name) {
  const match = source.match(new RegExp('(?:^|\\s)' + name + '=(?:"([^"]*)"|\'([^\']*)\')', 'i'))
  return match ? decodeXml(match[1] ?? match[2] ?? '') : null
}

function numericAttribute(source, name) {
  const value = attribute(source, name)
  if (value === null || !/^\d+$/.test(value)) {
    return 0
  }
  return Number(value)
}

export function parseJUnitXml(text, source = '<inline>') {
  const summary = { tests: 0, failures: 0, errors: 0, skipped: 0, failedTests: [] }
  const testCasePattern = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase\s*>)/gi
  let match
  while ((match = testCasePattern.exec(text))) {
    const attributes = match[1]
    const body = match[2] ?? ''
    const failed = /<failure\b/i.test(body)
    const errored = /<error\b/i.test(body)
    const skipped = /<skipped\b/i.test(body)
    summary.tests += 1
    summary.failures += failed ? 1 : 0
    summary.errors += errored ? 1 : 0
    summary.skipped += skipped ? 1 : 0
    if (failed || errored) {
      summary.failedTests.push({
        className: attribute(attributes, 'classname'),
        name: attribute(attributes, 'name') ?? '<unnamed>'
      })
    }
  }

  if (summary.tests === 0) {
    const suites = [...text.matchAll(/<testsuite\b([^>]*)>/gi)]
    for (const suite of suites) {
      summary.tests += numericAttribute(suite[1], 'tests')
      summary.failures += numericAttribute(suite[1], 'failures')
      summary.errors += numericAttribute(suite[1], 'errors')
      summary.skipped += numericAttribute(suite[1], 'skipped')
    }
  }
  if (!/<testsuites?\b/i.test(text)) {
    throw new Error(source + ': no JUnit testsuite element found.')
  }
  if (!/<\/testsuites?\s*>/i.test(text) && !/<testsuite\b[^>]*\/>/i.test(text)) {
    throw new Error(source + ': JUnit testsuite is not closed.')
  }
  return summary
}

export async function collectJUnitResults(root, patterns, before = new Map(), options = {}) {
  const matched = await findReportFiles(root, patterns)
  const fresh = []
  const stale = []
  for (const path of matched) {
    const metadata = await stat(path)
    const previous = before.get(path)
    const changed = !previous || previous.size !== metadata.size ||
      previous.mtimeMs !== metadata.mtimeMs || previous.ctimeMs !== metadata.ctimeMs
    ;(changed ? fresh : stale).push(path)
  }

  const summary = {
    tests: 0,
    failures: 0,
    errors: 0,
    skipped: 0,
    failedTests: [],
    reportFiles: [],
    staleReportCount: stale.length
  }
  for (const path of fresh) {
    const parsed = parseJUnitXml(await readFile(path, 'utf8'), relative(root, path))
    summary.tests += parsed.tests
    summary.failures += parsed.failures
    summary.errors += parsed.errors
    summary.skipped += parsed.skipped
    summary.failedTests.push(...parsed.failedTests.slice(0, Math.max(0, 50 - summary.failedTests.length)))
    summary.reportFiles.push(relative(root, path).split(sep).join('/'))
  }

  const minimumTests = options.minimumTests ?? 1
  let reason = null
  if (fresh.length === 0) {
    reason = matched.length === 0 ? 'junit_reports_missing' : 'junit_reports_stale'
  } else if (summary.tests < minimumTests) {
    reason = 'minimum_tests_not_met'
  } else if (summary.failures > 0 || summary.errors > 0) {
    reason = 'tests_failed'
  }
  return { ...summary, minimumTests, passed: reason === null, reason }
}
