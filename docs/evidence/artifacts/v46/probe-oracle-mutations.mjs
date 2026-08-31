// Selected behavioral mutations in disposable public target snapshots only.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createIsolatedGitSnapshot } from '../../../../src/evaluation/isolated-git-snapshot.mjs'
import { evaluateTaskAcceptance } from '../../../../src/evaluation/task-acceptance.mjs'
import { loadEvaluationCorpus } from '../../../../src/evaluation/corpus.mjs'
import { loadProviderBenchmarkConfig } from '../../../../src/evaluation/provider-benchmark-config.mjs'

const directory = dirname(fileURLToPath(import.meta.url)), root = resolve(directory, '../../../..')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const corpus = await loadEvaluationCorpus(join(root, 'benchmarks/public-backend-v1/corpus.json'))
const config = await loadProviderBenchmarkConfig(join(root, 'benchmarks/public-backend-v1/provider-comparison.json'), corpus)
const task = corpus.repositories[0].tasks.find(task => task.id === 'spring-01-pet-association')
const acceptance = config.repositories[0].tasks.find(entry => entry.id === task.id).acceptance
const mirror = '/tmp/bth-provider-comparison-cache-v2/spring-petclinic.git'
const fixtureRoot = join(root, 'benchmarks/public-backend-v1')
const sourcePaths = ['src/evaluation/isolated-git-snapshot.mjs', 'src/evaluation/task-acceptance.mjs',
  'benchmarks/public-backend-v1/provider-comparison.json', 'benchmarks/public-backend-v1/fixtures/spring/PetAssociationAcceptanceTests.java',
  'docs/evidence/artifacts/v46/probe-oracle-mutations.mjs']
const sourceHashes = Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, hash(await readFile(join(root, path)))])))
const owner = 'src/main/java/org/springframework/samples/petclinic/owner/Owner.java'
const validator = 'src/main/java/org/springframework/samples/petclinic/owner/PetValidator.java'
const idLoop = '\t\tfor (Pet existingPet : getPets()) {\n\t\t\tif (!existingPet.isNew() && !pet.isNew() && Objects.equals(existingPet.getId(), pet.getId())) {\n\t\t\t\treturn;\n\t\t\t}\n\t\t}\n'
const mutations = [
  { id: 'same-new-object-duplicate', path: owner, before: '\t\tif (getPets().contains(pet)) {\n\t\t\treturn;\n\t\t}\n', after: '', expected: 'addingTheSameNewObjectTwiceDoesNotDuplicateIt' },
  { id: 'same-id-different-object-duplicate', path: owner, before: idLoop, after: '', expected: 'anotherObjectWithTheSamePersistedIdDoesNotReplaceOrDuplicateIt' },
  { id: 'distinct-null-ids-collapsed', path: owner, before: '!existingPet.isNew() && !pet.isNew() && Objects.equals(existingPet.getId(), pet.getId())', after: 'Objects.equals(existingPet.getId(), pet.getId())', expected: 'separateNewPetsAreNotDeduplicatedByTheirNullIds' },
  { id: 'reject-thirty-characters', path: validator, before: 'MAX_NAME_LENGTH = 30;', after: 'MAX_NAME_LENGTH = 29;', expected: 'namesAtThirtyCharactersPassAndThirtyOneCharactersFail' },
  { id: 'accept-thirty-one-characters', path: validator, before: 'MAX_NAME_LENGTH = 30;', after: 'MAX_NAME_LENGTH = 31;', expected: 'namesAtThirtyCharactersPassAndThirtyOneCharactersFail' }
]
const results = []
for (const mutation of mutations) {
  const allocation = await mkdtemp(join(tmpdir(), 'bth-v46-oracle-mutation-'))
  try {
    const candidateRoot = join(allocation, 'candidate')
    await createIsolatedGitSnapshot(mirror, task.targetSha, candidateRoot)
    const path = join(candidateRoot, mutation.path), before = await readFile(path, 'utf8')
    assert.equal(before.split(mutation.before).length, 2, 'Mutation must match exactly once')
    const after = before.replace(mutation.before, mutation.after)
    await writeFile(path, after)
    const result = await evaluateTaskAcceptance({ mirror, task, acceptance, fixtureRoot, candidateRoot, timeoutMs: 240000 })
    const expected = result.candidate?.cases.find(entry => entry.name === mutation.expected)
    const killed = result.controlsConfirmed === true && result.candidateUntouched === true &&
      result.candidate?.sourceStable === true && result.candidate?.regressionReproduced === true && expected?.outcome === 'failed'
    results.push({ id: mutation.id, path: mutation.path, beforeSha256: hash(before), afterSha256: hash(after),
      expectedFailingCase: mutation.expected, killed, result })
    console.log(JSON.stringify({ mutation: mutation.id, killed }))
  } finally { await rm(allocation, { recursive: true, force: true }) }
}
let diagnosticCandidate = null
if (process.argv[2]) {
  diagnosticCandidate = await evaluateTaskAcceptance({ mirror, task, acceptance, fixtureRoot, candidateRoot: resolve(process.argv[2]), timeoutMs: 240000 })
  console.log(JSON.stringify({ separateCandidateDiagnostic: true, passed: diagnosticCandidate.candidatePassed, untouched: diagnosticCandidate.candidateUntouched }))
}
for (const [path, expected] of Object.entries(sourceHashes)) assert.equal(hash(await readFile(join(root, path))), expected, path)
await writeFile(join(directory, 'oracle-mutations.json'), JSON.stringify({ schemaVersion: 1, recordedAt: new Date().toISOString(),
  sourceHashes, taskId: task.id, baseSha: task.baseSha, targetSha: task.targetSha, providerCalls: 0,
  curated: results.length, killed: results.filter(result => result.killed).length, results, diagnosticCandidate, goalComplete: false,
  limitations: ['Five selected behavioral mutations, not exhaustive mutation coverage.',
    'Only disposable public target snapshots are mutated; original repositories and scored provider candidates are unchanged.',
    'Compiler/setup/missing-report failures do not count as killed mutations.',
    'The optional read-only candidate diagnostic does not replace any original provider score.'] }, null, 2) + '\n', { flag: 'wx' })
assert.ok(results.every(result => result.killed), 'Every selected mutation must fail its intended assertion')
