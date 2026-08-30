import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildProviderInvocation,
  buildProviderPromptInvocation,
  extractProviderFailure,
  extractProviderUsage,
  normalizeProviderUsage,
  providerUsageObserver,
  probeImplementationProvider,
  resolveProviderExecutable,
  runImplementationProvider,
  runProviderPrompt,
  selectImplementationProfile
} from '../src/providers/model-cli.mjs'
import { buildProcessLaunch } from '../src/core/process-runner.mjs'

test('auto implementation profiles stay balanced without evidence and escalate structured risk', () => {
  const unknown = selectImplementationProfile({ mode: 'auto', claims: {} })
  assert.equal(unknown.selected, 'balanced')
  assert.equal(unknown.contextBudgetCharacters, 6000)

  const small = selectImplementationProfile({
    mode: 'auto',
    projectRuleReadiness: 'confirmed',
    adjacentCodeReady: true,
    claims: {
      changesDatabase: false, requiresMigration: false, changesPublicApi: false,
      preservesCompatibility: true, modules: ['users'], requiredGates: ['tests']
    }
  })
  assert.equal(small.selected, 'fast')
  assert.equal(small.effort, 'low')
  assert.equal(small.verificationStrategy, 'all-required-gates')

  const compatibleCrud = selectImplementationProfile({
    mode: 'auto',
    projectRuleReadiness: 'confirmed',
    adjacentCodeReady: true,
    claims: {
      changesDatabase: true, requiresMigration: false,
      changesPublicApi: true, preservesCompatibility: true,
      modules: ['users'], requiredGates: ['tests']
    }
  })
  assert.equal(compatibleCrud.selected, 'fast')
  assert.deepEqual(compatibleCrud.reasons, ['explicit-single-module-no-migration-compatible-change'])

  const unresolvedConventions = selectImplementationProfile({
    mode: 'auto',
    projectRuleReadiness: 'unknown',
    adjacentCodeReady: true,
    claims: {
      changesDatabase: false, requiresMigration: false, changesPublicApi: false,
      preservesCompatibility: true, modules: ['users'], requiredGates: ['tests']
    }
  })
  assert.equal(unresolvedConventions.selected, 'balanced')
  assert.deepEqual(unresolvedConventions.reasons, ['project-rules-not-confirmed-for-fast-mode'])

  const missingAdjacentCode = selectImplementationProfile({
    mode: 'auto',
    projectRuleReadiness: 'confirmed',
    adjacentCodeReady: false,
    claims: {
      changesDatabase: false, requiresMigration: false, changesPublicApi: false,
      preservesCompatibility: true, modules: ['users'], requiredGates: ['tests']
    }
  })
  assert.equal(missingAdjacentCode.selected, 'balanced')
  assert.deepEqual(missingAdjacentCode.reasons, ['adjacent-code-not-confirmed-for-fast-mode'])

  const missingObservedConventions = selectImplementationProfile({
    mode: 'auto',
    projectRuleReadiness: 'confirmed',
    adjacentCodeReady: true,
    conventionsReady: false,
    claims: {
      changesDatabase: false, requiresMigration: false, changesPublicApi: false,
      preservesCompatibility: true, modules: ['users'], requiredGates: ['tests']
    }
  })
  assert.equal(missingObservedConventions.selected, 'balanced')
  assert.deepEqual(missingObservedConventions.reasons, ['project-conventions-not-observed-for-fast-mode'])

  const conflictingConventions = selectImplementationProfile({
    mode: 'auto',
    projectRuleReadiness: 'conflict',
    adjacentCodeReady: true,
    claims: {
      changesDatabase: false, requiresMigration: false, changesPublicApi: false,
      preservesCompatibility: true, modules: ['users'], requiredGates: ['tests']
    }
  })
  assert.equal(conflictingConventions.selected, 'deep')
  assert.deepEqual(conflictingConventions.reasons, ['project-rule-conflict'])

  const breakingApi = selectImplementationProfile({
    mode: 'auto',
    claims: { changesDatabase: false, requiresMigration: false, changesPublicApi: true, preservesCompatibility: false, modules: ['users'] }
  })
  assert.equal(breakingApi.selected, 'deep')
  assert.deepEqual(breakingApi.reasons, ['public-api-compatibility-risk'])

  const risky = selectImplementationProfile({ mode: 'auto', claims: { requiresMigration: true } })
  assert.equal(risky.selected, 'deep')
  assert.equal(risky.contextBudgetCharacters, 12000)

  const bounded = selectImplementationProfile({ mode: 'fast', contextBudgetCharacters: 256 })
  assert.equal(bounded.contextBudgetCharacters, 256)
  assert.throws(() => selectImplementationProfile({ mode: 'fast', contextBudgetCharacters: 40 }), /between 64 and 32768/)

  const largeAuto = selectImplementationProfile({ mode: 'auto', taskCharacters: 30_000 })
  assert.equal(largeAuto.selected, 'deep')
  assert.equal(largeAuto.taskBudgetCharacters, 64_000)
  assert.throws(
    () => selectImplementationProfile({ mode: 'fast', taskCharacters: 8_001 }),
    /exceeds the fast profile limit/
  )
  assert.throws(
    () => selectImplementationProfile({ mode: 'deep', taskCharacters: 64_001 }),
    /split the task/
  )
})

