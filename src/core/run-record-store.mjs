import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { assertNoSymlinkSegments, resolveReadableRoot, resolveSafeProjectPath, statPath } from '../fs-safety.mjs'
import { taskDirectory } from './task-store.mjs'
import { canonicalJson } from './canonical-json.mjs'
import { evidenceTierFor } from './evidence-tier.mjs'
import { redactForShare } from './redaction.mjs'
import { compactExecutionDiagnostics } from './execution-diagnostics.mjs'

function compactGate(gate) {
  return {
    id: gate.id,
    required: gate.required,
    network: gate.network ?? false,
    outcome: gate.outcome,
    reason: gate.reason ?? null,
    evidenceTier: gate.evidenceTier ?? null,
    command: gate.command ?? null,
    executionDiagnostics: compactExecutionDiagnostics(gate.executionDiagnostics),
    process: gate.process ? {
      exitCode: gate.process.exitCode,
      signal: gate.process.signal,
      timedOut: gate.process.timedOut,
      stdioDrainTimedOut: gate.process.stdioDrainTimedOut ?? false,
      durationMs: gate.process.durationMs,
      stdout: { sha256: gate.process.stdout.sha256, bytes: gate.process.stdout.bytes },
      stderr: { sha256: gate.process.stderr.sha256, bytes: gate.process.stderr.bytes }
    } : null,
    result: gate.result ? {
      type: gate.result.type,
      evidenceTier: gate.result.evidenceTier,
      tests: gate.result.tests,
      executed: gate.result.executed,
      failures: gate.result.failures,
      errors: gate.result.errors,
      skipped: gate.result.skipped,
      minimumTests: gate.result.minimumTests,
      reportFiles: gate.result.reportFiles,
      staleReportCount: gate.result.staleReportCount,
      failedTests: gate.result.failedTests,
      counts: gate.result.counts,
      blockingCount: gate.result.blockingCount,
      metrics: gate.result.metrics,
      tools: gate.result.tools,
      reportDigests: gate.result.reportDigests,
      findings: gate.result.findings,
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

function createRunRecord(taskId, input, rerun, projectRoot) {
  const rerunCommand = input.result?.gates?.some((gate) => gate.network)
    ? [...rerun, '--acknowledge-network-risk']
    : rerun
  const base = {
    schemaVersion: 2,
    evidenceTier: evidenceTierFor(input),
    taskId,
    recordedAt: input.recordedAt ?? new Date().toISOString(),
    verdict: input.confirmed ? 'passed' : 'failed',
    source: input.sourceBinding,
    configuration: input.result?.configuration ?? null,
    toolchain: input.result?.toolchain ?? null,
    networkPolicy: input.result?.networkPolicy ?? {
      declaredNetworkGate: false,
      riskAcknowledged: false,
      egressIsolation: 'not-enforced'
    },
    verificationReason: input.result?.reason ?? null,
    sourceStable: input.result?.sourceStable ?? null,
    postSourceFingerprint: input.result?.postSourceFingerprint ?? null,
    scheduling: input.result?.scheduling ?? null,
    tests: input.result?.tests ?? { tests: 0, executed: 0, failures: 0, errors: 0, skipped: 0 },
    reported: input.result?.reported ?? [],
    gates: (input.result?.gates ?? []).map(compactGate),
    failure: input.failure ?? null,
    localEvidenceId: input.evidenceId,
    rerun: rerunCommand,
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch
    }
  }
  const redacted = redactForShare(base, { projectRoot })
  const sealed = { ...redacted.value, redactionsApplied: redacted.redactionsApplied }
  return {
    ...sealed,
    recordSha256: createHash('sha256').update(canonicalJson(sealed)).digest('hex')
  }
}

async function writeRunFiles(root, runsDir, record) {
  const historyDir = resolve(runsDir, 'history')
  await mkdir(historyDir, { recursive: true })
  await assertNoSymlinkSegments(runsDir, historyDir)
  const stamp = record.recordedAt.replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
  const history = resolve(historyDir, stamp + '-' + record.recordSha256.slice(0, 12) + '-' + randomUUID().slice(0, 8) + '.json')
  await writeFile(history, JSON.stringify(record, null, 2) + '\n', {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600
  })
  const target = resolve(runsDir, 'latest.json')
  await atomicWrite(target, JSON.stringify(record, null, 2) + '\n')
  return { path: relative(root, target), historyPath: relative(root, history) }
}

export async function recordRun(inputPath, taskId, input) {
  const paths = await taskDirectory(inputPath, taskId)
  const runsDir = resolve(paths.taskDir, 'runs')
  await assertNoSymlinkSegments(paths.taskDir, runsDir)
  await mkdir(runsDir, { recursive: true })
  await assertNoSymlinkSegments(paths.taskDir, runsDir)

  const record = createRunRecord(paths.id, input, ['bth', 'verify', paths.id, '.'], paths.root)
  return { record, ...await writeRunFiles(paths.root, runsDir, record) }
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
  const record = createRunRecord(null, input, ['bth', 'check', '.'], root)
  return { record, ...await writeRunFiles(root, runsDir, record) }
}

export async function loadLatestTaskRun(inputPath, taskId) {
  const paths = await taskDirectory(inputPath, taskId)
  const target = resolve(paths.taskDir, 'runs/latest.json')
  await assertNoSymlinkSegments(paths.taskDir, target)
  const metadata = await statPath(target)
  if (!metadata?.isFile() || metadata.isSymbolicLink() || metadata.size > 16 * 1024 * 1024) {
    throw new Error('Latest task run is missing, unsafe, or too large: ' + paths.id)
  }
  const record = JSON.parse(await readFile(target, 'utf8'))
  const { recordSha256, ...unsigned } = record
  const expected = createHash('sha256').update(canonicalJson(unsigned)).digest('hex')
  if (recordSha256 !== expected || record.taskId !== paths.id) {
    throw new Error('Latest task run is altered or belongs to a different task: ' + paths.id)
  }
  return { root: paths.root, path: relative(paths.root, target), record }
}
