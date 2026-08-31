import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runPreparedComparisonCase } from '../src/evaluation/provider-benchmark-runner.mjs'
import { initializeGit } from '../test-support/git-project.mjs'
import { initProject } from '../src/init-project.mjs'
import { applyProjectFixture } from '../src/evaluation/project-fixture.mjs'
import { configureImplementationProvider } from '../src/config/implementation-setup.mjs'

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

async function preparedFixture(root) {
  const fixtures = await mkdtemp(join(tmpdir(), 'bth-comparison-fixtures-'))
  await mkdir(join(fixtures, 'fixtures'))
  const wrapper = await readFile(join(root, 'gradlew'), 'utf8')
  const protectedPath = 'src/test/java/example/ExistingServiceTest.java'
  const before = await readFile(join(root, protectedPath), 'utf8')
  const fixed = before + '// Evaluator-owned environment fix.\n'
  await writeFile(join(fixtures, 'fixtures/wrapper'), wrapper)
  await writeFile(join(fixtures, 'fixtures/test'), fixed)
  const hash = text => createHash('sha256').update(text).digest('hex')
  const command = '.backend-harness/bin/verify-fixture'
  const projectFixture = { files: [
    { path: command, fixture: 'fixtures/wrapper', sha256: hash(wrapper), expectedSha256: null, executable: true },
    { path: protectedPath, fixture: 'fixtures/test', sha256: hash(fixed), expectedSha256: hash(before) }
  ], workspacePreparation: null, verification: { schemaVersion: 1, gates: [{ id: 'tests', required: true, command: ['./' + command],
    inputs: [command, protectedPath, 'build.gradle.kts'], timeoutMs: 10000,
    result: { type: 'junit', reports: ['build/test-results/test/*.xml'], minimumTests: 1 } }] } }
  await initProject(root, { preferredSystem: 'gradle' })
  await applyProjectFixture(root, fixtures, projectFixture)
  const configuration = structuredClone(repositoryConfig)
  configuration.tasks[0].projectFixture = projectFixture
  const stage = spawnSync('git', ['add', '-f', '--', '.backend-harness/.gitignore', command, protectedPath], { cwd: root, encoding: 'utf8' })
  assert.equal(stage.status, 0, stage.stderr)
  const add = spawnSync('git', ['add', '--', '.backend-harness'], { cwd: root, encoding: 'utf8' })
  assert.equal(add.status, 0, add.stderr)
  const commit = spawnSync('git', ['-c', 'user.name=BTH Test', '-c', 'user.email=bth@example.invalid', 'commit', '-qm', 'common baseline'], { cwd: root, encoding: 'utf8' })
  assert.equal(commit.status, 0, commit.stderr)
  return { configuration, protectedPath }
}

test('both providers lanes retain the same immutable prepared baseline during normal verification', async () => {
  for (const lane of ['bth', 'direct']) {
    const root = await project('bth-comparison-prepared-fixture-')
    const { configuration, protectedPath } = await preparedFixture(root)
    const before = await readFile(join(root, '.backend-harness/verification.json'), 'utf8')
    const provider = async (adapter, input) => {
      assert.match(await readFile(join(input.cwd, protectedPath), 'utf8'), /Evaluator-owned/)
      assert.equal(await readFile(join(input.cwd, '.backend-harness/verification.json'), 'utf8'), before)
      return fixtureProvider(adapter, input)
    }
    const result = await runPreparedComparisonCase(root, task, configuration, {
      lane, provider: 'codex', mode: 'balanced', model: null, maxAttempts: 1, timeoutMs: 30000, maxBudgetUsd: null
    }, { providerProbe: async () => ({ available: true, version: 'fixture' }), bthProviderRunner: provider,
      directProviderRunner: provider, cleanupBthWorkspace: true })
    assert.equal(result.score.verificationSuccessAt1, true, JSON.stringify(result))
    assert.deepEqual(result.score.changedPaths, task.goldPaths)
  }
})

test('a missing protected fixture stops both lanes before calling any provider', async () => {
  for (const lane of ['bth', 'direct']) {
    const root = await project('bth-comparison-missing-fixture-')
    const { configuration, protectedPath } = await preparedFixture(root)
    await writeFile(join(root, protectedPath), 'tampered\n')
    const hidden = spawnSync('git', ['update-index', '--assume-unchanged', protectedPath], { cwd: root })
    assert.equal(hidden.status, 0)
    let calls = 0
    const provider = async () => { calls++; return successfulRun('codex') }
    await assert.rejects(runPreparedComparisonCase(root, task, configuration, {
      lane, provider: 'codex', mode: 'balanced', model: null, maxAttempts: 1, timeoutMs: 30000, maxBudgetUsd: null
    }, { bthProviderRunner: provider, directProviderRunner: provider }), /fixture is missing or changed/)
    assert.equal(calls, 0)
  }
})

test('both lanes reject provider edits to evaluator tests even inside allowed source paths', async () => {
  for (const lane of ['bth', 'direct']) {
    const root = await project('bth-comparison-fixture-tamper-')
    const { configuration, protectedPath } = await preparedFixture(root)
    const provider = async (adapter, input) => {
      await writeFile(join(input.cwd, protectedPath), 'compromised\n')
      // Direct integrity must not depend on Git's path list.
      if (lane === 'direct') assert.equal(spawnSync('git', ['update-index', '--assume-unchanged', protectedPath], { cwd: input.cwd }).status, 0)
      return fixtureProvider(adapter, input)
    }
    const result = await runPreparedComparisonCase(root, task, configuration, {
      lane, provider: 'codex', mode: 'balanced', model: null, maxAttempts: 1, timeoutMs: 30000, maxBudgetUsd: null
    }, { providerProbe: async () => ({ available: true, version: 'fixture' }), bthProviderRunner: provider,
      directProviderRunner: provider, cleanupBthWorkspace: true })
    assert.equal(result.score.verificationConfirmed, false, JSON.stringify(result))
    assert.ok(result.score.ruleViolations.length > 0, JSON.stringify(result))
    if (lane === 'direct') assert.ok(result.score.ruleViolations.includes('protected-project-fixture-change'))
  }
})