test('bootstrap schema work stays deep in auto mode without slowing existing-schema CRUD', () => {
  const input = {
    mode: 'auto', projectRuleReadiness: 'confirmed', adjacentCodeReady: true, conventionsReady: true,
    claims: {
      changesDatabase: true, requiresMigration: false, preservesCompatibility: true,
      changesPublicApi: false, modules: ['users'], requiredGates: ['tests']
    }
  }
  assert.equal(selectImplementationProfile(input).selected, 'fast')
  const bootstrap = selectImplementationProfile({ ...input, claims: { ...input.claims, bootstrapOnly: true } })
  assert.equal(bootstrap.selected, 'deep')
  assert.deepEqual(bootstrap.reasons, ['bootstrap-schema-risk'])
  assert.equal(bootstrap.verificationStrategy, 'all-required-gates')
  assert.equal(selectImplementationProfile({ ...input, mode: 'fast', claims: { ...input.claims, bootstrapOnly: true } }).selected, 'fast')
})

test('provider argv uses non-interactive bounded modes without dangerous bypass flags', () => {
  const executable = { path: '/usr/local/bin/provider' }
  const profile = selectImplementationProfile({ mode: 'balanced' })
  const codex = buildProviderInvocation({ provider: 'codex', model: null }, executable, './request.json', profile)
  assert.deepEqual(codex.args.slice(0, 3), ['exec', '--ephemeral', '--ignore-user-config'])
  assert.ok(codex.args.includes('--approve-for-me'))
  assert.equal(codex.args.includes('--sandbox'), false)
  assert.equal(codex.args.some((entry) => entry.includes('dangerously-bypass')), false)
  assert.ok(codex.args.includes('model_reasoning_effort=medium'))
  assert.match(codex.args.at(-1), /ranked codeContext paths/)
  assert.match(codex.args.at(-1), /projectConventions/)
  assert.match(codex.args.at(-1), /do not reread every policy document/)
  assert.match(codex.args.at(-1), /naming, layering, DTO\/error, transaction, persistence, and test patterns/)
  assert.match(codex.args.at(-1), /do not guess/)
  assert.match(codex.args.at(-1), /Do not run build, test, formatter, linter/)
  assert.match(codex.args.at(-1), /Writing tests is required; executing them belongs to the evaluator/)
  assert.match(codex.args.at(-1), /zero discovered or only skipped tests cannot complete/)
  assert.match(codex.args.at(-1), /verification\.testAuthoring/)
  assert.match(codex.args.at(-1), /nearby E2E suite may not be executed/)
  assert.match(codex.args.at(-1), /Do not add pass-only placeholders/)

  const claude = buildProviderInvocation({ provider: 'claude', model: 'sonnet', maxBudgetUsd: 1.5 }, executable, './request.json', profile)
  assert.ok(claude.args.includes('stream-json'))
  assert.ok(claude.args.includes('--verbose'))
  assert.ok(claude.args.includes('acceptEdits'))
  assert.ok(claude.args.includes('Read,Edit,Write,Glob,Grep'))
  assert.ok(claude.args.includes('--max-budget-usd'))
  assert.equal(claude.args.some((entry) => entry.includes('bypassPermissions')), false)
  assert.equal(claude.args.some((entry) => entry.includes('dangerously')), false)
})

test('direct benchmark prompts use the same provider isolation and effort argv as harness prompts', () => {
  const executable = { path: '/usr/local/bin/provider' }
  const profile = { effort: 'medium' }
  const invocation = buildProviderPromptInvocation(
    { provider: 'codex', model: null }, executable, 'Inspect and implement one bounded task.', profile
  )

  assert.equal(invocation.program, executable.path)
  assert.ok(invocation.args.includes('--ephemeral'))
  assert.ok(invocation.args.includes('--ignore-user-config'))
  assert.ok(invocation.args.includes('model_reasoning_effort=medium'))
  assert.equal(invocation.args.at(-1), 'Inspect and implement one bounded task.')
})

