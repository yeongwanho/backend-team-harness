import test from 'node:test'
import assert from 'node:assert/strict'
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
})
