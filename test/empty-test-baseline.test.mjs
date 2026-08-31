import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initProject } from '../src/init-project.mjs'
import { canAttemptBaseline, inspectEmptyTestBaseline } from '../src/evaluation/empty-test-baseline.mjs'
import { initializeGit, runGit } from '../test-support/git-project.mjs'
import { createIsolatedGitSnapshot } from '../src/evaluation/isolated-git-snapshot.mjs'

const empty = { confirmed: false, result: { tests: { tests: 0, executed: 0, failures: 0, errors: 0, skipped: 0 } } }
const execution = (text = '[]') => ({ exitCode: 0, signal: null, timedOut: false, stdioDrainTimedOut: false, durationMs: 1,
  stdout: { tail: text, bytes: Buffer.byteLength(text), sha256: 'a'.repeat(64) }, stderr: { tail: '', bytes: 0, sha256: 'b'.repeat(64) } })

test('generated verification survives commit and isolated checkout without losing Windows wrapper bytes', async t => {
  const root = await fixture(t, true)
  runGit(root, ['config', 'core.autocrlf', 'input'])
  runGit(root, ['add', '-f', '--', '.backend-harness/.gitignore'])
  runGit(root, ['add', '--', '.backend-harness'])
  runGit(root, ['commit', '-qm', 'generated verification'])
  const directory = await mkdtemp(join(tmpdir(), 'bth-generated-checkout-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const copy = join(directory, 'project')
  await createIsolatedGitSnapshot(root, runGit(root, ['rev-parse', 'HEAD']), copy)
  const paths = ['bin/verify-portable', 'bin/verify-portable.mjs', 'bin/verify-portable.cmd', '.gitattributes', 'verification.json']
  const windowsCopy = join(directory, 'windows-checkout')
  runGit(directory, ['-c', 'core.autocrlf=true', 'clone', '--quiet', '--local', '--no-hardlinks', root, windowsCopy])
  for (const name of paths) {
    const expected = await readFile(join(root, '.backend-harness', name))
    assert.deepEqual(await readFile(join(copy, '.backend-harness', name)), expected, name)
    assert.deepEqual(await readFile(join(windowsCopy, '.backend-harness', name)), expected, 'autocrlf=true ' + name)
  }
  const config = JSON.parse(await readFile(join(copy, '.backend-harness/verification.json')))
  assert.ok(config.gates[0].inputs.includes('.backend-harness/.gitattributes'))
  await mkdir(join(copy, 'node_modules/jest/bin'), { recursive: true })
  await writeFile(join(copy, 'node_modules/jest/bin/jest.js'), '// fixture process runner\n')
  const result = await inspectEmptyTestBaseline(copy, empty, { processRunner: async () => execution() })
  assert.equal(result.status, 'no-tests-discovered')
  assert.equal(result.baselinePassed, false)
})

async function fixture(t, moduleSearch = false) {
  const root = await mkdtemp(join(tmpdir(), 'bth-empty-baseline-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'src/answer.js'), 'module.exports = 42\n')
  await writeFile(join(root, '.gitignore'), 'node_modules/\n')
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'first-test', devDependencies: { jest: '29.7.0' }, scripts: { test: 'jest' },
    ...(moduleSearch ? { jest: { rootDir: 'src', transform: { '^.+\\.ts$': 'ts-jest' } } } : {}) }))
  if (moduleSearch) await writeFile(join(root, 'tsconfig.json'), '{"compilerOptions":{"baseUrl":"src"}}')
  await writeFile(join(root, 'package-lock.json'), '{"lockfileVersion":3,"packages":{"":{}}}')
  initializeGit(root, { forcePaths: ['.gitignore'] })
  await initProject(root)
  await mkdir(join(root, 'node_modules/jest/bin'), { recursive: true })
  await writeFile(join(root, 'node_modules/jest/bin/jest.js'), '// injected execution fixture\n')
  return root
}

test('empty baseline is permission to try the first tests, not a passing verdict', async t => {
  const root = await fixture(t)
  const result = await inspectEmptyTestBaseline(root, empty, { processRunner: async input => {
    assert.equal(input.program, process.execPath)
    assert.match(input.args[0].replaceAll('\\', '/'), /node_modules\/jest\/bin\/jest.js$/)
    assert.deepEqual(input.args.slice(-4), ['--runInBand', '--listTests', '--json', '--no-cache'])
    assert.equal(input.cwd, root)
    return execution()
  } })
  assert.equal(result.status, 'no-tests-discovered')
  assert.equal(result.baselinePassed, false)
  assert.equal(result.requiredFinalMinimumTests, 1)
  assert.equal(canAttemptBaseline({ confirmed: false, emptyTestBaseline: result }), true)
  assert.equal(canAttemptBaseline({ confirmed: true }), true)
  for (const changed of [{ sourceStable: false }, { discoveredFiles: 1 }, { requiredFinalMinimumTests: 0 }, { status: 'unconfirmed' }]) {
    assert.equal(canAttemptBaseline({ emptyTestBaseline: { ...result, ...changed } }), false)
  }
})

test('empty enumeration uses the same declared module path as the generated final gate', async t => {
  const root = await fixture(t, true)
  let called = false
  const result = await inspectEmptyTestBaseline(root, empty, { processRunner: async input => {
    called = true
    assert.ok(input.args.includes('--modulePaths=' + join(input.cwd, 'src')))
    return execution()
  } })
  assert.equal(called, true)
  assert.equal(result.status, 'no-tests-discovered')
})

test('existing failed or skipped tests and missing structured evidence never open the first-test path', async t => {
  const root = await fixture(t)
  for (const checked of [null, { confirmed: false }, { ...empty, confirmed: true }, ...['tests', 'executed', 'failures', 'errors', 'skipped'].map(key => ({ ...empty, result: { tests: { ...empty.result.tests, [key]: 1 } } }))]) {
    assert.equal((await inspectEmptyTestBaseline(root, checked, { processRunner: () => assert.fail('must not enumerate') })).status, 'unconfirmed')
  }
})

test('listing must be empty complete JSON, successful, source-stable, and within bounds', async t => {
  const root = await fixture(t)
  const outputs = [execution('not JSON'), execution('{}'), execution('["src/a.test.js"]'), { ...execution(), exitCode: 1 },
    { ...execution(), signal: 'SIGTERM' }, { ...execution(), timedOut: true }, { ...execution(), stdioDrainTimedOut: true },
    { ...execution(), stdout: { ...execution().stdout, bytes: 65537 } }, { ...execution(), stdout: { ...execution().stdout, bytes: 3 } }]
  for (const output of outputs) assert.equal((await inspectEmptyTestBaseline(root, empty, { processRunner: async () => output })).status, 'unconfirmed')
  const modified = await inspectEmptyTestBaseline(root, empty, { processRunner: async () => {
    await writeFile(join(root, 'src/answer.js'), 'changed during listing\n')
    return execution()
  } })
  assert.equal(modified.sourceStable, false)
  assert.equal(modified.status, 'unconfirmed')
})

test('missing dependencies and modified verification contracts cannot qualify', async t => {
  const root = await fixture(t)
  const configPath = join(root, '.backend-harness/verification.json')
  const original = await readFile(configPath, 'utf8')
  const config = JSON.parse(original)
  config.gates[0].result.minimumTests = 2
  await writeFile(configPath, JSON.stringify(config))
  const options = { processRunner: () => assert.fail('custom verification must not enumerate') }
  assert.equal((await inspectEmptyTestBaseline(root, empty, options)).status, 'unconfirmed')
  await writeFile(configPath, original)
  const preparationPath = join(root, '.backend-harness/implementation.json')
  const preparation = await readFile(preparationPath, 'utf8')
  await writeFile(preparationPath, JSON.stringify({ ...JSON.parse(preparation), workspacePreparation: null }))
  assert.equal((await inspectEmptyTestBaseline(root, empty, options)).status, 'unconfirmed')
  await writeFile(preparationPath, preparation)
  // Discover the generated runner path from the declared inputs, not a second
  // hard-coded contract about its name.
  const inputPath = config.gates[0].inputs.find(path => path.endsWith('verify-portable.mjs'))
  const runner = join(root, inputPath)
  const originalRunner = await readFile(runner, 'utf8')
  await writeFile(runner, originalRunner + '\n// changed contract\n')
  assert.equal((await inspectEmptyTestBaseline(root, empty, options)).status, 'unconfirmed')
  await writeFile(runner, originalRunner)
  await rm(join(root, 'node_modules'), { recursive: true })
  assert.equal((await inspectEmptyTestBaseline(root, empty, options)).status, 'unconfirmed')
})