test('Codex provider argv remains representable through a Windows npm command shim', () => {
  const profile = selectImplementationProfile({ mode: 'balanced' })
  const invocation = buildProviderInvocation(
    { provider: 'codex', model: null },
    { path: 'C:\\tools\\codex.cmd' },
    './request.json',
    profile
  )
  const launch = buildProcessLaunch({
    program: 'C:\\tools\\codex.cmd',
    args: invocation.args,
    platform: 'win32',
    env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' }
  })
  assert.equal(launch.program, 'C:\\Windows\\System32\\cmd.exe')
  assert.match(launch.args.at(-1), /model_reasoning_effort=medium/)
})

test('provider usage extraction keeps bounded numeric telemetry and discards prose', () => {
  const usage = extractProviderUsage(JSON.stringify({
    type: 'result', usage: { input_tokens: 120, output_tokens: 34 }, total_cost_usd: 0.012,
    secret: 'must not be copied'
  }))
  assert.equal(usage['usage.input_tokens'], 120)
  assert.equal(usage['usage.output_tokens'], 34)
  assert.equal(usage.total_cost_usd, 0.012)
  assert.equal(Object.values(usage).some((value) => typeof value === 'string'), false)

  const truncatedSingleDocument = 'unparseable-result-tail' + 'x'.repeat(9000) +
    '","usage":{"input_tokens":321,"output_tokens":45},"total_cost_usd":0.5}'
  const recovered = extractProviderUsage(truncatedSingleDocument.slice(-8192))
  assert.equal(recovered.input_tokens, 321)
  assert.equal(recovered.output_tokens, 45)
  assert.equal(recovered.total_cost_usd, 0.5)
})

test('provider usage is normalized to one token, cost, time, and turn contract', () => {
  const claude = normalizeProviderUsage('claude', {
    'usage.input_tokens': 120,
    'usage.output_tokens': 34,
    'usage.cache_read_input_tokens': 50,
    'usage.cache_creation_input_tokens': 20,
    total_cost_usd: 0.012,
    duration_ms: 900,
    num_turns: 2
  }, 1000)
  assert.deepEqual(claude.tokens, {
    input: 190, uncachedInput: 120, output: 34, cachedInput: 50, cacheCreationInput: 20, reasoningOutput: null, total: 224
  })
  assert.equal(claude.costUsd, 0.012)
  assert.equal(claude.durationMs, 900)
  assert.equal(claude.turns, 2)

  const codex = normalizeProviderUsage('codex', {
    'usage.input_tokens': 7,
    'usage.output_tokens': 2,
    'usage.reasoning_output_tokens': 1
  }, 321)
  assert.equal(codex.tokens.total, 9)
  assert.equal(codex.tokens.uncachedInput, null)
  assert.equal(codex.tokens.reasoningOutput, 1)
  assert.equal(codex.durationMs, 321)
  assert.equal(codex.costUsd, null)

  const missingCache = normalizeProviderUsage('claude', { 'usage.input_tokens': 12, 'usage.output_tokens': 3 })
  assert.equal(missingCache.tokens.uncachedInput, 12)
  assert.equal(missingCache.tokens.input, null)
  assert.equal(missingCache.tokens.total, null)
  assert.equal(normalizeProviderUsage('codex', { 'usage.input_tokens': 7 }).tokens.total, null)
  assert.equal(normalizeProviderUsage('claude', { 'usage.input_tokens': 0, 'usage.cache_read_input_tokens': 0, 'usage.cache_creation_input_tokens': 0, 'usage.output_tokens': 0 }).tokens.total, 0)
})

test('only complete invocation-final usage is measured, not message usage or output fragments', () => {
  const observer = providerUsageObserver('claude')
  for (const line of [null, 'not JSON', 'x'.repeat(1024 * 1024 + 1), '{"type":"assistant","message":{"usage":{"input_tokens":99}}}', '"usage":{"input_tokens":99}']) observer.onLine(line)
  assert.deepEqual(observer.snapshot(), { scope: 'not-measured', values: {} })
  observer.onLine('{"type":"result","usage":{"input_tokens":12,"cache_read_input_tokens":5,"cache_creation_input_tokens":2,"output_tokens":3},"private":"do not retain"}')
  assert.equal(observer.snapshot().scope, 'invocation-final')
  assert.equal(observer.snapshot().values['usage.input_tokens'], 12)
  observer.onLine('{"type":"result","total_cost_usd":0.1}')
  assert.equal(observer.snapshot().values['usage.input_tokens'], undefined, 'a missing final counter cannot borrow the previous message counter')
  assert.equal(observer.snapshot().values.total_cost_usd, 0.1)
})

