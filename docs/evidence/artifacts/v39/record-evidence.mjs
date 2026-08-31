// Record finished, source-checked observations. Never launches a model or JVM.
// node record-evidence.mjs <codex-recovery.json> <claude-recovery.json>
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { captureConfiguredSourceBinding } from '../../../../src/runtime/backend-harness.mjs'
import { snapshotImplementedFiles } from '../../../../src/core/implementation-record-store.mjs'
import { redactForShare } from '../../../../src/core/redaction.mjs'

const directory = dirname(fileURLToPath(import.meta.url))
const root = resolve(directory, '../../../..')
const hash = value => createHash('sha256').update(value).digest('hex')
const write = async (name, value) => writeFile(join(directory, name), JSON.stringify(redactForShare(value).value, null, 2) + '\n')
const paths = process.argv.slice(2)
if (paths.length !== 2) throw new Error('Supply the finished Codex and subsequent Claude observations, in that order.')
const runs = []
for (const [index, path] of paths.entries()) {
  const bytes = await readFile(resolve(path)), run = JSON.parse(bytes)
  const expectedProvider = index === 0 ? 'codex' : 'claude'
  if (run.provider !== expectedProvider || run.fixtureCalls !== 1 || run.providerCalls !== 1 ||
      !run.originalUntouched || run.ordinaryTestsPassed || run.oracle?.passed !== true || run.attempts?.length !== 2 ||
      run.attempts.some(attempt => attempt.outcome !== 'verification-failed')) {
    throw new Error('Unexpected outcome; inspect the actual run instead of reusing this report.')
  }
  for (const [source, expected] of Object.entries(run.sourceHashes)) {
    if (hash(await readFile(join(root, source))) !== expected) throw new Error('Runtime changed since the run: ' + source)
  }
  const project = run.temporaryProject.replace('<tmp>', tmpdir())
  const record = JSON.parse(await readFile(join(project, '.backend-harness/local/implementation/BENCH-5003449DF461B6C8.json')))
  const current = await captureConfiguredSourceBinding(record.workspace)
  if (current.fingerprint !== record.attempts.at(-1).sourceFingerprintAfter) throw new Error('Retained result changed after verification.')
  const finalFiles = await snapshotImplementedFiles(record.workspace, record.changedFiles.paths)
  const initial = new Map(run.retainedCandidateFiles.map(file => [file.path, file]))
  const changedFromSeed = finalFiles.filter(file => JSON.stringify(file) !== JSON.stringify(initial.get(file.path))).map(file => file.path)
  const removedFromSeed = run.retainedCandidateFiles.filter(file => !finalFiles.some(final => final.path === file.path)).map(file => file.path)
  if (removedFromSeed.length) throw new Error('Candidate inventory changed unexpectedly.')
  const invocation = run.attempts[1].invocation
  runs.push({ ...run, rawOutputSha256: hash(bytes), finalSourceFingerprint: current.fingerprint,
    finalFiles, changedFromSeed, actualInvocation: { provider: invocation.provider, version: invocation.version,
      configuredModel: invocation.model ?? null, profile: invocation.profile, usage: invocation.usage },
    note: 'Observation aggregate usage includes an intentionally unmetered fixture and is unknown. actualInvocation is the one metered real call, not the complete workflow.' })
}
if (JSON.stringify(runs[0].finalFiles) !== JSON.stringify(runs[1].retainedCandidateFiles)) {
  throw new Error('Claude input does not match the preceding Codex output; this is not the recorded chain.')
}
await write('codex-recovery.json', runs[0])
await write('claude-recovery.json', runs[1])

