// Read completed comparison artifacts and QA logs. No provider invocation or project writes.
import { readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { redactForShare } from '../../../../src/core/redaction.mjs'

const directory = dirname(fileURLToPath(import.meta.url)), root = resolve(directory, '../../../..')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const write = async (name, value) => writeFile(join(directory, name), JSON.stringify(redactForShare(value).value, null, 2) + '\n')
const read = path => readFile(join(root, path))
const pairHashes = {}, pairs = []
for (const provider of ['codex', 'claude']) {
  const path = `docs/evidence/artifacts/v40/${provider}-pair.json`
  const raw = await read(path), pair = JSON.parse(raw)
  if (pair.provider !== provider || pair.taskId !== 'fastapi-04-constant-time-login' ||
      pair.attemptsPerLane !== 1 || !pair.integrity.sameProtectedInputsAcrossLanes) throw new Error('Unexpected pair identity.')
  for (const [source, expected] of Object.entries(pair.sourceHashes)) {
    if (hash(await read(source)) !== expected) throw new Error('Runtime changed after comparison: ' + source)
  }
  for (const lane of ['bth', 'direct']) {
    const record = pair.records[lane], integrity = pair.integrity.candidates[lane]
    if (record.score.successAt1 !== true || record.score.attempts !== 1 || record.score.retries !== 0 ||
        !record.score.acceptanceConfirmed || !integrity.testEvidence.sourceMatchesLastRun || !integrity.fixture.valid) {
      throw new Error('Outcome changed; revise the report instead of overriding it.')
    }
  }
  pairs.push(pair)
  pairHashes[path] = hash(raw)
}
const logPaths = { failingFirst: '/tmp/bth-v40-red-config.log', fixture: '/tmp/bth-v40-final-config.log',
  scoped: '/tmp/bth-v40-scoped-qa.log', final: '/tmp/bth-v40-final-qa.log', syntax: '/tmp/bth-v40-final-syntax.log' }
const logs = Object.fromEntries(await Promise.all(Object.entries(logPaths).map(async ([key, path]) => [key, await readFile(path, 'utf8')])))
const summary = text => Object.fromEntries(['tests', 'pass', 'fail', 'skipped'].map(key => {
  const count = text.match(new RegExp('^# ' + key + ' (\\d+)$', 'm'))
  if (!count) throw new Error('Missing terminal TAP summary: ' + key)
  return [key, Number(count[1])]
}))
const suites = Object.fromEntries(['failingFirst', 'fixture', 'scoped', 'final'].map(key => [key, { ...summary(logs[key]), logSha256: hash(logs[key]) }]))
if (suites.failingFirst.tests !== 7 || suites.failingFirst.fail !== 1 || suites.fixture.pass !== 20 ||
    suites.scoped.pass !== 52 || suites.scoped.fail !== 0 || suites.final.fail !== 0 || suites.final.pass === 0) {
  throw new Error('QA counts differ from the recorded observation.')
}
execFileSync(process.execPath, ['scripts/check-syntax.mjs'], { cwd: root, stdio: 'pipe' })
execFileSync('git', ['diff', '--check'], { cwd: root, stdio: 'pipe' })
const resources = []
for (const label of ['bth.fastapi.productqa', 'bth.fastapi.oracle']) {
  for (const kind of ['container', 'network']) {
    const args = kind === 'container' ? ['ps', '-a'] : ['network', 'ls']
    const output = execFileSync('docker', [...args, '--filter', 'label=' + label, '--format', '{{.ID}}'], { encoding: 'utf8' }).trim()
    if (output) throw new Error('Evaluation resource still exists; inspect without deleting unrelated work.')
    resources.push({ kind, label, remaining: 0 })
  }
}
const paths = ['benchmarks/public-backend-v1/provider-comparison.json', 'test/provider-benchmark-config.test.mjs',
  'docs/evidence/auth-comparison-v40.md', 'README.md', 'CHANGELOG.md',
  'docs/evidence/artifacts/v40/record-pair.mjs', 'docs/evidence/artifacts/v40/record-evidence.mjs']
const sourceHashes = Object.fromEntries(await Promise.all(paths.map(async path => [path, hash(await read(path))])))
await write('qa.json', { schemaVersion: 1, recordedAt: new Date().toISOString(), platform: process.platform,
  node: process.version, sourceHashes, pairHashes, suites,
  syntax: { passed: true, logSha256: hash(logs.syntax) }, diffCheck: { passed: true },
  publicFixtureResources: resources, realProviderCalls: 4,
  limitations: ['Scoped QA for evaluator configuration/tests/docs; production runtime is unchanged from b188df3.',
    'No v40 full coverage, mutation, installation smoke, actual Windows, MySQL task or second-developer run.',
    'TAP raw logs remain local; hashes and counts are published, not private workspaces or raw provider streams.'] })
const ledgerRaw = execFileSync(process.execPath, ['docs/evidence/artifacts/v35/rebuild-corpus-ledger.mjs'], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
const ledger = JSON.parse(ledgerRaw)
await write('corpus-ledger.json', ledger)
const writtenLedger = await readFile(join(directory, 'corpus-ledger.json'))
await write('goal-status.json', { schemaVersion: 1, goalComplete: false, newPairedTasks: 1,
  newProviderPairs: 2, newModelCalls: 4, newPairsBothSuccessAt1: 2,
  corpusLedger: { path: 'docs/evidence/artifacts/v40/corpus-ledger.json', sha256: hash(writtenLedger), counts: ledger.counts },
  pairHashes, nativeFullWorkflowBaselineComplete: false,
  nextEvidenceGaps: ['Reduce irrelevant context and improve production/test ranking without losing mandatory rules or sources; validate beyond this known task.',
    'Reproduce and repair missing Claude direct read-path observability; persist direct CLI version and clarify auxiliary token scope.',
    'Cover remaining versioned tasks and independent backend environments, then run native provider full-workflow baselines.',
    'Actual Windows process/provider QA, MySQL task corpus and two-developer onboarding remain incomplete.'],
  limitations: ['Historical pairs across protocols are not a pooled success rate or current-runtime completion percentage.',
    'All four candidates pass defined behavior, but Claude BTH comments overstate timing guarantees and duplicate hash configuration; human review remains necessary.',
    'Deep/high one-call comparisons do not establish auto/light efficiency or universal BTH benefit.'] })
console.log(JSON.stringify({ pairs: pairs.length, calls: 4, counts: ledger.counts, goalComplete: false }))
