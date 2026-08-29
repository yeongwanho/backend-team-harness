import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { assertNoSymlinkSegments, resolveReadableRoot, resolveSafeProjectPath, statPath } from '../fs-safety.mjs'
import { taskDirectory } from './task-store.mjs'

function compactGate(gate) {
  return {
    id: gate.id,
    required: gate.required,
    outcome: gate.outcome,
    reason: gate.reason ?? null,
    command: gate.command ?? null,
    process: gate.process ? {
      exitCode: gate.process.exitCode,
      signal: gate.process.signal,
      timedOut: gate.process.timedOut,
      durationMs: gate.process.durationMs,
      stdout: { sha256: gate.process.stdout.sha256, bytes: gate.process.stdout.bytes },
      stderr: { sha256: gate.process.stderr.sha256, bytes: gate.process.stderr.bytes }
    } : null,
    result: gate.result ? {
      tests: gate.result.tests,
      failures: gate.result.failures,
      errors: gate.result.errors,
      skipped: gate.result.skipped,
      minimumTests: gate.result.minimumTests,
      reportFiles: gate.result.reportFiles,
      staleReportCount: gate.result.staleReportCount,
      failedTests: gate.result.failedTests,
      error: gate.result.error ?? null
    } : null
  }
}

async function atomicWrite(target, content) {
  const temporary = resolve(dirname(target), '.bth-' + randomUUID() + '.tmp')
  await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  try {
    await rename(temporary, target)
  } catch (error) {
    await unlink(temporary).catch(() => {})
    throw error
  }
}

function createRunRecord(taskId, input, rerun) {
  const base = {
    schemaVersion: 1,
    taskId,
    recordedAt: input.recordedAt ?? new Date().toISOString(),
    verdict: input.confirmed ? 'passed' : 'failed',
    source: input.sourceBinding,
    configuration: input.result?.configuration ?? null,
    verificationReason: input.result?.reason ?? null,
    sourceStable: input.result?.sourceStable ?? null,
    postSourceFingerprint: input.result?.postSourceFingerprint ?? null,
    tests: input.result?.tests ?? { tests: 0, failures: 0, errors: 0, skipped: 0 },
    gates: (input.result?.gates ?? []).map(compactGate),
    failure: input.failure ?? null,
    localEvidenceId: input.evidenceId,
    rerun,
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch
    }
  }
  return {
    ...base,
    recordSha256: createHash('sha256').update(JSON.stringify(base)).digest('hex')
  }
}

export async function recordRun(inputPath, taskId, input) {
  const paths = await taskDirectory(inputPath, taskId)
  const runsDir = resolve(paths.taskDir, 'runs')
  await assertNoSymlinkSegments(paths.taskDir, runsDir)
  await mkdir(runsDir, { recursive: true })
  await assertNoSymlinkSegments(paths.taskDir, runsDir)

  const record = createRunRecord(paths.id, input, ['bth', 'verify', paths.id, '.'])
  const target = resolve(runsDir, 'latest.json')
  await atomicWrite(target, JSON.stringify(record, null, 2) + '\n')
  return { record, path: relative(paths.root, target) }
}

export async function recordProjectRun(inputPath, input) {
  const root = await resolveReadableRoot(inputPath)
  const harnessRoot = await resolveSafeProjectPath(root, '.backend-harness')
  const harnessStat = await statPath(harnessRoot)
  if (!harnessStat?.isDirectory() || harnessStat.isSymbolicLink()) {
    throw new Error('Shared contract is missing. Run `bth init <path>` first.')
  }
  const runsDir = await resolveSafeProjectPath(root, '.backend-harness/local/runs')
  await mkdir(runsDir, { recursive: true })
  await assertNoSymlinkSegments(harnessRoot, runsDir)
  const record = createRunRecord(null, input, ['bth', 'check', '.'])
  const target = resolve(runsDir, 'latest.json')
  await atomicWrite(target, JSON.stringify(record, null, 2) + '\n')
  return { record, path: relative(root, target) }
}