test('provider failures are reduced to safe diagnostic codes instead of persisted raw output', () => {
  assert.deepEqual(
    extractProviderFailure('claude', '{"is_error":true,"result":"Not logged in · Please run /login"}'),
    {
      code: 'not-authenticated',
      message: 'The local provider CLI is not authenticated in the filtered execution environment.'
    }
  )
  assert.equal(extractProviderFailure('codex', '', 'error: argument cannot be used with another flag').code, 'cli-incompatible')
  assert.equal(extractProviderFailure('codex', '{"type":"error","message":"401 Unauthorized: invalid bearer"}').code, 'not-authenticated')
  assert.equal(extractProviderFailure('claude', 'private arbitrary provider output').code, 'provider-failed')
  assert.doesNotMatch(extractProviderFailure('claude', 'private arbitrary provider output').message, /private/)
})

test('provider discovery resolves a PATH executable and probes only its version', async (t) => {
  if (process.platform === 'win32') return t.skip('POSIX executable fixture')
  const directory = await mkdtemp(join(tmpdir(), 'bth-provider-'))
  const executable = join(directory, 'codex')
  await writeFile(executable, '#!/bin/sh\nprintf "codex-fixture 1.2.3\\n"\n', 'utf8')
  await chmod(executable, 0o755)
  const env = { ...process.env, PATH: directory }
  const resolved = await resolveProviderExecutable('codex', { env })
  assert.equal(resolved.path, executable)
  const probe = await probeImplementationProvider('codex', { env, cwd: directory })
  assert.equal(probe.available, true)
  assert.equal(probe.version, 'codex-fixture 1.2.3')
})

test('real provider runner path resolves, spawns, and extracts usage from a fixture CLI', async (t) => {
  if (process.platform === 'win32') return t.skip('POSIX executable fixture')
  const directory = await mkdtemp(join(tmpdir(), 'bth-provider-run-'))
  const executable = join(directory, 'codex')
  await mkdir(join(directory, 'src'), { recursive: true })
  await writeFile(join(directory, 'src/users.js'), 'export const users = []\n', 'utf8')
  await writeFile(join(directory, 'src/other.js'), 'export const other = true\n', 'utf8')
  await writeFile(executable, [
    '#!/bin/sh',
    'printf \'%s\\n\' \'{"type":"item.started","item":{"id":"d1","type":"command_execution","command":"find src -type f","aggregated_output":"","exit_code":null,"status":"in_progress"}}\'',
    'printf \'%s\\n\' \'{"type":"item.completed","item":{"id":"d1","type":"command_execution","command":"find src -type f","aggregated_output":"src/other.js\\nsrc/users.js\\n","exit_code":0,"status":"completed"}}\'',
    'printf \'%s\\n\' \'{"type":"item.started","item":{"id":"1","type":"command_execution","command":"sed -n 1,80p src/users.js","aggregated_output":"","exit_code":null,"status":"in_progress"}}\'',
    'printf \'%s\\n\' \'{"type":"item.started","item":{"id":"v1","type":"command_execution","command":"./mvnw test","aggregated_output":"","exit_code":null,"status":"in_progress"}}\'',
    'printf \'%s\\n\' \'{"type":"item.completed","item":{"id":"2","type":"file_change","changes":[{"path":"src/users.js","kind":"update"}],"status":"completed"}}\'',
    'printf \'%s\\n\' \'{"type":"turn.completed","usage":{"input_tokens":7,"cached_input_tokens":3,"output_tokens":2}}\'',
    ''
  ].join('\n'), 'utf8')
  await chmod(executable, 0o755)
  const env = { ...process.env, PATH: directory }
  const result = await runImplementationProvider(
    {
      provider: 'codex', model: null, timeoutMs: 10_000,
      mode: 'fast', contextBudgetCharacters: null, maxBudgetUsd: null
    },
    {
      requestPath: './request.json', cwd: directory,
      profile: selectImplementationProfile({ mode: 'fast' }), env
    },
    { env, version: 'codex-fixture 1.2.3' }
  )
  assert.equal(result.process.exitCode, 0)
  assert.equal(result.metadata.provider, 'codex')
  assert.equal(result.metadata.usage.tokens.input, 7)
  assert.equal(result.metadata.usage.tokens.output, 2)
  assert.equal(result.metadata.usage.tokens.total, 9)
  assert.equal(result.metadata.usage.tokens.uncachedInput, 4)
  assert.deepEqual(result.metadata.activity.preWritePaths, ['src/users.js', 'src/other.js'])
  assert.deepEqual(result.metadata.activity.preWriteContentPaths, ['src/users.js'])
  assert.deepEqual(result.metadata.activity.preWriteDiscoveryPaths, ['src/other.js', 'src/users.js'])
  assert.deepEqual(result.metadata.activity.changedPaths, ['src/users.js'])
  assert.equal(result.metadata.activity.discoveryCommandCount, 1)
  assert.equal(result.metadata.activity.validationCommandCount, 1)
  assert.equal(result.metadata.usage.providerReported['usage.input_tokens'], 7)

  const direct = await runProviderPrompt(
    {
      provider: 'codex', model: null, timeoutMs: 10_000,
      mode: 'fast', contextBudgetCharacters: null, maxBudgetUsd: null
    },
    {
      prompt: 'Implement one bounded fixture task.', cwd: directory,
      profile: selectImplementationProfile({ mode: 'fast' }), env
    },
    { env, version: 'codex-fixture 1.2.3' }
  )
  assert.equal(direct.process.exitCode, 0)
  assert.equal(direct.metadata.usage.tokens.total, 9)
})

