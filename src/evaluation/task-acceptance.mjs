import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { parseJUnitXml } from '../core/junit.mjs'
import { buildSafeEnvironment, runProcess } from '../core/process-runner.mjs'
import { resolveGateExecutable } from '../config/verification.mjs'
import { resolveSafeProjectPath } from '../fs-safety.mjs'
import { parseTaskAcceptance } from './provider-benchmark-config.mjs'

const execute = promisify(execFile)
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')

async function git(root, args, encoding = 'utf8') {
  const result = await execute('git', args, { cwd: root, encoding, maxBuffer: 16 * 1024 * 1024, env: buildSafeEnvironment() })
  return result.stdout
}

async function sourceFiles(root) {
  const paths = await git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
  const result = []
  let bytes = 0
  for (const path of [...new Set(paths.split('\0').filter(Boolean))].sort()) {
    if (path === '.backend-harness' || path.startsWith('.backend-harness/')) continue
    const absolute = await resolveSafeProjectPath(root, path)
    const metadata = await lstat(absolute).catch((error) => { if (error.code === 'ENOENT') return null; throw error })
    if (!metadata) { result.push({ path, deleted: true }); continue }
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('Oracle source must contain only regular files.')
    bytes += metadata.size
    if (metadata.size > 16 * 1024 * 1024 || bytes > 128 * 1024 * 1024 || result.length >= 20_000) throw new Error('Oracle source exceeds the bounded snapshot budget.')
    result.push({ path, mode: metadata.mode & 0o777, sha256: digest(await readFile(absolute)) })
  }
  return result
}

async function snapshot(root) {
  return { head: (await git(root, ['rev-parse', 'HEAD'])).trim(), files: await sourceFiles(root) }
}

async function cloneAt(source, ref, destination) {
  await git(undefined, ['clone', '--quiet', '--no-checkout', '--no-hardlinks', '--', source, destination])
  const tree = await git(destination, ['ls-tree', '-r', ref])
  if (tree.split('\n').some((line) => /^(120000|160000) /.test(line))) throw new Error('Oracle snapshots cannot contain symlinks or submodules.')
  await git(destination, ['checkout', '--quiet', '--detach', ref])
  // This is a newly allocated evaluator clone, never a caller's workspace.
  await rm(join(destination, '.backend-harness'), { recursive: true, force: true })
}

async function copyCandidate(source, destination, before) {
  await cloneAt(source, before.head, destination)
  for (const file of before.files) {
    const target = await resolveSafeProjectPath(destination, file.path)
    if (file.deleted) { await rm(target, { force: true }); continue }
    const original = await resolveSafeProjectPath(source, file.path)
    await mkdir(dirname(target), { recursive: true })
    await copyFile(original, target)
    await chmod(target, file.mode)
  }
  if (digest(JSON.stringify(await sourceFiles(source))) !== digest(JSON.stringify(before.files))) throw new Error('Candidate changed during oracle snapshot.')
  if (digest(JSON.stringify(await snapshot(destination))) !== digest(JSON.stringify(before))) throw new Error('Oracle snapshot does not match the candidate.')
}

function compactProcess(result) {
  return {
    exitCode: result.exitCode, signal: result.signal, timedOut: result.timedOut,
    stdioDrainTimedOut: result.stdioDrainTimedOut, durationMs: result.durationMs,
    stdout: { sha256: result.stdout.sha256, bytes: result.stdout.bytes },
    stderr: { sha256: result.stderr.sha256, bytes: result.stderr.bytes }
  }
}

