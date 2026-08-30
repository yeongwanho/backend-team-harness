import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { loadVerificationConfig, parseVerificationConfig, verificationExecutablePaths, verificationInputPaths } from './config/verification.mjs'
import { captureSourceBinding } from './core/source-binding.mjs'
import { resolveReadableRoot, resolveSafeProjectPath, statPath } from './fs-safety.mjs'
import { withProjectVerificationLock } from './core/project-lock.mjs'
import { canonicalJson } from './core/canonical-json.mjs'

async function atomicReplace(target, content) {
  const temporary = resolve(dirname(target), '.bth-' + randomUUID() + '.tmp')
  await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  try {
    await rename(temporary, target)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

async function updateTestBaselineUnlocked(inputPath) {
  const root = await resolveReadableRoot(inputPath)
  const latestPath = await resolveSafeProjectPath(root, '.backend-harness/local/runs/latest.json')
  const latestStat = await statPath(latestPath)
  if (!latestStat?.isFile() || latestStat.isSymbolicLink() || latestStat.size > 16 * 1024 * 1024) {
    throw new Error('A local run is required. Run `bth check <path>` first.')
  }
  const run = JSON.parse(await readFile(latestPath, 'utf8'))
  const { recordSha256, ...unsignedRun } = run
  const expectedRunSha256 = createHash('sha256').update(canonicalJson(unsignedRun)).digest('hex')
  if (recordSha256 !== expectedRunSha256) {
    throw new Error('Latest run seal does not match its content.')
  }
  if (run.evidenceTier !== 'EXECUTED' || run.verdict !== 'passed') {
    throw new Error('Only a passed EXECUTED run can raise the test baseline.')
  }
  const loaded = await loadVerificationConfig(root, { allowInferred: false })
  const current = await captureSourceBinding(root, {
    explicitPaths: verificationInputPaths(loaded.config),
    allowSymlinkPaths: verificationExecutablePaths(loaded.config)
  })
  if (current.fingerprint !== run.source?.fingerprint) {
    throw new Error('Source changed after the latest run. Run `bth check` again before updating the baseline.')
  }
  const observed = new Map(
    run.gates
      .filter((gate) => gate.result?.type === 'junit' && Number.isSafeInteger(gate.result.executed))
      .map((gate) => [gate.id, gate.result.executed])
  )
  const changes = []
  const gates = loaded.config.gates.map((gate) => {
    if (gate.result.type !== 'junit' || !observed.has(gate.id)) {
      return gate
    }
    const previous = gate.result.minimumTests
    const next = Math.max(previous, observed.get(gate.id))
    if (next > previous) {
      changes.push({ gateId: gate.id, previous, next })
    }
    return { ...gate, result: { ...gate.result, minimumTests: next } }
  })
  if (changes.length === 0) {
    return { root, changed: false, changes: [], backup: null }
  }
  const normalized = parseVerificationConfig(JSON.stringify({ ...loaded.config, gates }), 'baseline:update')
  const configPath = await resolveSafeProjectPath(root, '.backend-harness/verification.json')
  const backupDir = await resolveSafeProjectPath(root, '.backend-harness/local/backups/baselines')
  await mkdir(backupDir, { recursive: true })
  const backup = resolve(backupDir, new Date().toISOString().replace(/[:.]/g, '-') + '-verification.json')
  await writeFile(backup, await readFile(configPath), { flag: 'wx', mode: 0o600 })
  await atomicReplace(configPath, JSON.stringify(normalized, null, 2) + '\n')
  return { root, changed: true, changes, backup: backup.slice(root.length + 1) }
}

export function updateTestBaseline(inputPath) {
  return withProjectVerificationLock(inputPath, undefined, () => updateTestBaselineUnlocked(inputPath))
}