test('Claude stream events expose bounded pre-write activity and cache-aware usage', async (t) => {
  if (process.platform === 'win32') return t.skip('POSIX executable fixture')
  const directory = await mkdtemp(join(tmpdir(), 'bth-claude-provider-run-'))
  const executable = join(directory, 'claude')
  await mkdir(join(directory, 'src'), { recursive: true })
  await writeFile(join(directory, 'src/users.js'), 'export const users = []\n', 'utf8')
  await writeFile(executable, [
    '#!/bin/sh',
    'printf \'%s\\n\' \'{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"src/users.js"}}],"usage":{"input_tokens":12,"cache_read_input_tokens":5,"cache_creation_input_tokens":2,"output_tokens":3}}}\'',
    'printf \'%s\\n\' \'{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"src/users.js"}}]}}\'',
    'printf \'%s\\n\' \'{"type":"result","usage":{"input_tokens":12,"cache_read_input_tokens":5,"cache_creation_input_tokens":2,"output_tokens":3},"duration_ms":7,"num_turns":1,"total_cost_usd":0.01}\'',
    ''
  ].join('\n'), 'utf8')
  await chmod(executable, 0o755)
  const env = { ...process.env, PATH: directory }
  const result = await runProviderPrompt(
    {
      provider: 'claude', model: null, timeoutMs: 10_000,
      mode: 'fast', contextBudgetCharacters: null, maxBudgetUsd: 1
    },
    {
      prompt: 'Implement one bounded fixture task.', cwd: directory,
      profile: selectImplementationProfile({ mode: 'fast' }), env
    },
    { env, version: 'claude-fixture 1.0.0' }
  )

  assert.equal(result.process.exitCode, 0)
  assert.equal(result.metadata.usage.tokens.input, 19)
  assert.equal(result.metadata.usage.tokens.cachedInput, 5)
  assert.equal(result.metadata.usage.tokens.cacheCreationInput, 2)
  assert.equal(result.metadata.usage.tokens.uncachedInput, 12)
  assert.equal(result.metadata.usage.tokens.output, 3)
  assert.equal(result.metadata.usage.tokens.total, 22)
  assert.equal(result.metadata.usage.costUsd, 0.01)
  assert.equal(result.metadata.usage.scope, 'invocation-final')
  assert.deepEqual(result.metadata.activity.preWritePaths, ['src/users.js'])
  assert.deepEqual(result.metadata.activity.preWriteContentPaths, ['src/users.js'])
  assert.deepEqual(result.metadata.activity.preWriteDiscoveryPaths, [])
  assert.deepEqual(result.metadata.activity.changedPaths, ['src/users.js'])
  assert.equal(result.metadata.activity.readCommandCount, 1)
  assert.equal(result.metadata.activity.writeEventCount, 1)
})

test('provider discovery resolves npm-style Windows command shims', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bth-provider-win-'))
  const extensionless = join(directory, 'claude')
  const executable = join(directory, 'claude.cmd')
  await writeFile(extensionless, '#!/usr/bin/env node\n', 'utf8')
  await writeFile(executable, '@echo off\r\n', 'utf8')

  const resolved = await resolveProviderExecutable('claude', {
    env: { PATH: directory, PATHEXT: '.EXE;.CMD' },
    platform: 'win32'
  })

  assert.equal(resolved.path, executable)
  assert.equal(resolved.display, 'claude')
})
