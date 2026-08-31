import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { parseEvaluationCorpus } from '../src/evaluation/corpus.mjs'
import { parseProviderBenchmarkConfig } from '../src/evaluation/provider-benchmark-config.mjs'
import { portableVerificationTemplates } from '../src/core/portable-test-discovery.mjs'

test('Nest oracle executes the exact generated production Jest runner', async () => {
  const runner = portableVerificationTemplates({
    canGenerateVerification: true, framework: 'jest', projectPath: '.',
    testArgs: ['--config', 'test/bth/jest.config.cjs', '--ci', '--no-cache']
  })[0]
  assert.equal(await readFile('benchmarks/public-backend-v1/fixtures/nest/verify-jest.mjs', 'utf8'), runner.content)
})

test('provider comparison config covers all three repositories and twenty tasks without embedding gold paths', async () => {
  const corpus = parseEvaluationCorpus(await readFile('benchmarks/public-backend-v1/corpus.json', 'utf8'), 'corpus')
  const configText = await readFile('benchmarks/public-backend-v1/provider-comparison.json', 'utf8')
  const config = parseProviderBenchmarkConfig(configText, corpus, 'provider comparison')

  assert.equal(config.repositories.length, 3)
  assert.equal(config.repositories.flatMap((entry) => entry.tasks).length, 20)
  assert.equal(config.repositories.find((entry) => entry.id === 'spring-petclinic').buildSystem, 'maven')
  assert.doesNotMatch(configText, /goldPaths|targetSha/)
})

test('new Nest acceptance tasks have exact pinned fixtures, named cases and the shared production runner', async () => {
  const corpus = parseEvaluationCorpus(await readFile('benchmarks/public-backend-v1/corpus.json', 'utf8'))
  const config = parseProviderBenchmarkConfig(await readFile('benchmarks/public-backend-v1/provider-comparison.json', 'utf8'), corpus)
  const tasks = config.repositories.find(repository => repository.id === 'nestjs-boilerplate').tasks
  for (const [id, caseCount] of [['nest-01-session-update-by-hash', 12], ['nest-03-swagger-language-header', 3], ['nest-06-user-email-conflict', 7]]) {
    const task = tasks.find(task => task.id === id)
    assert.ok(task.acceptance, id + ': independent acceptance is missing')
    assert.equal(task.acceptance.kind, 'fixture-tests')
    assert.deepEqual(task.acceptance.command, ['node', 'test/bth/run.cjs'])
    assert.equal(task.acceptance.cases.length, caseCount)
    const files = task.acceptance.files.map(file => file.path)
    assert.ok(files.includes('test/bth/run.cjs'))
    assert.ok(files.includes('test/bth/verify-jest.mjs'))
    assert.ok(task.acceptance.cases.every(entry => files.includes(entry.className)))
    const spec = task.acceptance.files.find(file => file.path.endsWith('.spec.ts'))
    const declaredNames = [...(await readFile('benchmarks/public-backend-v1/' + spec.fixture, 'utf8')).matchAll(/\btest\('([^']+)'/g)].map(match => match[1])
    assert.deepEqual(task.acceptance.cases.map(entry => entry.name), declaredNames)
    assert.doesNotMatch(JSON.stringify(task.decisions), /fixtures|\.spec\.ts|targetSha|goldPaths/)
  }
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
  const springTasks = config.repositories.find((entry) => entry.id === 'spring-petclinic').tasks
  for (const [id, caseCount] of [['spring-05-binder-id-protection', 5], ['spring-06-pet-update', 4]]) {
    const task = springTasks.find((entry) => entry.id === id)
    assert.equal(task.acceptance.kind, 'fixture-tests')
    assert.equal(task.acceptance.cases.length, caseCount)
    assert.ok(task.acceptance.command.includes('-o'), 'Oracle execution must not fetch dependencies')
  }
  assert.ok(config.repositories.find((entry) => entry.id === 'nestjs-boilerplate').allowedPrefixes.includes('.hygen/generate/'))
  assert.ok(config.repositories.every((entry) => !entry.allowedPrefixes.includes('.env')), 'environment secrets remain outside edit scope')
})

test('FastAPI prepared baseline has pinned preimages, complete protected inputs and no production replacements', async () => {
  const corpus = parseEvaluationCorpus(await readFile('benchmarks/public-backend-v1/corpus.json', 'utf8'))
  const config = parseProviderBenchmarkConfig(await readFile('benchmarks/public-backend-v1/provider-comparison.json', 'utf8'), corpus)
  const tasks = config.repositories.flatMap(repository => repository.tasks).filter(task => task.projectFixture)
  assert.deepEqual(tasks.map(task => task.id), ['fastapi-05-missing-user'])
  const fixture = tasks[0].projectFixture
  assert.equal(fixture.files.length, 8)
  assert.equal(fixture.files.filter(file => file.expectedSha256 !== null).length, 3)
  assert.equal(fixture.verification.gates[0].result.minimumTests, 57)
  assert.equal(fixture.workspacePreparation.kind, 'uv-sync-offline')
  for (const file of fixture.files) {
    const bytes = await readFile('benchmarks/public-backend-v1/' + file.fixture)
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.path)
    assert.match(file.path, /^(?:backend\/tests\/|\.backend-harness\/bin\/)/)
    assert.ok(fixture.verification.gates[0].inputs.includes(file.path))
  }
})