test('an already committed identical provider contract is not an empty-commit failure', async () => {
  const root = await project('bth-comparison-no-empty-commit-')
  await initProject(root, { preferredSystem: 'gradle' })
  await configureImplementationProvider(root, 'codex', { force: true, mode: 'balanced', model: null,
    allowedPrefixes: repositoryConfig.allowedPrefixes, maxChangedFiles: 100, maxDiffBytes: 2 * 1024 * 1024,
    maxAttempts: 1, timeoutMs: 30000, maxBudgetUsd: null })
  assert.equal(spawnSync('git', ['add', '-f', '--', '.backend-harness/.gitignore'], { cwd: root }).status, 0)
  assert.equal(spawnSync('git', ['add', '--', '.backend-harness'], { cwd: root }).status, 0)
  assert.equal(spawnSync('git', ['commit', '-qm', 'already configured'], { cwd: root }).status, 0)
  const result = await runPreparedComparisonCase(root, task, repositoryConfig, {
    lane: 'bth', provider: 'codex', mode: 'balanced', model: null, maxAttempts: 1, timeoutMs: 30000, maxBudgetUsd: null
  }, { providerProbe: async () => ({ available: true, version: 'fixture' }), bthProviderRunner: fixtureProvider, cleanupBthWorkspace: true })
  assert.equal(result.score.verificationSuccessAt1, true, JSON.stringify(result))
})

test('direct lane protects transitive declared inputs before and after verification, not just overlay files', async () => {
  for (const phase of ['provider', 'verification']) {
    const root = await project('bth-comparison-transitive-input-')
    const { configuration } = await preparedFixture(root)
    const tamper = async () => {
      await writeFile(join(root, 'build.gradle.kts'), 'compromised\n')
      assert.equal(spawnSync('git', ['update-index', '--assume-unchanged', 'build.gradle.kts'], { cwd: root }).status, 0)
    }
    const result = await runPreparedComparisonCase(root, task, configuration, {
      lane: 'direct', provider: 'codex', mode: 'balanced', model: null, maxAttempts: 1, timeoutMs: 30000, maxBudgetUsd: null
    }, {
      directProviderRunner: async (adapter, input) => {
        if (phase === 'provider') await tamper()
        return fixtureProvider(adapter, input)
      },
      projectChecker: async () => {
        if (phase === 'verification') await tamper()
        return { confirmed: true, result: { failure: null } }
      }
    })
    assert.equal(result.score.verificationConfirmed, false, phase)
    assert.ok(result.score.ruleViolations.includes('protected-verification-input-change'), JSON.stringify(result))
  }
})

test('a missing transitive verifier input refuses a direct provider call even if Git hides its deletion', async () => {
  const root = await project('bth-comparison-missing-transitive-')
  const { configuration } = await preparedFixture(root)
  await rm(join(root, 'build.gradle.kts'))
  assert.equal(spawnSync('git', ['update-index', '--assume-unchanged', 'build.gradle.kts'], { cwd: root }).status, 0)
  let called = false
  await assert.rejects(runPreparedComparisonCase(root, task, configuration, {
    lane: 'direct', provider: 'codex', mode: 'balanced', model: null, maxAttempts: 1, timeoutMs: 30000, maxBudgetUsd: null
  }, { directProviderRunner: async () => { called = true; return successfulRun('codex') } }), /verification input is missing/)
  assert.equal(called, false)
})

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
  assert.ok(result.observation.evidence.request.knowledgeDocumentCount > 0)
  assert.equal(result.observation.evidence.workspaceRetainedForAudit, false)
  assert.equal(result.observation.evidence.implementationDiagnosis.failure, null)
  assert.equal(result.observation.evidence.implementationDiagnosis.attemptOutcomes[0].outcome, 'passed')
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

test('direct lane retains the same bounded gate failure evidence without promoting verification or exporting assertion bodies', async () => {
  const root = await project('bth-comparison-direct-diagnostic-')
  const result = await runPreparedComparisonCase(root, task, repositoryConfig, {
    lane: 'direct', provider: 'codex', mode: 'balanced', model: null, maxAttempts: 1, timeoutMs: 30_000, maxBudgetUsd: null
  }, {
    directProviderRunner: fixtureProvider,
    projectChecker: async () => ({ confirmed: false, result: {
      reason: 'required_gate_failed', tests: { tests: 1, executed: 1, failures: 1, errors: 0, skipped: 0 },
      gates: [{ id: 'tests', required: true, outcome: 'failed', reason: 'process_failed', process: { exitCode: 1, stderr: 'private-output' }, result: { reason: 'tests_failed', failedTests: [{ className: 'Mapping', name: 'maps saved value', message: 'private-assertion' }] } }]
    } })
  })
  assert.equal(result.score.successAt1, false)
  assert.equal(result.observation.evidence.verificationFailureCode, 'required_gate_failed')
  assert.equal(result.observation.evidence.verificationDiagnostic.gates[0].structuredReason, 'tests_failed')
  assert.equal(result.observation.evidence.verificationDiagnostic.gates[0].failedTests[0].name, 'maps saved value')
  assert.doesNotMatch(JSON.stringify(result), /private-output|private-assertion/)
})
