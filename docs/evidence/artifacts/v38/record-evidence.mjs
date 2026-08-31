// Generate sanitized evidence from explicit finished local runs; no source edits.
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { XMLParser } from 'fast-xml-parser'
const directory = dirname(fileURLToPath(import.meta.url))
const root = resolve(directory, '../../../..')
const hash = value => createHash('sha256').update(value).digest('hex')
const input = await readFile('/tmp/bth-v38-visit-replay-final.json', 'utf8')
const replay = JSON.parse(input)
if (replay.providerCalls !== 0 || !replay.originalUntouched || replay.formatting?.status !== 'passed') throw new Error('Expected immutable zero-model formatting replay missing.')
for (const [path, expected] of Object.entries(replay.sourceHashes)) if (hash(await readFile(join(root, path))) !== expected) throw new Error('Replay runtime is stale: ' + path)
const project = replay.temporaryProject.replace('<tmp>', tmpdir())
const record = JSON.parse(await readFile(join(project, '.backend-harness/local/implementation/BENCH-5003449DF461B6C8.json')))
const reportPath = 'target/surefire-reports/TEST-org.springframework.samples.petclinic.owner.VisitControllerTests.xml'
const rawReport = await readFile(join(record.workspace, reportPath), 'utf8')
const parsed = new XMLParser({ ignoreAttributes: false }).parse(rawReport)
const failures = [].concat(parsed.testsuite.testcase ?? []).filter(test => test.error).map(test => ({
  className: test['@_classname'], name: test['@_name'], category: 'html-read-as-xml-by-test-xpath-assertion',
  observedErrorType: String(test.error['@_type']).split(';')[0],
  evidence: { reportPath, reportSha256: hash(rawReport) }
}))
if (failures.length !== 2 || failures.some(f => f.observedErrorType !== 'org.xml.sax.SAXParseException')) throw new Error('Recheck the concrete ordinary-test failure diagnosis.')
await writeFile(join(directory, 'visit-replay.json'), JSON.stringify({ ...replay, replayOutputSha256: hash(input), ordinaryTestDiagnosis: failures }, null, 2) + '\n')

const coverage = await readFile('/tmp/bth-v38-coverage-release.log', 'utf8')
const mutation = await readFile('/tmp/bth-v38-mutation.log', 'utf8')
const install = await readFile('/tmp/bth-v38-install.log', 'utf8')
const windows = await readFile('/tmp/bth-v38-windows-contract.log', 'utf8')
const auditRaw = await readFile('/tmp/bth-v38-audit.json', 'utf8'), audit = JSON.parse(auditRaw)
const count = key => Number(coverage.match(new RegExp('^# ' + key + ' (\\d+)$', 'm'))?.[1])
const totals = coverage.match(/^All files\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)/m)
const killed = (mutation.match(/^KILLED /gm) ?? []).length
if (!totals || count('fail') !== 0 || count('tests') < 580 || killed !== 39 || !install.includes('Installed package smoke passed') || !/# pass 8\n/.test(windows) || !/# fail 0\n/.test(windows)) throw new Error('Completed QA evidence missing.')
const sourcePaths = [...Object.keys(replay.sourceHashes), 'src/config/implementation-setup.mjs', 'src/evaluation/provider-benchmark-runner.mjs', 'scripts/mutation-smoke.mjs']
const sourceHashes = Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, hash(await readFile(join(root, path)))])))
await writeFile(join(directory, 'qa.json'), JSON.stringify({ schemaVersion: 1, recordedAt: new Date().toISOString(), platform: process.platform, node: process.version,
  sourceHashes, tests: { total: count('tests'), passed: count('pass'), failed: count('fail'), skipped: count('skipped'), logSha256: hash(coverage) },
  coverage: { lines: Number(totals[4]), branches: Number(totals[2]), functions: Number(totals[3]) },
  mutation: { killed, totalCurated: 39, logSha256: hash(mutation), limitation: 'Curated smoke, not exhaustive mutation coverage.' },
  installSmoke: { passed: true, logSha256: hash(install) }, windowsContract: { passed: true, logSha256: hash(windows), actualWindowsExecution: false },
  productionDependencies: { vulnerabilities: audit.metadata.vulnerabilities, logSha256: hash(auditRaw) },
  skipped: ['real MySQL container E2E', 'separate Maven/Gradle cold-cache E2E', 'real Windows provider JSON execution', 'real Windows descendant termination'],
  limitations: ['The real Java replay has ordinary test errors; unit QA is not product task success.', 'No model inference or new success@1 pair in this iteration.'] }, null, 2) + '\n')
const priorPath = 'docs/evidence/artifacts/v37/corpus-ledger.json'
const priorRaw = await readFile(join(root, priorPath), 'utf8'), prior = JSON.parse(priorRaw)
await writeFile(join(directory, 'goal-status.json'), JSON.stringify({ schemaVersion: 1, goalComplete: false,
  priorCorpusLedger: { path: priorPath, sha256: hash(priorRaw) }, taskCount: prior.rows.length,
  historicalPairedTasks: prior.rows.filter(r => r.historicalPairedInference).length,
  historicalSuccessfulPairs: prior.rows.filter(r => r.historicalSuccessfulPair).length,
  configuredOracles: prior.rows.filter(r => r.oracleConfigured).length,
  validatedCurrentOracles: prior.rows.filter(r => r.currentOracleControlsConfirmed).length,
  newPairedTasks: 0, newModelCalls: 0, replay: 'docs/evidence/artifacts/v38/visit-replay.json',
  nextEvidenceGap: 'Repair generated HTML test assertions without bypassing real tests, then evaluate new versioned corpus tasks and native full-workflow baselines.',
  limitations: ['Historical protocols are not pooled as a success rate.', 'Claude, actual Windows, MySQL task corpus and second-developer onboarding remain incomplete.'] }, null, 2) + '\n')
console.log('Generated v38 replay, QA and goal-status artifacts; historical results unchanged.')
