import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildProviderInvocation,
  extractProviderFailure,
  extractProviderUsage,
  normalizeProviderUsage,
  probeImplementationProvider,
  resolveProviderExecutable,
  runImplementationProvider,
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
  assert.match(codex.args.at(-1), /naming, layering, DTO\/error, transaction, persistence, and test patterns/)
  assert.match(codex.args.at(-1), /do not guess/)

  const claude = buildProviderInvocation({ provider: 'claude', model: 'sonnet', maxBudgetUsd: 1.5 }, executable, './request.json', profile)
  assert.ok(claude.args.includes('acceptEdits'))
  assert.ok(claude.args.includes('Read,Edit,Write,Glob,Grep'))
  assert.ok(claude.args.includes('--max-budget-usd'))
  assert.equal(claude.args.some((entry) => entry.includes('bypassPermissions')), false)
  assert.equal(claude.args.some((entry) => entry.includes('dangerously')), false)
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
    total_cost_usd: 0.012,
    duration_ms: 900,
    num_turns: 2
  }, 1000)
  assert.deepEqual(claude.tokens, {
    input: 120, output: 34, cachedInput: 50, reasoningOutput: null, total: 154
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
  assert.equal(codex.tokens.reasoningOutput, 1)
  assert.equal(codex.durationMs, 321)
  assert.equal(codex.costUsd, null)
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
  await writeFile(executable, '#!/bin/sh\nprintf \'%s\\n\' \'{"type":"turn.completed","usage":{"input_tokens":7,"output_tokens":2}}\'\n', 'utf8')
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
  assert.equal(result.metadata.usage.providerReported['usage.input_tokens'], 7)
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
