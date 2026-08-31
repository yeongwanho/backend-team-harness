#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { access, lstat, mkdir, open, rm, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { resolve, relative, isAbsolute, sep, delimiter } from 'node:path'

const root = process.cwd()
const projectPath = "."
const pythonVenvPath = ".venv"
const framework = "jest"
const testArgs = ["--config","test/bth/jest.config.cjs","--ci","--no-cache"]
const project = resolve(root, projectPath)
const reportDirectory = resolve(root, '.backend-harness/local/reports/tests')
const report = resolve(reportDirectory, 'junit.xml')
const raw = resolve(reportDirectory, 'jest.json')
async function ensureReportDirectory() {
  let directory = root
  for (const segment of ['.backend-harness', 'local', 'reports', 'tests']) {
    directory = resolve(directory, segment)
    try { await mkdir(directory) } catch (error) { if (error.code !== 'EEXIST') throw error }
    const metadata = await lstat(directory)
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('Report directory must not contain symbolic links.')
  }
}
await ensureReportDirectory()

function run(program, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(program, args, { cwd: options.cwd ?? project, env: options.env ?? process.env, shell: false, stdio: 'inherit', windowsHide: true })
    child.once('error', reject)
    child.once('close', (code, signal) => resolvePromise({ code, signal }))
  })
}

function jestJsonToJUnit(document, projectRoot = '') {
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

async function exists(path) {
  try { await access(path, constants.R_OK); return true } catch { return false }
}

let result
if (framework === 'jest') {
  const entry = resolve(project, 'node_modules/jest/bin/jest.js')
  if (!await exists(entry)) throw new Error('Local Jest is missing; install the pinned project dependencies before verification.')
  await rm(raw, { force: true })
  result = await run(process.execPath, [entry, ...testArgs, '--runInBand', '--json', '--outputFile=' + raw])
  await ensureReportDirectory()
  const metadata = await lstat(raw)
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('Jest JSON must be a regular file.')
  const handle = await open(raw, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const opened = await handle.stat()
    const limit = 16 * 1024 * 1024
    if (!opened.isFile() || opened.size > limit) throw new Error('Jest JSON exceeded the regular-file 16 MiB limit.')
    const buffer = Buffer.alloc(Math.min(opened.size + 1, limit + 1))
    let length = 0
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length)
      if (!bytesRead) break
      length += bytesRead
    }
    const after = await handle.stat()
    if (length !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) throw new Error('Jest JSON changed while being read.')
    let document
    try { document = JSON.parse(buffer.toString('utf8', 0, length)) } catch { throw new Error('Jest JSON is malformed.') }
    const output = jestJsonToJUnit(document, project)
    await writeFile(report, output, { encoding: 'utf8', flag: 'wx' })
  } finally {
    await handle.close()
    await rm(raw, { force: true })
  }
} else if (framework === 'vitest') {
  const entry = resolve(project, 'node_modules/vitest/vitest.mjs')
  if (!await exists(entry)) throw new Error('Local Vitest is missing; install the pinned project dependencies before verification.')
  result = await run(process.execPath, [entry, 'run', ...testArgs, '--reporter=junit', '--outputFile=' + report])
} else {
  async function safeDirectory(path) {
    const local = relative(root, path)
    if (isAbsolute(local) || local === '..' || local.startsWith('..' + sep)) throw new Error('Python directory is outside this project.')
    let current = root
    for (const segment of local.split(sep).filter(Boolean)) {
      current = resolve(current, segment)
      let metadata
      try { metadata = await lstat(current) } catch (error) { if (error.code === 'ENOENT') return false; throw error }
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('Python directory must not be a symbolic link or non-directory.')
    }
    return true
  }
  let python = null
  for (const directory of ['.backend-harness/local/python-venv', pythonVenvPath]) {
    const environment = resolve(root, directory)
    if (!await safeDirectory(environment)) continue
    const candidate = resolve(environment, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
    if (await safeDirectory(resolve(candidate, '..')) && await exists(candidate)) { python = candidate; break }
  }
  if (!python) throw new Error('Python environment is missing; prepare the pinned dependencies explicitly before verification. Tests never install packages.')
  if (!await safeDirectory(project)) throw new Error('Python project directory is missing.')
  const sourcePaths = [project]
  if (await safeDirectory(resolve(project, 'src'))) sourcePaths.push(resolve(project, 'src'))
  result = await run(python, ['-m', 'pytest', '--junitxml=' + report, '-o', 'cache_dir=' + resolve(reportDirectory, 'pytest-cache')], {
    cwd: project, env: { ...process.env, PYTHONPATH: sourcePaths.join(delimiter), PYTHONDONTWRITEBYTECODE: '1' }
  })
}

if (result.signal) process.kill(process.pid, result.signal)
process.exitCode = result.code ?? 1
