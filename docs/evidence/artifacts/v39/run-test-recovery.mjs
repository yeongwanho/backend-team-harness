// First attempt replays the preserved actual candidate; only attempt two calls a real provider.
// node run-test-recovery.mjs <mirror> <retained-candidate> <v37-raw-result> <codex|claude>
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile, chmod, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const load = path => import(pathToFileURL(join(repo, path)))
const { initProject } = await load('src/init-project.mjs')
const { loadEvaluationCorpus } = await load('src/evaluation/corpus.mjs')
const { loadProviderBenchmarkConfig } = await load('src/evaluation/provider-benchmark-config.mjs')
const { runPreparedComparisonCase } = await load('src/evaluation/provider-benchmark-runner.mjs')
const { implementationStatus } = await load('src/runtime/implementation-orchestrator.mjs')
const { captureConfiguredSourceBinding } = await load('src/runtime/backend-harness.mjs')
const { buildSafeEnvironment, runProcess } = await load('src/core/process-runner.mjs')
const { parseJUnitXml } = await load('src/core/junit.mjs')
const { snapshotImplementedFiles } = await load('src/core/implementation-record-store.mjs')
const { probeImplementationProvider, runImplementationProvider } = await load('src/providers/model-cli.mjs')
const { redactForShare } = await load('src/core/redaction.mjs')
const hash = value => createHash('sha256').update(value).digest('hex')
const sourcePaths = ['src/runtime/implementation-orchestrator.mjs', 'src/core/workspace-formatting.mjs', 'src/config/formatting.mjs', 'src/config/implementation.mjs', 'src/core/junit.mjs', 'src/core/test-failure-diagnostics.mjs', 'src/core/implementation-verification.mjs', 'src/providers/model-cli.mjs']
const runtimeHashes = async () => Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, hash(await readFile(join(repo, path)))])))
const sourceHashes = await runtimeHashes()
const [mirrorArg, candidateArg, rawArg, provider = 'codex'] = process.argv.slice(2)
if (!mirrorArg || !candidateArg || !rawArg) throw new Error('Explicit mirror, retained candidate and raw previous result required.')
if (!['codex', 'claude'].includes(provider)) throw new Error('Explicit supported provider required.')
const probe = await probeImplementationProvider(provider)
if (!probe.available) throw new Error('Provider executable unavailable; this is not a model-quality result.')
const mirror = resolve(mirrorArg), candidate = resolve(candidateArg)
const rawBytes = await readFile(resolve(rawArg)), previous = JSON.parse(rawBytes)
if (previous.case?.taskId !== 'spring-04-future-visit' || previous.acceptanceControls?.controlsConfirmed !== true) throw new Error('Wrong task or unvalidated prior controls.')
const corpus = await loadEvaluationCorpus(join(repo, 'benchmarks/public-backend-v1/corpus.json'))
const config = await loadProviderBenchmarkConfig(join(repo, 'benchmarks/public-backend-v1/provider-comparison.json'), corpus)
const task = corpus.repositories.find(r => r.id === 'spring-petclinic').tasks.find(t => t.id === previous.case.taskId)
const repositoryConfig = config.repositories.find(r => r.id === 'spring-petclinic')
const acceptance = repositoryConfig.tasks.find(t => t.id === task.id).acceptance
if (previous.acceptanceControls.oracleSha256 !== hash(JSON.stringify({ oracle: acceptance, base: task.baseSha, target: task.targetSha }))) throw new Error('Prior controls do not bind the current oracle.')
const owned = await mkdtemp(join(tmpdir(), 'bth-v39-test-recovery-'))
const root = join(owned, 'project')
const git = (cwd, args) => execFileSync('git', args, { cwd, env: buildSafeEnvironment(), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
const paths = [...new Set((git(candidate, ['diff', '--name-only', '--no-renames', '-z', 'HEAD']) + git(candidate, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean))].sort()
if (!paths.length || paths.some(path => !path.startsWith('src/') || path.includes('..'))) throw new Error('Unexpected retained candidate inventory.')
const before = await snapshotImplementedFiles(candidate, paths)
const files = await Promise.all(before.map(async file => ({ ...file, bytes: file.kind === 'file' ? await readFile(join(candidate, file.path)) : null })))
if (files.some(file => !file.bytes || hash(file.bytes) !== file.contentSha256)) throw new Error('Replay requires unchanged regular candidate files.')
const staging = join(owned, 'staging')
git(owned, ['clone', '--shared', '--quiet', '--no-checkout', mirror, staging])
git(staging, ['checkout', '--quiet', '--detach', task.baseSha])
if (git(staging, ['ls-tree', '-r', 'HEAD']).split('\n').some(line => /^(120000|160000) /.test(line))) throw new Error('Unsupported base tree.')
await cp(staging, root, { recursive: true, filter(source) { const path = relative(staging, source); return path !== '.git' && !path.startsWith('.git/'); } })
git(root, ['init', '-q'])
git(root, ['config', 'user.name', 'BTH Recovery Experiment'])
git(root, ['config', 'user.email', 'bth-recovery@example.invalid'])
git(root, ['add', '-f', '.'])
git(root, ['commit', '-qm', 'sanitized benchmark base'])
if (git(root, ['rev-list', '--count', 'HEAD']).trim() !== '1' || git(root, ['remote']).trim()) throw new Error('Gold history was not removed.')
await initProject(root, { preferredSystem: 'maven' })
const verificationPath = join(root, '.backend-harness/verification.json')
const verification = JSON.parse(await readFile(verificationPath, 'utf8'))
verification.gates[0].inputs = [...new Set([...verification.gates[0].inputs, '.editorconfig'])]
await writeFile(verificationPath, JSON.stringify(verification, null, 2) + '\n')
await writeFile(join(root, '.backend-harness/implementation.json'), JSON.stringify({ schemaVersion: 2, adapter: null,
  formatting: { command: ['./mvnw', '-o', '-B', 'io.spring.javaformat:spring-javaformat-maven-plugin:0.0.47:apply'],
    inputs: ['pom.xml', '.editorconfig'], network: false, timeoutMs: 60000 } }, null, 2) + '\n')
git(root, ['add', '-f', '.backend-harness/.gitignore'])
git(root, ['add', '.backend-harness'])
git(root, ['-c', 'user.name=BTH Replay', '-c', 'user.email=bth-replay@example.invalid', 'commit', '-qm', 'explicit project formatting replay contract'])
let fixtureCalls = 0, modelCalls = 0, recoveryRequestDiagnostics = null
const result = await runPreparedComparisonCase(root, task, repositoryConfig, {
  provider, lane: 'bth', mode: provider === 'claude' ? 'deep' : 'fast', model: provider === 'codex' ? 'gpt-5.6-sol' : null, maxAttempts: 2, timeoutMs: 240000, maxBudgetUsd: provider === 'claude' ? 3 : null
}, {
  providerProbe: async () => probe,
  bthProviderRunner: async (adapter, input) => {
    if (fixtureCalls) {
      if (++modelCalls > 1) throw new Error('One real recovery call only.')
      const request = JSON.parse(await readFile(join(input.cwd, input.requestPath), 'utf8'))
      recoveryRequestDiagnostics = request.recovery?.failedGates?.flatMap(gate => gate.failedTests) ?? []
      if (!recoveryRequestDiagnostics.some(test => test.diagnostics?.length > 0)) throw new Error('The real provider would not receive the observed exception.')
      console.error('[v39] Starting one real ' + provider + ' recovery call after fresh failed verification.')
      return runImplementationProvider(adapter, input, { version: probe.version })
    }
    fixtureCalls++
    for (const file of files) {
      await mkdir(dirname(join(input.cwd, file.path)), { recursive: true })
      await writeFile(join(input.cwd, file.path), file.bytes)
      await chmod(join(input.cwd, file.path), file.executable ? 0o755 : 0o644)
    }
    return { process: { exitCode: 0, signal: null, timedOut: false, stdioDrainTimedOut: false,
      startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), durationMs: 0,
      stdout: { sha256: hash(''), bytes: 0, tail: '' }, stderr: { sha256: hash(''), bytes: 0, tail: '' } },
      metadata: { kind: 'provider', provider, version: 'fixture', profile: input.profile, usage: {} } }
  }
})
const taskId = 'BENCH-' + hash(task.id).slice(0, 16).toUpperCase()
const status = await implementationStatus(root, taskId)
let oracle = null
if (status.record.attempts.at(-1)?.formatting?.status === 'passed' && status.record.originalBoundSourceUnchanged &&
    ['passed', 'verification-failed'].includes(status.record.attempts.at(-1)?.outcome)) {
  const destination = join(owned, 'oracle-candidate')
  const workspace = status.record.workspace
  git(owned, ['clone', '--shared', '--quiet', '--no-checkout', root, destination])
  git(destination, ['checkout', '--quiet', '--detach', status.record.baseHeadCommit])
  const finalPaths = status.record.changedFiles.paths
  const replayFiles = await snapshotImplementedFiles(workspace, finalPaths)
  for (const file of replayFiles) {
    if (file.kind !== 'file') throw new Error('Unexpected deletion in visit replay.')
    const content = await readFile(join(workspace, file.path))
    if (hash(content) !== file.contentSha256) throw new Error('Replay candidate changed.')
    await mkdir(dirname(join(destination, file.path)), { recursive: true })
    await writeFile(join(destination, file.path), content)
    await chmod(join(destination, file.path), file.executable ? 0o755 : 0o644)
  }
  for (const file of acceptance.files) {
    const content = await readFile(join(repo, 'benchmarks/public-backend-v1', file.fixture))
    if (hash(content) !== file.sha256) throw new Error('Oracle fixture hash mismatch.')
    await writeFile(join(destination, file.path), content)
  }
  const beforeDiff = (await captureConfiguredSourceBinding(destination)).fingerprint
  const process = await runProcess({ program: join(destination, acceptance.command[0]), args: acceptance.command.slice(1),
    cwd: destination, timeoutMs: 180000, env: buildSafeEnvironment() })
  const reports = await Promise.all(acceptance.reports.map(async path => {
    const bytes = await readFile(join(destination, path))
    const parsed = parseJUnitXml(bytes.toString('utf8'), path, { selectedCases: acceptance.cases })
    return { path, sha256: hash(bytes), tests: parsed.tests, failures: parsed.failures, errors: parsed.errors, selected: parsed.selectedTests }
  }))
  const cases = acceptance.cases.map(expected => {
    const matched = reports.flatMap(r => r.selected).filter(t => t.className === expected.className && t.name === expected.name)
    return { ...expected, outcome: matched.length === 1 ? matched[0].outcome : 'missing-or-duplicate' }
  })
  const sourceStable = beforeDiff === (await captureConfiguredSourceBinding(destination)).fingerprint &&
    JSON.stringify(replayFiles) === JSON.stringify(await snapshotImplementedFiles(workspace, finalPaths))
  oracle = { controlsReusedFromPriorArtifact: hash(rawBytes), oracleSha256: previous.acceptanceControls.oracleSha256,
    sourceStable, cases, reports, process: { exitCode: process.exitCode, timedOut: process.timedOut, durationMs: process.durationMs },
    passed: sourceStable && process.exitCode === 0 && !process.signal && !process.timedOut && !process.stdioDrainTimedOut &&
      cases.every(c => c.outcome === 'passed') && reports.every(r => r.failures === 0 && r.errors === 0) }
}
const originalUntouched = JSON.stringify(before) === JSON.stringify(await snapshotImplementedFiles(candidate, paths)) && hash(rawBytes) === hash(await readFile(resolve(rawArg)))
if (JSON.stringify(sourceHashes) !== JSON.stringify(await runtimeHashes())) throw new Error('Runtime source changed during replay; do not publish this run as current-source evidence.')
console.log(JSON.stringify(redactForShare({ schemaVersion: 1, kind: 'one-actual-provider-repair-after-fixture-replay-not-success-at-one',
  taskId: task.id, sourceHashes, originalArtifactSha256: hash(rawBytes), retainedCandidateFiles: before, originalUntouched,
  providerCalls: modelCalls, provider, providerVersion: probe.version, fixtureCalls, recoveryRequestDiagnostics,
  observation: result.observation, attempts: status.record.attempts.map(attempt => ({ attempt: attempt.attempt,
    outcome: attempt.outcome, invocation: attempt.invocation, formatting: attempt.formatting, verification: attempt.verification })),
  recoveryDiff: git(status.record.workspace, ['diff', '--stat']),
  oracle, ordinaryTestsPassed: status.record.verification?.confirmed === true, temporaryProject: root, productionOrCompanyWrites: false,
  limitations: ['One fixture replay plus at most one real provider repair; cannot count as success@1 or a BTH/direct speed comparison.',
    'Pinned independent base/target controls are reused from the original v37 record, not rerun. Posthoc oracle execution does not override failed ordinary tests.',
    'All source writes are to new public-project copies; original failed candidate and record remain unchanged.'] }).value, null, 2))
