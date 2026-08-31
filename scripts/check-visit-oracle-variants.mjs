import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if (process.argv.length !== 4 || process.argv[2] !== '--cache') throw new Error('Expected --cache PATH; no provider or network flags are accepted.')
const { evaluateTaskAcceptance } = await import('../src/evaluation/task-acceptance.mjs')
const { runProcess } = await import('../src/core/process-runner.mjs')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const fixtureRoot = join(root, 'benchmarks/public-backend-v1')
const corpus = JSON.parse(await readFile(join(fixtureRoot, 'corpus.json'), 'utf8'))
const config = JSON.parse(await readFile(join(fixtureRoot, 'provider-comparison.json'), 'utf8'))
const task = corpus.repositories.find(r => r.id === 'spring-petclinic').tasks.find(t => t.id === 'spring-04-future-visit')
const acceptance = structuredClone(config.repositories.find(r => r.id === 'spring-petclinic').tasks.find(t => t.id === task.id).acceptance)
assert.equal(acceptance.files[0].sha256, hash(await readFile(join(fixtureRoot, acceptance.files[0].fixture))), 'Visit fixture hash mismatch.')
const mirror = join(resolve(process.argv[3]), 'spring-petclinic.git')
assert.equal(execFileSync('git', ['--git-dir=' + mirror, 'config', '--get', 'remote.origin.url'], { encoding: 'utf8' }).trim(), corpus.repositories.find(r => r.id === 'spring-petclinic').url, 'Public mirror origin mismatch.')
const directory = await mkdtemp(join(tmpdir(), 'bth-v35-visit-variants-'))
const java = 'src/main/java/org/springframework/samples/petclinic/owner/'
const results = []
let interrupted = null
try {
  for (const variant of ['renamed-key', 'bean-validation', 'unlocalized']) {
    const candidateRoot = join(directory, variant)
    execFileSync('git', ['clone', '--quiet', '--no-checkout', '--no-hardlinks', '--', mirror, candidateRoot])
    execFileSync('git', ['checkout', '--quiet', '--detach', task.targetSha], { cwd: candidateRoot })
    const patches = []
    async function replace(path, from, to) {
      const original = await readFile(join(candidateRoot, path))
      const text = original.toString('latin1')
      const changed = text.replace(from, to)
      assert.notEqual(changed, text, path + ': variant failed to modify source')
      const bytes = Buffer.from(changed, 'latin1')
      await writeFile(join(candidateRoot, path), bytes)
      patches.push({ path, beforeSha256: hash(original), afterSha256: hash(bytes) })
    }
    if (variant === 'renamed-key') {
      await replace(java + 'VisitController.java', /typeMismatch\.visitDate/g, 'visit.future.required')
      for (const suffix of ['', '_de', '_es', '_fa', '_ko', '_pt', '_ru', '_tr']) {
        await replace('src/main/resources/messages/messages' + suffix + '.properties', /typeMismatch\.visitDate/g, 'visit.future.required')
      }
    } else if (variant === 'bean-validation') {
      await replace(java + 'VisitController.java', /\t\tif \(visit.getDate\(\) != null && !visit.getDate\(\).isAfter\(LocalDate.now\(\)\)\) \{\n\t\t\tresult.rejectValue\("date", "typeMismatch.visitDate"\);\n\t\t\}\n/, '')
      await replace(java + 'Visit.java', '\tprivate LocalDate date;', '\t@jakarta.validation.constraints.Future\n\tprivate LocalDate date;')
    } else {
      await replace('src/main/resources/messages/messages_de.properties', /^typeMismatch\.visitDate=.*$/m, 'typeMismatch.visitDate=Visit date must be in the future')
    }
    execFileSync(join(candidateRoot, 'mvnw'), ['-q', '-o', 'spring-javaformat:apply'], { cwd: candidateRoot, stdio: 'pipe', timeout: 180000 })
    for (const patch of patches) patch.afterSha256 = hash(await readFile(join(candidateRoot, patch.path)))
    process.stderr.write('Checking ' + variant + '\n')
    const result = await evaluateTaskAcceptance({ mirror, task, acceptance, fixtureRoot, candidateRoot, timeoutMs: 180000 }, {
      processRunner: async input => {
        const execution = await runProcess(input)
        if (execution.exitCode !== 0) process.stderr.write(execution.stdout.tail.slice(-2500) + '\n' + execution.stderr.tail.slice(-1000) + '\n')
        return execution
      }
    })
    results.push({ variant, patches, expectedCandidatePassed: variant !== 'unlocalized', result })
    // A full public mirror can be large; completed variants need hashes, not
    // three retained histories. Only remove this driver's fresh variant clone.
    await rm(candidateRoot, { recursive: true, force: true })
  }
} catch (error) {
  // Preserve completed controls even when later preparation runs out of space.
  interrupted = { code: typeof error.code === 'string' || Number.isInteger(error.code) ? error.code : 'AUDIT_INTERRUPTED' }
  process.stderr.write('Variant audit interrupted; completed results are preserved.\n')
} finally {
  // Only this script's fresh, owned synthetic variant directory; not historical evidence.
  await rm(directory, { recursive: true, force: true })
}
const passed = !interrupted && results.length === 3 && results.every(r => r.result.controlsConfirmed && r.result.candidatePassed === r.expectedCandidatePassed)
console.log(JSON.stringify({ schemaVersion: 1, kind: 'visit-oracle-implementation-independence-controls', providerCalls: 0,
  taskId: task.id, baseSha: task.baseSha, targetSha: task.targetSha, acceptance,
  sourceHashes: { 'src/evaluation/task-acceptance.mjs': hash(await readFile(join(root, 'src/evaluation/task-acceptance.mjs'))),
    'scripts/check-visit-oracle-variants.mjs': hash(await readFile(fileURLToPath(import.meta.url))) },
  results, interrupted, passed }, null, 2))
if (!passed) process.exitCode = 1
