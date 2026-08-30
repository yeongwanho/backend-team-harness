import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { configureImplementationProvider } from '../src/config/implementation-setup.mjs'
import { redactForShare } from '../src/core/redaction.mjs'
import { implementationStatus, resetImplementation } from '../src/runtime/implementation-orchestrator.mjs'
import { runWork } from '../src/runtime/work-orchestrator.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const provider = process.env.BTH_REAL_PROVIDER
if (!['codex', 'claude'].includes(provider) || process.env.BTH_PROVIDER_PILOT !== 'I_UNDERSTAND') {
  throw new Error('Set BTH_REAL_PROVIDER=codex|claude and BTH_PROVIDER_PILOT=I_UNDERSTAND. This runs an authenticated provider and may consume tokens or money.')
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error((result.stderr || result.stdout).slice(-4096))
}

const workspace = await mkdtemp(join(tmpdir(), 'bth-real-provider-'))
const project = join(workspace, 'spring-service')
const taskId = 'REAL-PROVIDER-1'
console.error('Disposable provider pilot workspace: ' + project)
try {
  await cp(join(root, 'examples', 'spring-service'), project, { recursive: true })
  git(project, ['init', '-q'])
  git(project, ['config', 'user.email', 'bth-pilot@example.invalid'])
  git(project, ['config', 'user.name', 'BTH Provider Pilot'])
  await configureImplementationProvider(project, provider, {
    force: true,
    mode: 'fast',
    allowedPrefixes: ['src/'],
    maxChangedFiles: 8,
    maxDiffBytes: 128 * 1024,
    maxAttempts: 1,
    timeoutMs: 15 * 60 * 1000,
    maxBudgetUsd: provider === 'claude' ? 2 : null
  })
  git(project, ['add', '.'])
  git(project, ['commit', '-qm', 'provider pilot fixture'])
  const startedAt = Date.now()
  const result = await runWork(project, {
    taskId,
    actor: 'provider-pilot',
    requirement: 'Add public boolean isReady(String orderId) to OrderService and focused tests while preserving status(String). No database or public HTTP API impact.',
    decisions: {
      modules: ['root'],
      databaseImpact: 'none',
      apiImpact: 'none',
      acceptanceCriteria: 'isReady returns true exactly when status returns READY; existing status behavior and tests remain unchanged.'
    }
  }, { approve: true, run: true, allowWrite: true, allowNetwork: true })
  const report = redactForShare({
    schemaVersion: 1,
    platform: process.platform,
    node: process.version,
    provider,
    elapsedMs: Date.now() - startedAt,
    status: result.status,
    implementationStatus: result.implementation?.record?.status ?? null,
    attempts: result.implementation?.record?.attempts?.map((attempt) => ({
      attempt: attempt.attempt,
      outcome: attempt.outcome,
      invocation: attempt.invocation,
      adapter: attempt.adapter,
      verification: attempt.verification
    })) ?? []
  }, { projectRoot: project })
  console.log(JSON.stringify(report.value, null, 2))
  if (result.implementation?.record?.status !== 'passed') process.exitCode = 1
} finally {
  const recorded = await implementationStatus(project, taskId).then(() => true).catch(() => false)
  if (recorded) {
    await resetImplementation(project, taskId, { actor: 'provider-pilot', discardWorkspace: true })
  }
  await rm(workspace, { recursive: true, force: true })
}
