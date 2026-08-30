import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareWorkspaceDependencies, validateOfflineNpmLock } from '../src/core/workspace-preparation.mjs'

const config = { kind: 'npm-ci-offline', projectPath: '.', timeoutMs: 1000 }
const paths = ['package.json', 'package-lock.json']
const lock = () => ({ lockfileVersion: 3, packages: { '': {}, 'node_modules/example': { version: '1.0.0', resolved: 'https://registry.npmjs.org/example/-/example-1.0.0.tgz', integrity: 'sha512-' + Buffer.alloc(64).toString('base64') } } })
const processResult = (code = 0) => ({ exitCode: code, signal: null, timedOut: false, stdioDrainTimedOut: false, durationMs: 10, stdout: { bytes: 0, sha256: 'a'.repeat(64), tail: '' }, stderr: { bytes: 5, sha256: 'b'.repeat(64), tail: code ? 'ENOTCACHED synthetic secret' : '' } })

async function fixture(t, prefix = '') {
  const root = await mkdtemp(join(tmpdir(), 'bth-preparation-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source'), workspace = join(root, 'workspace')
  await mkdir(source)
  await mkdir(join(workspace, prefix), { recursive: true })
  await writeFile(join(workspace, prefix, 'package.json'), '{"name":"example"}')
  await writeFile(join(workspace, prefix, 'package-lock.json'), JSON.stringify(lock()))
  return { source, workspace }
}

test('offline preparation runs fixed flags only in the separate workspace and redacts output', async (t) => {
  const { source, workspace } = await fixture(t)
  let invocation
  const result = await prepareWorkspaceDependencies(source, workspace, config, paths, { processRunner: async input => { invocation = input; return processResult() } })
  assert.equal(result.status, 'passed')
  assert.equal(invocation.cwd, await realpath(workspace))
  assert.deepEqual(invocation.args, ['--prefix', await realpath(workspace), '--global=false', '--workspaces=false', 'ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'])
  assert.equal(invocation.timeoutMs, 1000)
  assert.equal(result.inputs.length, 2)
  assert.equal(result.onlineFallback, false)
  assert.equal(result.dependencyEntries, 1)
  const failed = await prepareWorkspaceDependencies(source, workspace, config, paths, { processRunner: async () => processResult(1), platform: 'win32' })
  assert.equal(failed.command[0], 'npm.cmd')
  assert.equal(failed.status, 'failed')
  assert.equal(failed.failureCode, 'offline-dependency-cache-incomplete')
  assert.doesNotMatch(JSON.stringify(failed), /synthetic secret/)
  assert.equal(await prepareWorkspaceDependencies(source, workspace, null, paths), null)
  for (const change of [{ timedOut: true }, { signal: 'SIGTERM' }, { stdioDrainTimedOut: true }, { exitCode: 2 }]) {
    const failedProcess = await prepareWorkspaceDependencies(source, workspace, config, paths, { processRunner: async () => ({ ...processResult(), ...change }) })
    assert.equal(failedProcess.status, 'failed')
    assert.equal(failedProcess.failureCode, 'workspace-preparation-failed')
  }
})

test('offline preparation supports a declared nested standalone npm project', async (t) => {
  const { source, workspace } = await fixture(t, 'backend')
  const result = await prepareWorkspaceDependencies(source, workspace, { ...config, projectPath: 'backend' }, paths.map(path => 'backend/' + path), { processRunner: async input => {
    assert.ok(input.cwd.replaceAll('\\', '/').endsWith('/backend'))
    return processResult()
  } })
  assert.equal(result.status, 'passed')
  assert.deepEqual(result.inputs.map(input => input.path), ['backend/package.json', 'backend/package-lock.json'])
})

test('offline preparation refuses original/overlapping roots, undeclared files, malformed locks and links before execution', async (t) => {
  const { source, workspace } = await fixture(t)
  const runner = { processRunner: async () => { assert.fail('must never execute') } }
  await assert.rejects(prepareWorkspaceDependencies(source, source, config, paths, runner), /separate implementation/)
  await mkdir(join(source, 'nested'))
  await assert.rejects(prepareWorkspaceDependencies(source, join(source, 'nested'), config, paths, runner), /separate implementation/)
  await assert.rejects(prepareWorkspaceDependencies(source, workspace, config, ['package.json'], runner), /declared verification/)
  await writeFile(join(workspace, 'package-lock.json'), 'DO_NOT_LOG {malformed')
  await assert.rejects(prepareWorkspaceDependencies(source, workspace, config, paths, runner), error => !error.message.includes('DO_NOT_LOG') && /valid JSON/.test(error.message))
  await writeFile(join(workspace, 'package-lock.json'), ' '.repeat(8 * 1024 * 1024 + 1))
  await assert.rejects(prepareWorkspaceDependencies(source, workspace, config, paths, runner), /8 MiB/)
  await writeFile(join(workspace, 'package-lock.json'), JSON.stringify(lock()))
  await writeFile(join(workspace, 'npm-shrinkwrap.json'), '{}')
  await assert.rejects(prepareWorkspaceDependencies(source, workspace, config, paths, runner), /shrinkwrap/)
  await rm(join(workspace, 'npm-shrinkwrap.json'))
  await assert.rejects(prepareWorkspaceDependencies(source, workspace, { ...config, kind: 'shell' }, paths, runner), /Unsupported/)
  await symlink(source, join(workspace, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(prepareWorkspaceDependencies(source, workspace, config, paths, runner), /symbolic link|not be a link/)
})

test('npm lock validation rejects unbounded, local, git, authenticated and unpinned dependencies', () => {
  for (const mutate of [
    d => { d.lockfileVersion = 1 }, d => { d.packages = [] }, d => { d.packages[''].workspaces = ['packages/*'] },
    d => { d.packages = Object.fromEntries([['', {}], ...Array.from({ length: 20000 }, (_, i) => ['node_modules/' + i, {}])]) },
    d => { d.packages['../outside'] = d.packages['node_modules/example'] },
    ...[
      { link: true }, { resolved: 'file:../outside' }, { resolved: 'git+https://example.invalid/repo.git' },
      { resolved: 'https://user:password@example.invalid/a.tgz' }, { resolved: 'not a URL' }, { integrity: undefined }
    ].map(value => d => Object.assign(d.packages['node_modules/example'], value))
  ]) {
    const document = lock(); mutate(document)
    assert.throws(() => validateOfflineNpmLock(document, {}))
  }
  assert.throws(() => validateOfflineNpmLock(null, {}))
  assert.throws(() => validateOfflineNpmLock(lock(), { workspaces: ['a'] }))
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const specification of ['file:../outside', 'github:owner/repo', 'https://example.invalid/a.tgz', {}, 'git+ssh://example.invalid/repo']) {
      assert.throws(() => validateOfflineNpmLock(lock(), { [field]: { example: specification } }), /non-registry/)
    }
  }
  for (const field of ['overrides', 'bundleDependencies', 'bundledDependencies']) {
    assert.throws(() => validateOfflineNpmLock(lock(), { [field]: [] }), /override or bundled/)
  }
  assert.doesNotThrow(() => validateOfflineNpmLock(lock(), { dependencies: { example: '^1.2.0', alias: 'npm:@example/aliased@^1.0.0' } }))
  const historical = lock(); historical.packages['node_modules/example'].integrity = 'sha1-' + Buffer.alloc(20).toString('base64')
  assert.equal(validateOfflineNpmLock(historical, {}).legacyIntegrityEntries, 1)
})