async function runOracle(root, oracle, testFiles, timeoutMs, processRunner) {
  for (const file of testFiles) {
    const path = await resolveSafeProjectPath(root, file.path)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, file.bytes)
  }
  for (const report of oracle.reports) await rm(await resolveSafeProjectPath(root, report), { force: true })
  const before = digest(JSON.stringify(await snapshot(root)))
  const executable = await resolveGateExecutable(root, oracle.command)
  const process = await processRunner({ program: executable.path, args: oracle.command.slice(1), cwd: root, timeoutMs, env: buildSafeEnvironment() })
  const sourceStable = before === digest(JSON.stringify(await snapshot(root)))
  const reports = []
  const selected = []
  let reportError = false
  let failures = 0, errors = 0
  for (const report of oracle.reports) {
    try {
      const path = await resolveSafeProjectPath(root, report)
      const metadata = await lstat(path)
      if (!metadata.isFile() || metadata.size > 16 * 1024 * 1024) throw new Error('Invalid oracle report.')
      const bytes = await readFile(path)
      const parsed = parseJUnitXml(bytes.toString('utf8'), report, { selectedCases: oracle.cases })
      selected.push(...parsed.selectedTests)
      failures += parsed.failures
      errors += parsed.errors
      reports.push({ path: report, sha256: digest(bytes), bytes: bytes.length })
    } catch { reportError = true }
  }
  const cases = oracle.cases.map((expected) => {
    const matches = selected.filter((entry) => entry.className === expected.className && entry.name === expected.name)
    return { ...expected, outcome: matches.length === 1 ? matches[0].outcome : matches.length ? 'duplicate' : 'missing' }
  })
  const processFinished = !process.signal && !process.timedOut && !process.stdioDrainTimedOut && Number.isInteger(process.exitCode)
  const casesExecuted = !reportError && cases.every((entry) => ['passed', 'failed', 'error'].includes(entry.outcome))
  return {
    sourceStable, process: compactProcess(process), reports, cases,
    passed: sourceStable && processFinished && process.exitCode === 0 && casesExecuted && cases.every((entry) => entry.outcome === 'passed') && failures === 0 && errors === 0,
    regressionReproduced: sourceStable && processFinished && process.exitCode !== 0 && casesExecuted && cases.some((entry) => ['failed', 'error'].includes(entry.outcome))
  }
}

export async function evaluateTaskAcceptance(input, options = {}) {
  const oracle = parseTaskAcceptance(input.acceptance)
  if (!oracle) return { controlsConfirmed: false, candidatePassed: null, reason: 'task-oracle-not-defined' }
  if (!/^[a-f0-9]{40}$/.test(input.task?.baseSha) || !/^[a-f0-9]{40}$/.test(input.task?.targetSha)) throw new Error('Oracle requires full pinned base and target SHAs.')
  const timeoutMs = input.timeoutMs ?? 120_000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000) throw new Error('Oracle timeout is invalid.')
  const processRunner = options.processRunner ?? runProcess
  const directory = await mkdtemp(join(tmpdir(), 'bth-acceptance-'))
  const startedAt = Date.now()
  try {
    const testFiles = []
    for (const path of oracle.testPaths) {
      const tree = (await git(input.mirror, ['ls-tree', input.task.targetSha, '--', path])).trim()
      if (!/^100(?:644|755) blob /.test(tree)) throw new Error('Oracle test path is not a pinned regular file: ' + path)
      testFiles.push({ path, bytes: await git(input.mirror, ['show', input.task.targetSha + ':' + path], 'buffer') })
    }
    const controls = {}
    for (const [name, ref] of [['base', input.task.baseSha], ['target', input.task.targetSha]]) {
      const root = join(directory, name)
      await cloneAt(input.mirror, ref, root)
      controls[name] = await runOracle(root, oracle, testFiles, timeoutMs, processRunner)
    }
    const controlsConfirmed = controls.base.regressionReproduced && controls.target.passed
    let candidate = null
    let candidateSourceSha256 = null
    let candidateUntouched = null
    if (controlsConfirmed && input.candidateRoot) {
      const before = await snapshot(input.candidateRoot)
      candidateSourceSha256 = digest(JSON.stringify(before))
      const root = join(directory, 'candidate')
      await copyCandidate(input.candidateRoot, root, before)
      candidate = await runOracle(root, oracle, testFiles, timeoutMs, processRunner)
      candidateUntouched = candidateSourceSha256 === digest(JSON.stringify(await snapshot(input.candidateRoot)))
    }
    return {
      schemaVersion: 1, kind: oracle.kind, controlsConfirmed,
      candidatePassed: candidate ? candidate.passed && candidateUntouched : null,
      candidateSourceSha256, candidateUntouched,
      reason: !controlsConfirmed ? 'oracle-controls-not-confirmed' : candidate ? null : 'candidate-not-provided',
      oracleSha256: digest(JSON.stringify({ oracle, base: input.task.baseSha, target: input.task.targetSha })),
      testFiles: testFiles.map((file) => ({ path: file.path, sha256: digest(file.bytes) })),
      controls, candidate, elapsedMs: Date.now() - startedAt
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
