import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'

test('FastAPI acceptance selects exactly one pinned suite with every declared assertion', async () => {
  const config = JSON.parse(await readFile('benchmarks/public-backend-v1/provider-comparison.json', 'utf8'))
  const tasks = config.repositories.find(r => r.id === 'fastapi-template').tasks
  for (const id of ['fastapi-04-constant-time-login', 'fastapi-05-missing-user']) {
    const acceptance = tasks.find(t => t.id === id).acceptance
    assert.ok(acceptance, 'Missing FastAPI independent control: ' + id)
    assert.deepEqual(acceptance.command, ['node', 'backend/test/bth/run.mjs'])
    assert.deepEqual(acceptance.reports, ['backend/.cache/bth-junit.xml'])
    assert.equal(acceptance.files.length, 3)
    const suite = acceptance.files.find(f => /test_.*\.py$/.test(f.path))
    assert.ok(suite)
    for (const file of acceptance.files) {
      const content = await readFile('benchmarks/public-backend-v1/' + file.fixture)
      assert.equal(createHash('sha256').update(content).digest('hex'), file.sha256)
    }
    const content = await readFile('benchmarks/public-backend-v1/' + suite.fixture, 'utf8')
    const names = [...content.matchAll(/^def (test_[a-z0-9_]+)\(/gm)].map(m => m[1])
    assert.equal(names.length, id === 'fastapi-04-constant-time-login' ? 9 : 7)
    assert.deepEqual(acceptance.cases, names.map(name => ({ className: basename(suite.path, '.py'), name })))
  }
})

test('evaluator runner refuses normal source checkout before any setup or database action', () => {
  const result = spawnSync(process.execPath, ['benchmarks/public-backend-v1/fixtures/fastapi/run.mjs'], { encoding: 'utf8', timeout: 10000 })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Run only the evaluator fixture/)
  assert.doesNotMatch(result.stderr, /BTH_FASTAPI_QA|Cleanup failed/)
})

test('FastAPI fixture contract declares offline bounded setup and owned ephemeral DB cleanup', async () => {
  const runner = await readFile('benchmarks/public-backend-v1/fixtures/fastapi/run.mjs', 'utf8')
  for (const text of ['--frozen', '--offline', '--no-install-workspace', '--no-build', '--no-python-downloads', '--pull=never', "'--driver', 'bridge'",
    '127.0.0.1::5432', '--read-only', '--cap-drop=ALL', '--pids-limit=128', 'bth.fastapi.oracle', '--confcutdir', 'containerRemoved', 'networkRemoved']) assert.ok(runner.includes(text), text)
  assert.match(runner, /postgres@sha256:[a-f0-9]{64}/)
  assert.doesNotMatch(runner, /docker.*prune|--privileged|--network=host/)
  assert.ok(runner.includes('OS egress isolation not enforced'))
  const setup = await readFile('benchmarks/public-backend-v1/fixtures/fastapi/conftest.py', 'utf8')
  assert.ok(setup.includes('kwargs["_env_file"] = None'))
  assert.ok(setup.includes('engine.dialect.name == "postgresql"'))
})
