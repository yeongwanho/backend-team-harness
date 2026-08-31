import assert from 'node:assert/strict'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createIsolatedGitSnapshot } from '../../../../src/evaluation/isolated-git-snapshot.mjs'
import { redactForShare } from '../../../../src/core/redaction.mjs'

const directory = dirname(fileURLToPath(import.meta.url)), root = resolve(directory, '../../../..')
const hash = b => createHash('sha256').update(b).digest('hex')
const mirror = '/tmp/bth-provider-comparison-cache-v2/spring-petclinic.git'
const raw = await readFile('/tmp/bth-v44-spring-preflight-thin/preflight/spring-02-owner-search-whitespace.json'), record = JSON.parse(raw)
assert.equal(record.readyForTaskSuccessComparison, true)
assert.equal(record.preflight.tests.executed, 71); assert.equal(record.preflight.tests.skipped, 0)
assert.equal(record.acceptanceControls.controlsConfirmed, true)
assert.equal(record.acceptanceControls.controls.target.cases.length, 6)
const assertions = []
for (const name of ['MySqlIntegrationTests', 'PostgresIntegrationTests']) {
  const path = 'src/test/java/org/springframework/samples/petclinic/' + name + '.java'
  const original = execFileSync('git', ['-C', mirror, 'show', record.baseSha + ':' + path], { encoding: 'utf8' })
  const overlay = await readFile(join(root, 'benchmarks/public-backend-v1/fixtures/spring/' + name + '.java'), 'utf8')
  const methods = value => [...value.matchAll(/\t@Test\n[^]*?\n\t\}/g)].map(m => m[0])
  assert.equal(methods(original).length, 2)
  assert.deepEqual(methods(overlay), methods(original))
  assertions.push({ path, originalTestMethods: 2, unchanged: true, methodHashes: methods(original).map(hash) })
}
const allocated = await mkdtemp(join(tmpdir(), 'bth-v44-storage-proof-'))
let storage
try {
  const destination = join(allocated, 'snapshot'), started = Date.now()
  await createIsolatedGitSnapshot(mirror, record.baseSha, destination)
  const elapsedMs = Date.now() - started
  const objects = path => Object.fromEntries(execFileSync('git', ['-C', path, 'count-objects', '-v'], { encoding: 'utf8' }).trim().split('\n').map(line => line.split(': ')))
  storage = { sourceObjects: objects(mirror), snapshotObjects: objects(destination), elapsedMs,
    head: execFileSync('git', ['-C', destination, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    commits: Number(execFileSync('git', ['-C', destination, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim()),
    unit: 'Git size and size-pack in KiB, not total working tree or dependency storage',
    limitation: 'One observed snapshot; elapsed time is not a controlled performance comparison.' }
  assert.equal(storage.head, record.baseSha); assert.equal(storage.commits, 1)
} finally { await rm(allocated, { recursive: true, force: true }) }
const sourcePaths = ['src/evaluation/isolated-git-snapshot.mjs', 'src/evaluation/task-acceptance.mjs',
  'benchmarks/public-backend-v1/provider-comparison.json', 'docs/evidence/artifacts/v44/record-baseline.mjs']
const sourceHashes = Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, hash(await readFile(join(root, path)))])))
await writeFile(join(directory, 'spring-baseline.json'), JSON.stringify(redactForShare({ recordedAt: new Date().toISOString(),
  sourceHashes, originalArtifactSha256: hash(raw), record, assertions, storage, goalComplete: false }).value, null, 2) + '\n', { flag: 'wx' })
console.log(JSON.stringify({ tests: record.preflight.tests, storage, assertions }))
