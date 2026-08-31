import { readFile } from 'node:fs/promises'
import { posix } from 'node:path'
import { resolveSafeProjectPath, statPath } from '../fs-safety.mjs'
import { jestJsonToJUnit } from './jest-report.mjs'
import { inspectJestModuleSearch } from './jest-module-resolution.mjs'
import { inspectPythonTestProjects } from './python-project.mjs'

const MAX_BUILD_BYTES = 1024 * 1024
const MAX_CANDIDATES = 32

async function boundedText(root, path) {
  const target = await resolveSafeProjectPath(root, path)
  const metadata = await statPath(target)
  if (!metadata?.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_BUILD_BYTES) return null
  return readFile(target, 'utf8')
}

function parent(path) {
  const value = posix.dirname(path)
  return value === '.' ? '.' : value
}

function under(directory, name) {
  return directory === '.' ? name : directory + '/' + name
}

function dependenciesOf(document) {
  return { ...(document.dependencies ?? {}), ...(document.devDependencies ?? {}), ...(document.peerDependencies ?? {}) }
}

const SAFE_NODE_TEST_TOKEN = /^[A-Za-z0-9_./:@,+%=-]+$/
const SHELL_TEST_SYNTAX = /[;&|><`'"$\\\r\n]/
const MAX_TEST_ARGUMENTS = 32
const MAX_TEST_SCRIPT_BYTES = 4096

function conflictsWithHarnessReporter(framework, argument) {
  const normalized = argument.toLowerCase()
  if (normalized === '--watch' || normalized === '--watchall' || normalized === '--watchall=false' || normalized === '--ui') return true
  if (framework === 'jest') {
    return normalized === '--json' || normalized.startsWith('--outputfile')
  }
  return normalized === '--run' || normalized.startsWith('--reporter') || normalized.startsWith('--outputfile')
}

function parseDirectNodeTestScript(script, framework) {
  const trimmed = script.trim()
  if (!trimmed || Buffer.byteLength(trimmed) > MAX_TEST_SCRIPT_BYTES || SHELL_TEST_SYNTAX.test(trimmed)) return null
  const tokens = trimmed.split(/\s+/)
  if (tokens.shift() !== framework || tokens.length > MAX_TEST_ARGUMENTS) return null
  if (framework === 'vitest' && tokens[0] === 'run') tokens.shift()
  if (tokens.some((argument) => !SAFE_NODE_TEST_TOKEN.test(argument) || conflictsWithHarnessReporter(framework, argument))) return null
  return tokens.filter((argument) => !(framework === 'jest' && argument.toLowerCase() === '--runinband'))
}

async function nodeCandidates(root, manifest) {
  const results = []
  for (const path of manifest.files.filter((entry) => entry === 'package.json' || entry.endsWith('/package.json')).slice(0, MAX_CANDIDATES)) {
    const text = await boundedText(root, path)
    if (!text) continue
    let document
    try { document = JSON.parse(text) } catch { continue }
    const script = typeof document.scripts?.test === 'string' ? document.scripts.test : ''
    const dependencies = dependenciesOf(document)
    const jestArgs = typeof dependencies.jest === 'string' ? parseDirectNodeTestScript(script, 'jest') : null
    const vitestArgs = typeof dependencies.vitest === 'string' ? parseDirectNodeTestScript(script, 'vitest') : null
    const framework = jestArgs ? 'jest' : vitestArgs ? 'vitest' : null
    if (!framework) continue
    const projectPath = parent(path)
    const buildInputs = [path]
    const moduleSearch = framework === 'jest' ? await inspectJestModuleSearch(root, projectPath, document, jestArgs) : null
    if (moduleSearch) buildInputs.push(moduleSearch.source)
    for (const lock of ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb']) {
      const candidate = under(projectPath, lock)
      if (manifest.files.includes(candidate)) buildInputs.push(candidate)
    }
    results.push({
      system: 'node-' + framework,
      framework,
      projectPath,
      buildInputs,
      ...(moduleSearch ? { moduleSearchPath: moduleSearch.path } : {}),
      testArgs: framework === 'jest' ? jestArgs : vitestArgs
    })
  }
  return results
}

export async function inspectPortableTestBuild(root, manifest) {
  const candidates = [...await nodeCandidates(root, manifest), ...await inspectPythonTestProjects(root, manifest)]
  if (candidates.length !== 1) {
    return {
      status: candidates.length > 1 ? 'conflict' : 'unknown',
      system: null,
      label: candidates.length > 1 ? 'ambiguous-portable-tests' : 'unknown',
      framework: 'unknown',
      projectPath: null,
      buildInputs: [],
      canGenerateVerification: false,
      candidates,
      diagnostics: candidates.length > 1
        ? ['Multiple portable test projects were detected; select one explicitly instead of guessing.']
        : ['No unique Jest, Vitest, or Pytest project was detected from bounded build metadata.']
    }
  }
  const selected = candidates[0]
  if (selected.metadataIssue) return { ...selected, status: 'unknown', canGenerateVerification: false, label: 'unresolved-python-layout', candidates, diagnostics: [selected.metadataIssue] }
  return {
    status: 'confirmed',
    ...selected,
    label: selected.projectPath === '.' ? selected.system : selected.system + ':' + selected.projectPath,
    canGenerateVerification: true,
    candidates,
    diagnostics: []
  }
}

function portableRunnerSource(detection) {
  const projectPath = JSON.stringify(detection.projectPath)
  const pythonVenvPath = JSON.stringify(detection.venvPath ?? under(detection.projectPath, '.venv'))
  const framework = JSON.stringify(detection.framework)
  const testArgs = JSON.stringify(detection.testArgs ?? [])
  const moduleSearchArgument = detection.moduleSearchPath === undefined ? ''
    : "'--modulePaths=' + resolve(project, " + JSON.stringify(detection.moduleSearchPath) + '), '
  return `#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { access, lstat, mkdir, open, rm, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { resolve, relative, isAbsolute, sep, delimiter } from 'node:path'

const root = process.cwd()
const projectPath = ${projectPath}
const pythonVenvPath = ${pythonVenvPath}
const framework = ${framework}
const testArgs = ${testArgs}
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

${jestJsonToJUnit.toString()}

async function exists(path) {
  try { await access(path, constants.R_OK); return true } catch { return false }
}

let result
if (framework === 'jest') {
  const entry = resolve(project, 'node_modules/jest/bin/jest.js')
  if (!await exists(entry)) throw new Error('Local Jest is missing; install the pinned project dependencies before verification.')
  await rm(raw, { force: true })
  result = await run(process.execPath, [entry, ...testArgs, ${moduleSearchArgument}'--runInBand', '--json', '--outputFile=' + raw])
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
`
}

export function harnessGitAttributesTemplate() {
  return {
    path: '.backend-harness/.gitattributes',
    content: '# Preserve harness contract bytes across Git checkouts.\n* -text\n*.cmd whitespace=cr-at-eol\n'
  }
}

export function portableVerificationTemplates(detection) {
  if (!detection?.canGenerateVerification) return []
  return [
    {
      path: '.backend-harness/bin/verify-portable.mjs',
      content: portableRunnerSource(detection)
    },
    {
      path: '.backend-harness/bin/verify-portable',
      executable: true,
      content: '#!/bin/sh\nexec "$BTH_NODE" ".backend-harness/bin/verify-portable.mjs"\n'
    },
    {
      path: '.backend-harness/bin/verify-portable.cmd',
      content: '@echo off\r\n"%BTH_NODE%" ".backend-harness\\bin\\verify-portable.mjs"\r\n'
    },
    harnessGitAttributesTemplate()
  ]
}

export function portableVerificationConfig(detection) {
  if (!detection?.canGenerateVerification) return null
  return {
    schemaVersion: 1,
    context: { profile: 'test', databaseDialect: null },
    gates: [{
      id: 'tests',
      required: true,
      feedback: true,
      pathPrefixes: [detection.projectPath === '.' ? '' : detection.projectPath].filter(Boolean),
      command: ['./.backend-harness/bin/verify-portable'],
      inputs: [
        ...detection.buildInputs,
        '.backend-harness/.gitattributes',
        '.backend-harness/bin/verify-portable.mjs',
        '.backend-harness/bin/verify-portable.cmd'
      ],
      timeoutMs: 600000,
      result: {
        type: 'junit',
        reports: ['.backend-harness/local/reports/tests/*.xml'],
        minimumTests: 1
      }
    }]
  }
}
