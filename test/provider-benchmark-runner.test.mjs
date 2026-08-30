import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runPreparedComparisonCase } from '../src/evaluation/provider-benchmark-runner.mjs'
import { initializeGit } from '../test-support/git-project.mjs'

async function project(prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix))
  await mkdir(join(root, 'gradle/wrapper'), { recursive: true })
  await mkdir(join(root, 'src/main/java/example'), { recursive: true })
  await mkdir(join(root, 'src/test/java/example'), { recursive: true })
  await writeFile(join(root, 'build.gradle.kts'), 'plugins { java }\n')
  await writeFile(join(root, 'settings.gradle.kts'), 'rootProject.name = "fixture"\n')
  await writeFile(join(root, 'gradle/wrapper/gradle-wrapper.properties'), 'distributionUrl=https://example.invalid/gradle-8.14-bin.zip\n')
  await writeFile(join(root, 'src/main/java/example/ExistingService.java'), 'package example; class ExistingService {}\n')
  await writeFile(join(root, 'src/test/java/example/ExistingServiceTest.java'), 'package example; class ExistingServiceTest {}\n')
  await writeFile(join(root, '.gitignore'), 'build/\n')
  const wrapper = join(root, 'gradlew')
  await writeFile(wrapper, [
    '#!/bin/sh',
    'mkdir -p build/test-results/test',
    'printf \'%s\\n\' \'<testsuite tests="1"><testcase name="verified"/></testsuite>\' > build/test-results/test/TEST-fixture.xml',
    ''
  ].join('\n'))
  await chmod(wrapper, 0o755)
  initializeGit(root)
  const addIgnore = spawnSync('git', ['add', '-f', '--', '.gitignore'], { cwd: root, encoding: 'utf8' })
  assert.equal(addIgnore.status, 0, addIgnore.stderr)
  const amend = spawnSync('git', ['-c', 'user.name=BTH Test', '-c', 'user.email=bth@example.invalid', 'commit', '--amend', '--no-edit', '-q'], { cwd: root, encoding: 'utf8' })
  assert.equal(amend.status, 0, amend.stderr)
  return root
}

const task = {
  id: 'fixture-feature',
  requirement: 'Add one source-bound fixture feature with deterministic verification.',
  baseSha: 'a'.repeat(40),
  targetSha: 'b'.repeat(40),
  goldPaths: ['src/main/java/example/Feature.java']
}

const repositoryConfig = {
  id: 'fixture',
  buildSystem: 'gradle',
  allowedPrefixes: ['src/'],
  setupCommand: ['./gradlew', 'dependencies'],
  tasks: [{ id: task.id, decisions: { modules: ['root'], excludedModules: [], databaseImpact: 'none', apiImpact: 'none' } }]
}

function successfulRun(provider, activity = null) {
  return {
    process: {
      exitCode: 0, signal: null, timedOut: false, stdioDrainTimedOut: false, durationMs: 5,
      stdout: { sha256: 'a'.repeat(64), bytes: 2, tail: '{}' },
      stderr: { sha256: 'b'.repeat(64), bytes: 0, tail: '' }
    },
    metadata: {
      kind: 'provider', provider, version: 'fixture', failure: null,
      usage: { provider, tokens: { input: 10, uncachedInput: null, output: 5, cachedInput: null, reasoningOutput: null, total: 15 }, costUsd: null, durationMs: 5, turns: 1 },
      activity
    }
  }
}

async function fixtureProvider(adapter, input) {
  await writeFile(join(input.cwd, 'src/main/java/example/Feature.java'), 'package example; class Feature {}\n')
  return successfulRun(adapter.provider)
}

test('prepared BTH lane seals one isolated verified change and records normalized metrics', async () => {
  const root = await project('bth-comparison-harness-')
  const result = await runPreparedComparisonCase(root, task, repositoryConfig, {
    lane: 'bth', provider: 'codex', mode: 'balanced', model: null,
    maxAttempts: 1, timeoutMs: 30_000, maxBudgetUsd: null
  }, {
    providerProbe: async () => ({ available: true, version: 'fixture' }),
    bthProviderRunner: fixtureProvider,
    cleanupBthWorkspace: true
  })

  assert.equal(result.score.verificationSuccessAt1, true, JSON.stringify(result, null, 2))
  assert.equal(result.score.successAt1, null)
  assert.equal(result.score.verificationConfirmed, true)
  assert.deepEqual(result.score.changedPaths, task.goldPaths)
  assert.equal(result.score.usage.tokens.total, 15)
  assert.ok(result.observation.evidence.request.bytes > 0)
  assert.equal(result.observation.evidence.workspaceRetainedForAudit, false)
})

