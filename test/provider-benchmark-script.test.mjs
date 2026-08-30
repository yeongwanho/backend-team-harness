import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const script = 'scripts/benchmark-provider-comparison.mjs'

test('provider benchmark plan exposes one exact costed case without starting a provider', () => {
  const result = spawnSync(process.execPath, [
    script, '--plan', '--provider', 'codex', '--lane', 'bth', '--task', 'spring-02-owner-search-whitespace'
  ], { encoding: 'utf8' })

  assert.equal(result.status, 0, result.stderr)
  const plan = JSON.parse(result.stdout)
  assert.equal(plan.selectedCases, 1)
  assert.equal(plan.providerCalls, 1)
  assert.equal(plan.cases[0].id, 'codex:bth:spring-02-owner-search-whitespace')
})

test('provider benchmark execution refuses cost and network activity without the explicit acknowledgement', () => {
  const result = spawnSync(process.execPath, [
    script, '--execute', '--provider', 'codex', '--lane', 'bth', '--task', 'spring-02-owner-search-whitespace',
    '--output', '/tmp/bth-provider-benchmark-refusal', '--allow-network'
  ], { encoding: 'utf8', env: { ...process.env, BTH_PROVIDER_BENCHMARK: '' } })

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /BTH_PROVIDER_BENCHMARK=I_UNDERSTAND_PROVIDER_COSTS/)
})

test('provider benchmark preflight requires network acknowledgement but no provider-cost acknowledgement', () => {
  const result = spawnSync(process.execPath, [
    script, '--preflight', '--task', 'spring-02-owner-search-whitespace', '--output', '/tmp/bth-provider-preflight-refusal'
  ], { encoding: 'utf8', env: { ...process.env, BTH_PROVIDER_BENCHMARK: '' } })

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /--preflight requires.*--allow-network/)
  assert.doesNotMatch(result.stderr, /I_UNDERSTAND_PROVIDER_COSTS/)
})

test('paid provider execution refuses a task without an independent acceptance oracle', async () => {
  // Adding an oracle to the real corpus must never turn this refusal test into
  // an actual paid provider invocation.
  const root = await mkdtemp(join(tmpdir(), 'bth-missing-oracle-test-'))
  const config = JSON.parse(await readFile('benchmarks/public-backend-v1/provider-comparison.json', 'utf8'))
  for (const repository of config.repositories) for (const task of repository.tasks) delete task.acceptance
  const configPath = join(root, 'comparison.json')
  await writeFile(configPath, JSON.stringify(config))
  const result = spawnSync(process.execPath, [
    script, '--execute', '--provider', 'codex', '--lane', 'bth', '--task', 'spring-01-pet-association',
    '--config', configPath, '--output', join(root, 'output'), '--allow-network'
  ], { encoding: 'utf8', timeout: 10_000, env: { PATH: join(root, 'no-executables'), BTH_PROVIDER_BENCHMARK: 'I_UNDERSTAND_PROVIDER_COSTS' } })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /no independent acceptance oracle/)
})

test('preflight resume refuses legacy readiness before any clone or test execution', async () => {
  const output = await mkdtemp(join(tmpdir(), 'bth-stale-preflight-'))
  await mkdir(join(output, 'preflight'))
  await writeFile(join(output, 'preflight/spring-02-owner-search-whitespace.json'), JSON.stringify({ readyForProviderComparison: true }))
  const result = spawnSync(process.execPath, [
    script, '--preflight', '--task', 'spring-02-owner-search-whitespace', '--output', output, '--resume', '--allow-network'
  ], { encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /refusing stale readiness evidence/)
})
