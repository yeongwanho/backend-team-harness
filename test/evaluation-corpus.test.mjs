import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parseEvaluationCorpus } from '../src/evaluation/corpus.mjs'
import { aggregateLocalization, ndcgAt, recallAt, scoreLocalization } from '../src/evaluation/metrics.mjs'

test('public backend corpus is three independently sourced repositories and exactly twenty versioned tasks', async () => {
  const corpus = parseEvaluationCorpus(await readFile('benchmarks/public-backend-v1/corpus.json', 'utf8'), 'public corpus')
  assert.equal(corpus.repositoryCount, 3)
  assert.equal(corpus.taskCount, 20)
  assert.deepEqual(corpus.repositories.map((entry) => entry.language).sort(), ['java', 'python', 'typescript'])
  assert.equal(new Set(corpus.repositories.map((entry) => new URL(entry.url).pathname.split('/')[1])).size, 3)
  assert.match(corpus.sourceSha256, /^[a-f0-9]{64}$/)
  for (const task of corpus.repositories.flatMap((entry) => entry.tasks)) assert.match(task.requirementSha256, /^[a-f0-9]{64}$/)
  const visit = corpus.repositories[0].tasks.find((entry) => entry.id === 'spring-04-future-visit')
  assert.match(visit.requirement, /strictly in the future/)
  assert.match(visit.requirement, /reject today or earlier/)
})

test('requirement edits change both corpus and task fingerprints despite identical commit pins', async () => {
  const original = await readFile('benchmarks/public-backend-v1/corpus.json', 'utf8')
  const edited = JSON.parse(original)
  edited.repositories[0].tasks[0].requirement += ' Preserve existing compatibility.'
  const before = parseEvaluationCorpus(original)
  const after = parseEvaluationCorpus(JSON.stringify(edited))
  assert.notEqual(before.sourceSha256, after.sourceSha256)
  assert.notEqual(before.repositories[0].tasks[0].requirementSha256, after.repositories[0].tasks[0].requirementSha256)
  assert.equal(before.repositories[0].tasks[1].requirementSha256, after.repositories[0].tasks[1].requirementSha256)
})

test('corpus parser rejects unsafe paths, duplicate task ids, unknown fields, and abbreviated SHAs', async () => {
  const valid = JSON.parse(await readFile('benchmarks/public-backend-v1/corpus.json', 'utf8'))
  const unsafe = structuredClone(valid)
  unsafe.repositories[0].tasks[0].goldPaths[0] = '../secret'
  assert.throws(() => parseEvaluationCorpus(JSON.stringify(unsafe)), /stay inside/)

  const duplicate = structuredClone(valid)
  duplicate.repositories[1].tasks[0].id = duplicate.repositories[0].tasks[0].id
  assert.throws(() => parseEvaluationCorpus(JSON.stringify(duplicate)), /duplicate task id/)

  const abbreviated = structuredClone(valid)
  abbreviated.repositories[0].tasks[0].baseSha = 'abc1234'
  assert.throws(() => parseEvaluationCorpus(JSON.stringify(abbreviated)), /full Git SHAs/)

  const unknown = structuredClone(valid)
  unknown.repositories[0].tasks[0].score = 1
  assert.throws(() => parseEvaluationCorpus(JSON.stringify(unknown)), /unknown key score/)
})

test('localization metrics use binary relevance with stable duplicate handling', () => {
  const ranked = ['a', 'x', 'b', 'a', 'c']
  const gold = ['a', 'b', 'c']
  assert.equal(recallAt(ranked, gold, 2), 1 / 3)
  assert.equal(recallAt(ranked, gold, 5), 1)
  assert.ok(ndcgAt(ranked, gold, 5) > 0.8)
  assert.ok(ndcgAt(ranked, gold, 5) < 1)

  const score = scoreLocalization({ id: 'task', goldPaths: gold }, ranked)
  const aggregate = aggregateLocalization([score, { ...score, taskId: 'zero', recallAt5: 0, recallAt20: 0, ndcgAt20: 0 }])
  assert.equal(aggregate.taskCount, 2)
  assert.deepEqual(aggregate.zeroRecallAt20Tasks, ['zero'])
})