test('prepared direct lane uses the same verification contract after provider execution', async () => {
  const root = await project('bth-comparison-direct-')
  const result = await runPreparedComparisonCase(root, task, repositoryConfig, {
    lane: 'direct', provider: 'claude', mode: 'balanced', model: null,
    maxAttempts: 1, timeoutMs: 30_000, maxBudgetUsd: 1
  }, { directProviderRunner: fixtureProvider })

  assert.equal(result.score.verificationSuccessAt1, true, JSON.stringify(result, null, 2))
  assert.equal(result.score.successAt1, null)
  assert.deepEqual(result.score.changedPaths, task.goldPaths)
  assert.equal(result.score.ruleViolations.length, 0)
  assert.equal(result.score.impactLocalization, null)
  assert.equal(result.score.outcomeLocalization.recallAt5, 1)
})

test('prepared direct lane elapsed time includes evaluator-owned verification', async () => {
  const root = await project('bth-comparison-direct-elapsed-')
  const verificationDelayMs = 80
  const result = await runPreparedComparisonCase(root, task, repositoryConfig, {
    lane: 'direct', provider: 'codex', mode: 'balanced', model: null,
    maxAttempts: 1, timeoutMs: 30_000, maxBudgetUsd: null
  }, {
    directProviderRunner: fixtureProvider,
    projectChecker: async () => {
      await new Promise((resolve) => setTimeout(resolve, verificationDelayMs))
      return { confirmed: true, result: { failure: null } }
    }
  })

  assert.equal(result.score.verificationSuccessAt1, true, JSON.stringify(result, null, 2))
  assert.equal(result.score.successAt1, null)
  assert.ok(result.score.elapsedMs >= verificationDelayMs)
})

test('provider-owned validation is a measured rule violation instead of hidden duplicate work', async () => {
  const root = await project('bth-comparison-provider-validation-')
  const provider = async (adapter, input) => {
    await writeFile(join(input.cwd, 'src/main/java/example/Feature.java'), 'package example; class Feature {}\n')
    return successfulRun(adapter.provider, {
      schemaVersion: 1,
      provider: adapter.provider,
      validationCommandCount: 1,
      preWritePaths: ['src/main/java/example/ExistingService.java'],
      changedPaths: ['src/main/java/example/Feature.java']
    })
  }
  const result = await runPreparedComparisonCase(root, task, repositoryConfig, {
    lane: 'direct', provider: 'codex', mode: 'balanced', model: null,
    maxAttempts: 1, timeoutMs: 30_000, maxBudgetUsd: null
  }, { directProviderRunner: provider })

  assert.equal(result.score.verificationConfirmed, false)
  assert.equal(result.score.successAt1, false)
  assert.deepEqual(result.score.ruleViolations, ['provider-ran-evaluator-owned-validation'])
  assert.equal(result.score.impactLocalization.recallAt5, 0)
})

test('both lanes invoke independent acceptance on the candidate, before BTH workspace cleanup', async () => {
  for (const lane of ['bth', 'direct']) {
    const root = await project('bth-comparison-acceptance-')
    let observedRoot
    const result = await runPreparedComparisonCase(root, task, repositoryConfig, {
      lane, provider: 'codex', mode: 'balanced', model: null, maxAttempts: 1, timeoutMs: 30_000, maxBudgetUsd: null
    }, {
      providerProbe: async () => ({ available: true, version: 'fixture' }),
      bthProviderRunner: fixtureProvider, directProviderRunner: fixtureProvider,
      cleanupBthWorkspace: true,
      acceptanceEvaluator: async ({ candidateRoot }) => {
        observedRoot = candidateRoot
        assert.match(await readFile(join(candidateRoot, task.goldPaths[0]), 'utf8'), /class Feature/)
        return { controlsConfirmed: true, candidatePassed: true }
      }
    })
    assert.equal(result.score.successAt1, true, lane)
    assert.equal(result.score.acceptanceConfirmed, true)
    if (lane === 'bth') {
      assert.notEqual(observedRoot, root)
      await assert.rejects(readFile(join(observedRoot, task.goldPaths[0])), /ENOENT/)
    } else assert.equal(observedRoot, root)
  }
})

test('an evaluator exception preserves implementation evidence but leaves task success unknown', async () => {
  const root = await project('bth-comparison-acceptance-failure-')
  const result = await runPreparedComparisonCase(root, task, repositoryConfig, {
    lane: 'direct', provider: 'codex', mode: 'balanced', model: null, maxAttempts: 1, timeoutMs: 30_000, maxBudgetUsd: null
  }, { directProviderRunner: fixtureProvider, acceptanceEvaluator: async () => { throw new Error('private diagnostic') } })
  assert.equal(result.score.verificationSuccessAt1, true)
  assert.equal(result.score.successAt1, null)
  assert.equal(result.observation.acceptance.reason, 'oracle-evaluation-failed')
  assert.doesNotMatch(JSON.stringify(result), /private diagnostic/)
})
