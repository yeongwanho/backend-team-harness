import test from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initProject } from '../src/init-project.mjs'
import { configureImplementationProvider } from '../src/config/implementation-setup.mjs'
import { runWork } from '../src/runtime/work-orchestrator.mjs'
import { resetImplementation } from '../src/runtime/implementation-orchestrator.mjs'
import { initializeGit, runGit } from '../test-support/git-project.mjs'
import { jestDocument } from '../test-support/jest-document.mjs'

const result = (exitCode = 0) => ({ exitCode, signal: null, timedOut: false, stdioDrainTimedOut: false, durationMs: 1, stdout: { bytes: 0, sha256: 'a'.repeat(64), tail: '' }, stderr: { bytes: 0, sha256: 'b'.repeat(64), tail: exitCode ? 'ENOTCACHED' : '' } })
const input = { taskId: 'FIRST-TEST', actor: 'developer', requirement: 'Return 42 from the answer helper and add its first focused test.', decisions: { modules: ['root'], databaseImpact: 'none', apiImpact: 'compatible' } }

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'bth-first-test-work-'))
  t.after(async () => {
    try { await resetImplementation(root, input.taskId, { actor: 'fixture', discardWorkspace: true }) } catch { /* no workspace allocated */ }
    await rm(root, { recursive: true, force: true })
  })
  await mkdir(join(root, 'src'))
  await writeFile(join(root, '.gitignore'), 'node_modules/\n')
  await writeFile(join(root, 'src/answer.mjs'), 'export const answer = 0\n')
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'first-test', scripts: { test: 'jest' }, devDependencies: { jest: '29.7.0' } }))
  await writeFile(join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/jest': { resolved: 'https://registry.npmjs.org/jest/-/jest-29.7.0.tgz', integrity: 'sha512-' + Buffer.alloc(64).toString('base64') } } }))
  initializeGit(root, { forcePaths: ['.gitignore'] })
  runGit(root, ['config', 'core.autocrlf', 'input'])
  await initProject(root)
  await configureImplementationProvider(root, 'codex', { maxAttempts: 1, allowedPrefixes: ['src/'] })
  initializeGit(root, { forcePaths: ['.gitignore', '.backend-harness/.gitignore'] })
  return root
}

async function syntheticJest(input) {
  await mkdir(join(input.cwd, 'node_modules/jest/bin'), { recursive: true })
  await writeFile(join(input.cwd, 'node_modules/jest/package.json'), '{"type":"module"}')
  await writeFile(join(input.cwd, 'node_modules/jest/bin/jest.js'), [
    "import { writeFileSync, existsSync, readFileSync } from 'node:fs'",
    "const output = process.argv.find(value => value.startsWith('--outputFile=')).slice(13)",
    "import { appendFileSync } from 'node:fs'",
    "appendFileSync('node_modules/jest/invocations.txt', 'run\\n')",
    "const tests = existsSync('src/answer.spec.mjs')",
    'const document = tests ? ' + JSON.stringify(jestDocument()) + ' : ' + JSON.stringify(jestDocument([])),
    'writeFileSync(output, JSON.stringify(document))'
  ].join('\n'))
  return result()
}

function options(preparationRunner, providerRunner) {
  return { approve: true, run: true, allowWrite: true, allowNetwork: true, preparationRunner, providerRunner,
    providerProbe: async () => ({ available: true, version: 'synthetic-boundary-fixture' }) }
}

test('first-test work spends no provider attempt on preparation failure and resumes the same approved task', async (t) => {
  const root = await fixture(t)
  let calls = 0
  const provider = async (_adapter, invocation) => {
    calls++
    const request = JSON.parse(await readFile(join(invocation.cwd, invocation.requestPath), 'utf8'))
    assert.equal(request.verification.focusedRegressionTestsRequired, true)
    assert.equal(request.verification.executionOwner, 'harness')
    assert.deepEqual(request.verification.requiredGates, [{ id: 'tests', resultType: 'junit', minimumExecutedTests: 1 }])
    await access(join(invocation.cwd, 'node_modules/jest/bin/jest.js'))
    await writeFile(join(invocation.cwd, 'src/answer.mjs'), 'export const answer = 42\n')
    await writeFile(join(invocation.cwd, 'src/answer.spec.mjs'), '// synthetic structured-result fixture\n')
    return { process: result(), metadata: { kind: 'provider', provider: 'codex', usage: {} } }
  }
  const failed = await runWork(root, input, options(async () => result(1), provider))
  assert.equal(failed.status, 'implementation-failed')
  assert.equal(failed.implementation.record.preparation.failureCode, 'offline-dependency-cache-incomplete')
  assert.equal(failed.implementation.record.preparation.sourceStable, true)
  assert.equal(failed.implementation.record.attempts.length, 0)
  assert.equal(calls, 0)
  const status = await runWork(root, input)
  assert.equal(status.status, 'implementation-in-progress')
  const resumed = await runWork(root, input, options(syntheticJest, provider))
  assert.equal(resumed.status, 'implementation-passed', JSON.stringify(resumed.implementation.record))
  assert.equal(resumed.approval.applied, false)
  assert.equal(resumed.implementation.record.preparation.status, 'passed')
  assert.equal(resumed.implementation.record.attempts.length, 1)
  assert.equal(resumed.implementation.record.verification.tests.executed, 1)
  assert.equal(resumed.implementation.record.attempts[0].feedback, null, 'identical feedback must not duplicate the full gate')
  assert.equal(await readFile(join(resumed.implementation.record.workspace, 'node_modules/jest/invocations.txt'), 'utf8'), 'run\n')
  assert.equal(calls, 1)
  assert.equal(await readFile(join(root, 'src/answer.mjs'), 'utf8'), 'export const answer = 0\n')
  await assert.rejects(access(join(root, 'node_modules')), { code: 'ENOENT' })
})

test('preparation source changes stop the provider and require resetting the tainted workspace', async (t) => {
  const root = await fixture(t)
  const runOptions = options(async invocation => {
    await writeFile(join(invocation.cwd, 'src/answer.mjs'), 'changed by preparation\n')
    return result()
  }, async () => assert.fail('provider must not run'))
  const failed = await runWork(root, input, runOptions)
  assert.equal(failed.implementation.record.preparation.failureCode, 'workspace-preparation-source-changed')
  assert.equal(failed.implementation.record.attempts.length, 0)
  await assert.rejects(runWork(root, input, runOptions), /Reset the tainted workspace/)
})

test('first-test workflow still fails final verification when no executable test is supplied', async (t) => {
  const root = await fixture(t)
  const completed = await runWork(root, input, options(syntheticJest, async (_adapter, invocation) => {
    await writeFile(join(invocation.cwd, 'src/answer.mjs'), 'export const answer = 42\n')
    return { process: result(), metadata: { kind: 'provider', provider: 'codex', usage: {} } }
  }))
  assert.equal(completed.status, 'implementation-failed')
  assert.equal(completed.implementation.record.preparation.status, 'passed')
  assert.equal(completed.implementation.record.verification.confirmed, false)
  assert.equal(completed.implementation.record.verification.tests?.executed, 0, JSON.stringify(completed.implementation.record.verification))
})
