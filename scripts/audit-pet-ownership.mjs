// Post-hoc controller/JPA regression audit. Never replaces a scored first attempt.
import { readFile, writeFile, copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { loadImplementationRecord } from '../src/core/implementation-record-store.mjs'
import { resolveSafeProjectPath } from '../src/fs-safety.mjs'
import { buildSafeEnvironment, runProcess } from '../src/core/process-runner.mjs'
import { parseJUnitXml } from '../src/core/junit.mjs'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if (process.argv.length !== 6 || process.argv[2] !== '--cache' || process.argv[4] !== '--runs') throw new Error('Expected --cache PATH --runs PAIR_DIRECTORY.')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const json = async path => JSON.parse(await readFile(path, 'utf8'))
const corpus = await json(join(root, 'benchmarks/public-backend-v1/corpus.json'))
const repository = corpus.repositories.find(r => r.id === 'spring-petclinic')
const task = repository.tasks.find(t => t.id === 'spring-06-pet-update')
const mirror = join(resolve(process.argv[3]), 'spring-petclinic.git')
const runs = resolve(process.argv[5])
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, env: buildSafeEnvironment() })
assert.equal(git(mirror, ['config', '--get', 'remote.origin.url']).trim(), repository.url)
const fixturePath = 'benchmarks/public-backend-v1/fixtures/spring/PetOwnershipAcceptanceTests.java'
const fixture = await readFile(join(root, fixturePath))
const injectedPath = 'src/test/java/org/springframework/samples/petclinic/owner/PetOwnershipAcceptanceTests.java'
const reportPath = 'target/surefire-reports/TEST-org.springframework.samples.petclinic.owner.PetOwnershipAcceptanceTests.xml'
const selectedCases = [{ className: 'org.springframework.samples.petclinic.owner.PetOwnershipAcceptanceTests', name: 'doesNotModifyOrReparentAnotherOwnersPersistentPet' }]
const directory = await mkdtemp(join(tmpdir(), 'bth-pet-ownership-audit-'))
const results = []
try {
  for (const variant of ['base', 'target', 'bth', 'direct']) {
    const candidate = ['bth', 'direct'].includes(variant)
    const record = candidate ? await json(join(runs, 'codex', variant, task.id + '.json')) : null
    const taskId = 'BENCH-' + hash(task.id).slice(0, 16).toUpperCase()
    const source = variant === 'bth' ? (await loadImplementationRecord(record.workspace, taskId)).record.workspace : candidate ? record.workspace : mirror
    const ref = candidate ? 'HEAD' : task[variant + 'Sha']
    const destination = join(directory, variant)
    git(undefined, ['clone', '--quiet', '--no-hardlinks', '--no-checkout', '--', source, destination])
    git(destination, ['checkout', '--quiet', '--detach', ref])
    const originalHashes = []
    if (candidate) for (const path of record.observation.changedPaths) {
      const from = await resolveSafeProjectPath(source, path)
      const to = await resolveSafeProjectPath(destination, path)
      const bytes = await readFile(from)
      await mkdir(dirname(to), { recursive: true })
      await copyFile(from, to)
      originalHashes.push({ path, sha256: hash(bytes) })
    }
    await writeFile(join(destination, injectedPath), fixture)
    process.stderr.write('Checking ownership: ' + variant + '\n')
    const execution = await runProcess({ program: join(destination, 'mvnw'), args: ['-q', '-o', '-Dtest=PetOwnershipAcceptanceTests', 'test'],
      cwd: destination, timeoutMs: 180000, env: buildSafeEnvironment() })
    let tests = null, report = null
    try {
      const bytes = await readFile(join(destination, reportPath))
      tests = parseJUnitXml(bytes.toString('utf8'), reportPath, { selectedCases })
      report = { path: reportPath, sha256: hash(bytes), bytes: bytes.length }
    } catch { /* Missing report is an untested/failed preparation, never a pass. */ }
    for (const file of originalHashes) assert.equal(hash(await readFile(join(source, file.path))), file.sha256, 'Scored source changed during audit.')
    results.push({ variant, originalHashes, originalSourceUntouched: candidate ? true : null,
      process: { exitCode: execution.exitCode, signal: execution.signal, timedOut: execution.timedOut,
        stdout: { sha256: execution.stdout.sha256, bytes: execution.stdout.bytes },
        stderr: { sha256: execution.stderr.sha256, bytes: execution.stderr.bytes } },
      report, tests, passed: execution.exitCode === 0 && !execution.signal && !execution.timedOut &&
        tests?.selectedTests?.length === 1 && tests.selectedTests[0].outcome === 'passed' })
    if (execution.exitCode !== 0) process.stderr.write(execution.stdout.tail.slice(-3500) + '\n')
  }
  console.log(JSON.stringify({ schemaVersion: 1, kind: 'supplemental-post-hoc-ownership-audit', providerCalls: 0,
    taskId: task.id, baseSha: task.baseSha, targetSha: task.targetSha, fixturePath, fixtureSha256: hash(fixture),
    sourceHashes: { 'src/core/junit.mjs': hash(await readFile(join(root, 'src/core/junit.mjs'))),
      'scripts/audit-pet-ownership.mjs': hash(await readFile(fileURLToPath(import.meta.url))) },
    results, controlsPassed: results.slice(0, 2).every(r => r.passed),
    limitations: ['Post-hoc adversarial regression check, not a rewrite of predeclared success@1.',
      'Controller/JPA invocation in rollback-only local H2, not a live HTTP authorization or production security test.',
      'Scored candidate source was not repaired or formatted. Missing reports are not behavioral passes.'] }, null, 2))
  if (!results.slice(0, 2).every(r => r.passed)) process.exitCode = 1
} finally {
  await rm(directory, { recursive: true, force: true })
}
