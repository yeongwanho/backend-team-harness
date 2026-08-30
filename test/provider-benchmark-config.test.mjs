import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { parseEvaluationCorpus } from '../src/evaluation/corpus.mjs'
import { parseProviderBenchmarkConfig } from '../src/evaluation/provider-benchmark-config.mjs'

test('provider comparison config covers all three repositories and twenty tasks without embedding gold paths', async () => {
  const corpus = parseEvaluationCorpus(await readFile('benchmarks/public-backend-v1/corpus.json', 'utf8'), 'corpus')
  const configText = await readFile('benchmarks/public-backend-v1/provider-comparison.json', 'utf8')
  const config = parseProviderBenchmarkConfig(configText, corpus, 'provider comparison')

  assert.equal(config.repositories.length, 3)
  assert.equal(config.repositories.flatMap((entry) => entry.tasks).length, 20)
  assert.equal(config.repositories.find((entry) => entry.id === 'spring-petclinic').buildSystem, 'maven')
  assert.doesNotMatch(configText, /goldPaths|targetSha/)
})

test('provider comparison config rejects missing tasks, shell-shaped fields, and traversal', async () => {
  const corpus = parseEvaluationCorpus(await readFile('benchmarks/public-backend-v1/corpus.json', 'utf8'), 'corpus')
  const valid = JSON.parse(await readFile('benchmarks/public-backend-v1/provider-comparison.json', 'utf8'))

  const missing = structuredClone(valid)
  missing.repositories[0].tasks.pop()
  assert.throws(() => parseProviderBenchmarkConfig(JSON.stringify(missing), corpus), /cover every corpus task/)

  const traversal = structuredClone(valid)
  traversal.repositories[0].allowedPrefixes = ['../outside/']
  assert.throws(() => parseProviderBenchmarkConfig(JSON.stringify(traversal), corpus), /stay inside/)

  const unknown = structuredClone(valid)
  unknown.repositories[0].shell = true
  assert.throws(() => parseProviderBenchmarkConfig(JSON.stringify(unknown), corpus), /unknown key shell/)
  const mismatched = structuredClone(valid)
  mismatched.repositories[0].tasks[0].decisions.schemaStrategy = 'bootstrap-only'
  assert.throws(() => parseProviderBenchmarkConfig(JSON.stringify(mismatched), corpus), /schemaStrategy/)
  const bootstrap = parseProviderBenchmarkConfig(JSON.stringify(valid), corpus).repositories[0].tasks.find((task) => task.id === 'spring-07-mysql-user')
  assert.equal(bootstrap.decisions.schemaStrategy, 'bootstrap-only')
})

test('checked-in evaluator fixtures match their pinned bytes and stay outside provider input', async () => {
  const corpus = parseEvaluationCorpus(await readFile('benchmarks/public-backend-v1/corpus.json', 'utf8'))
  const config = parseProviderBenchmarkConfig(await readFile('benchmarks/public-backend-v1/provider-comparison.json', 'utf8'), corpus)
  let fixtures = 0
  for (const repository of config.repositories) for (const task of repository.tasks) {
    if (task.acceptance?.kind !== 'fixture-tests') continue
    for (const file of task.acceptance.files) {
      fixtures += 1
      const bytes = await readFile('benchmarks/public-backend-v1/' + file.fixture)
      assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, task.id)
      assert.doesNotMatch(JSON.stringify(task.decisions), /AcceptanceTests|fixtures\/|sha256/)
    }
  }
  assert.ok(fixtures > 0)
  assert.ok(config.repositories.find((entry) => entry.id === 'nestjs-boilerplate').allowedPrefixes.includes('.hygen/generate/'))
  assert.ok(config.repositories.every((entry) => !entry.allowedPrefixes.includes('.env')), 'environment secrets remain outside edit scope')
})