const coverage = await readFile('/tmp/bth-v39-coverage.log', 'utf8')
const mutation = await readFile('/tmp/bth-v39-mutation.log', 'utf8')
const install = await readFile('/tmp/bth-v39-install.log', 'utf8')
const windows = await readFile('/tmp/bth-v39-windows-contract.log', 'utf8')
const syntax = await readFile('/tmp/bth-v39-syntax.log', 'utf8')
const auditRaw = await readFile('/tmp/bth-v39-audit.json', 'utf8'), audit = JSON.parse(auditRaw)
const count = key => Number(coverage.match(new RegExp('^# ' + key + ' (\\d+)$', 'm'))?.[1])
const totals = coverage.match(/^All files\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)/m)
const killed = (mutation.match(/^KILLED /gm) ?? []).length
if (!totals || count('fail') !== 0 || count('tests') !== 589 || count('pass') !== 585 || count('skipped') !== 4 ||
    killed !== 40 || !install.includes('Installed package smoke passed') || !/# pass 8\n/.test(windows) || !/# fail 0\n/.test(windows) ||
    audit.metadata?.vulnerabilities?.total !== 0) throw new Error('Final QA is missing or differs from the report; recheck it.')
const sourcePaths = [...Object.keys(runs[0].sourceHashes), 'scripts/mutation-smoke.mjs',
  'test/junit.test.mjs', 'test/implementation-verification.test.mjs', 'test/implementation-orchestrator.test.mjs',
  'test/test-failure-diagnostics.test.mjs', 'test/docs-contract.test.mjs', 'docs/TEST-FAILURE-DIAGNOSTICS.md']
const sourceHashes = Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, hash(await readFile(join(root, path)))])))
await write('qa.json', { schemaVersion: 1, recordedAt: new Date().toISOString(), platform: process.platform, node: process.version,
  sourceHashes, syntax: { logSha256: hash(syntax) },
  tests: { total: count('tests'), passed: count('pass'), failed: count('fail'), skipped: count('skipped'), logSha256: hash(coverage) },
  coverage: { lines: Number(totals[4]), branches: Number(totals[2]), functions: Number(totals[3]) },
  mutation: { killed, totalCurated: 40, logSha256: hash(mutation), limitation: 'Curated smoke, not exhaustive mutation coverage.' },
  installSmoke: { passed: true, logSha256: hash(install) },
  windowsContract: { passed: true, logSha256: hash(windows), actualWindowsExecution: false },
  productionDependencies: { vulnerabilities: audit.metadata.vulnerabilities, logSha256: hash(auditRaw) },
  skipped: ['real MySQL container E2E', 'separate Maven/Gradle cold-cache E2E', 'real Windows provider JSON execution', 'real Windows descendant termination'],
  limitations: ['Both actual repair attempts still fail an ordinary test; unit QA is not product task success.',
    'The second provider received the first provider output and a different profile. No head-to-head ranking, success@1, speed or token-saving claim.'] })
const priorPath = 'docs/evidence/artifacts/v37/corpus-ledger.json'
const priorRaw = await readFile(join(root, priorPath), 'utf8'), prior = JSON.parse(priorRaw)
await write('goal-status.json', { schemaVersion: 1, goalComplete: false,
  priorCorpusLedger: { path: priorPath, sha256: hash(priorRaw) }, taskCount: prior.rows.length,
  historicalPairedTasks: prior.rows.filter(row => row.historicalPairedInference).length,
  historicalSuccessfulPairs: prior.rows.filter(row => row.historicalSuccessfulPair).length,
  configuredOracles: prior.rows.filter(row => row.oracleConfigured).length,
  validatedCurrentOracles: prior.rows.filter(row => row.currentOracleControlsConfirmed).length,
  newPairedTasks: 0, newModelCalls: 2, newSuccessfulRepairTasks: 0,
  repairChain: ['docs/evidence/artifacts/v39/codex-recovery.json', 'docs/evidence/artifacts/v39/claude-recovery.json'],
  nextEvidenceGap: 'Run uncovered versioned corpus tasks and native full-workflow baselines. The saved Spring assertion failure needs source-bound locale/config diagnosis; exception identity alone did not solve it.',
  limitations: ['Historical protocols are not pooled as a success rate.',
    'This actual Claude repair is not a Claude/direct pair. Actual Windows, MySQL task corpus and second-developer onboarding remain incomplete.'] })
console.log('Recorded v39 source-bound failed repair chain, final QA and unchanged corpus totals.')
