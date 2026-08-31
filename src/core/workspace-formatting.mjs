import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { dirname, relative } from 'node:path'
import { resolveSafeProjectPath, statPath } from '../fs-safety.mjs'
import { resolveImplementationExecutable } from '../config/implementation.mjs'
import { verificationInputPaths } from '../config/verification.mjs'
import { projectExecutableForPlatform } from './platform.mjs'
import { snapshotImplementedFiles } from './implementation-record-store.mjs'
import { buildSafeEnvironment, runProcess } from './process-runner.mjs'
import { bthError } from './errors.mjs'

const MAX_BACKUP_BYTES = 32 * 1024 * 1024
const normalized = path => path.replaceAll('\\', '/').replace(/^\.\//, '')

export async function assertFormattingContract(root, formatting, verification, options = {}) {
  if (!formatting) return
  if (formatting.network && options.allowNetwork !== true) throw bthError('formatting_network_not_acknowledged', 'Formatting may use the network; pass --acknowledge-network-risk. OS egress is not isolated.')
  const executable = projectExecutableForPlatform(formatting.command[0], options.platform)
  const declared = new Set(verificationInputPaths(verification, options).map(normalized))
  for (const input of [executable, ...formatting.inputs]) {
    if (!declared.has(normalized(input))) throw bthError('formatting_input_not_bound', 'Declare the formatter executable and config in verification Gate inputs before approving work: ' + input)
    await resolveSafeProjectPath(root, input)
  }
  await resolveImplementationExecutable(root, [executable])
}

async function backupCandidate(workspace, sourceRoot, paths) {
  const before = await snapshotImplementedFiles(workspace, paths)
  let expectedBytes = 0
  for (const entry of before) {
    if (entry.kind === 'missing') continue
    const metadata = await statPath(await resolveSafeProjectPath(workspace, entry.path))
    expectedBytes += metadata?.size ?? MAX_BACKUP_BYTES + 1
    if (expectedBytes > MAX_BACKUP_BYTES) throw bthError('formatting_backup_limit', 'Pre-format recovery snapshot exceeds its 32 MiB limit; formatter was not run.')
  }
  const parent = await resolveSafeProjectPath(sourceRoot, '.backend-harness/local/formatting')
  await mkdir(parent, { recursive: true, mode: 0o700 })
  const directory = await mkdtemp(parent + '/candidate-')
  let bytes = 0
  for (const entry of before) {
    if (entry.kind === 'missing') continue
    const source = await resolveSafeProjectPath(workspace, entry.path)
    const metadata = await statPath(source)
    if (!metadata?.isFile() || bytes + metadata.size > MAX_BACKUP_BYTES) throw bthError('formatting_backup_limit', 'Pre-format recovery snapshot exceeds its 32 MiB limit or is unavailable; formatter was not run.')
    const content = await readFile(source)
    bytes += content.length
    if (bytes > MAX_BACKUP_BYTES || createHash('sha256').update(content).digest('hex') !== entry.contentSha256) throw bthError('formatting_backup_changed', 'Candidate changed during pre-format backup; formatter was not run.')
    const target = await resolveSafeProjectPath(directory, entry.path)
    await mkdir(dirname(target), { recursive: true, mode: 0o700 })
    await writeFile(target, content, { flag: 'wx', mode: 0o600 })
  }
  // Separate metadata name cannot collide with a changed project path.
  const manifest = directory + '.json'
  await writeFile(manifest, JSON.stringify({ schemaVersion: 1, bytes, files: before }) + '\n', { flag: 'wx', mode: 0o600 })
  return { before, backup: normalized(relative(sourceRoot, directory)), backupBytes: bytes }
}

function processSummary(process) {
  if (!process) return null
  return { exitCode: process.exitCode, signal: process.signal, timedOut: process.timedOut,
    stdioDrainTimedOut: process.stdioDrainTimedOut, durationMs: process.durationMs,
    stdout: { bytes: process.stdout.bytes, sha256: process.stdout.sha256 },
    stderr: { bytes: process.stderr.bytes, sha256: process.stderr.sha256 } }
}

// Call only after the provider boundary has passed. The caller must recheck
// Git/control inputs and the complete inventory after this mutating stage.
export async function runWorkspaceFormatting(workspace, sourceRoot, formatting, paths, options = {}) {
  const started = performance.now()
  let snapshot = null, process = null, failureCode = null
  try {
    snapshot = await backupCandidate(workspace, sourceRoot, paths)
    const command = [projectExecutableForPlatform(formatting.command[0]), ...formatting.command.slice(1)]
    const executable = await resolveImplementationExecutable(workspace, command)
    process = await (options.runner ?? runProcess)({ program: executable.path, args: command.slice(1), cwd: workspace,
      timeoutMs: formatting.timeoutMs, env: buildSafeEnvironment() })
    if (process.exitCode !== 0 || process.signal !== null || process.timedOut || process.stdioDrainTimedOut) failureCode = 'formatting_process_failed'
  } catch (error) { failureCode = error.code?.startsWith('formatting_') ? error.code : 'formatting_execution_failed' }
  let integrityFailure = false
  let changedPaths = []
  if (snapshot) {
    try {
      const after = await snapshotImplementedFiles(workspace, paths)
      integrityFailure = after.some((file, i) => file.kind !== snapshot.before[i].kind || file.executable !== snapshot.before[i].executable)
      changedPaths = after.filter((file, i) => file.contentSha256 !== snapshot.before[i].contentSha256).map(file => file.path)
    } catch { integrityFailure = true }
  }
  return { status: failureCode || integrityFailure ? 'failed' : 'passed', failureCode,
    integrityFailure, changedPaths, backup: snapshot?.backup ?? null, backupBytes: snapshot?.backupBytes ?? 0,
    durationMs: Math.round(performance.now() - started), process: processSummary(process),
    networkRiskAcknowledged: formatting.network === true && options.allowNetwork === true, egressIsolation: 'not-enforced' }
}
