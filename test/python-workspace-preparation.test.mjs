import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareWorkspaceDependencies } from '../src/core/workspace-preparation.mjs'
import { validateOfflineUvLock } from '../src/core/python-workspace-preparation.mjs'

const paths = ['backend/pyproject.toml', 'pyproject.toml', 'uv.lock']
const config = { kind: 'uv-sync-offline', projectPath: 'backend', pythonVersion: '3.12', timeoutMs: 1000 }
const uv = { members: [{ name: 'app', path: 'backend' }] }
const lock = () => ({ version: 1, manifest: { members: ['app'] }, package: [
  { name: 'app', version: '1', source: { editable: 'backend' } },
  { name: 'pytest', version: '8.0', source: { registry: 'https://pypi.org/simple' }, wheels: [
    { url: 'https://files.pythonhosted.org/pytest.whl', hash: 'sha256:' + 'a'.repeat(64) }
  ] }
] })
const processResult = (extra = {}) => ({ exitCode: 0, signal: null, timedOut: false, stdioDrainTimedOut: false, durationMs: 12,
  stdout: { sha256: 'a'.repeat(64), bytes: 0 }, stderr: { sha256: 'b'.repeat(64), bytes: 0, tail: '' }, ...extra })
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'bth-uv-preparation-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source'), workspace = join(root, 'workspace')
  await mkdir(source)
  await mkdir(join(workspace, 'backend'), { recursive: true })
  await writeFile(join(workspace, 'pyproject.toml'), '[tool.uv.workspace]\nmembers=["backend"]\n')
  await writeFile(join(workspace, 'backend/pyproject.toml'), '[project]\nname="app"\n[dependency-groups]\ndev=["pytest>=8"]\n')
  await writeFile(join(workspace, 'uv.lock'), 'version=1\n[manifest]\nmembers=["app"]\n[[package]]\nname="app"\nversion="1"\nsource={editable="backend"}\n[[package]]\nname="pytest"\nversion="8.0"\nsource={registry="https://pypi.org/simple"}\nwheels=[{url="https://files.pythonhosted.org/pytest.whl",hash="sha256:' + 'a'.repeat(64) + '"}]\n')
  return { source, workspace }
}

test('uv preparation is offline, locked, no-build, workspace-local and source-bound', async t => {
  const { source, workspace } = await fixture(t)
  let invocation
  const before = await readFile(join(workspace, 'uv.lock'), 'utf8')
  const result = await prepareWorkspaceDependencies(source, workspace, config, paths, { processRunner: async input => { invocation = input; return processResult() } })
  assert.equal(result.status, 'passed')
  assert.equal(result.kind, 'uv-sync-offline')
  for (const flag of ['--offline', '--locked', '--no-build', '--no-install-workspace', '--no-python-downloads', '--no-config']) assert.ok(invocation.args.includes(flag), flag)
  assert.deepEqual(invocation.args.slice(-4), ['--python', '3.12', '--group', 'dev'])
  assert.ok(invocation.env.UV_PROJECT_ENVIRONMENT.endsWith(join('.backend-harness', 'local', 'python-venv')))
  assert.equal(result.inputs.length, 3)
  assert.equal(result.onlineFallback, false)
  assert.equal(result.lifecycleScripts, false)
  assert.equal(await readFile(join(workspace, 'uv.lock'), 'utf8'), before)
  assert.equal(result.dependencyEntries, 1)
})

test('uv failure preserves code and hashes without leaking diagnostics or invoking an online retry', async t => {
  const { source, workspace } = await fixture(t)
  let calls = 0
  const result = await prepareWorkspaceDependencies(source, workspace, config, paths, { platform: 'win32', processRunner: async input => {
    calls++
    assert.equal(input.program, 'uv.exe')
    return processResult({ exitCode: 1, stderr: { tail: 'offline cache missing PRIVATE_VALUE', sha256: 'a'.repeat(64), bytes: 42 } })
  } })
  assert.equal(calls, 1)
  assert.equal(result.status, 'failed')
  assert.equal(result.failureCode, 'offline-dependency-cache-incomplete')
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_VALUE/)
})

test('uv preparation refuses undeclared workspace inputs and linked environment directories before execution', async t => {
  const { source, workspace } = await fixture(t)
  const options = { processRunner: async () => assert.fail('must not execute') }
  await assert.rejects(prepareWorkspaceDependencies(source, workspace, config, ['backend/pyproject.toml'], options), /declared verification/)
  await assert.rejects(prepareWorkspaceDependencies(source, source, config, paths, options), /separate implementation/)
  await mkdir(join(workspace, '.backend-harness/local'), { recursive: true })
  await symlink(source, join(workspace, '.backend-harness/local/python-venv'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(prepareWorkspaceDependencies(source, workspace, config, paths, options), /symbolic link|not be a link/)
})

test('uv lock rejects source escapes, credentials, unhashed artifacts and undeclared local packages', () => {
  assert.deepEqual(validateOfflineUvLock(lock(), uv), { dependencyEntries: 1, workspaceEntries: 1 })
  for (const mutate of [
    d => { d.version = 99 }, d => { d.package = [] },
    d => { d.package[0].source.editable = '../external' },
    d => { d.package[0].name = 'someone-else' },
    d => { d.package[1].source = { git: 'https://example.invalid/repo' } },
    d => { d.package[1].source = { registry: 'https://user:secret@example.invalid/simple' } },
    d => { d.package[1].wheels[0].hash = 'md5:abc' },
    d => { d.package[1].wheels[0].url = 'file:///outside/a.whl' },
    d => { d.package[1].wheels[0].url = 'https://example.invalid/a.whl?token=secret' },
    d => { d.package[1].wheels = { PRIVATE_VALUE: true } },
    d => { d.package[1].wheels = null },
    d => { d.package[1].source = 'PRIVATE_VALUE' },
    d => { d.package.push(d.package[0]) },
    d => { d.package.shift() },
    d => { d.package[0].source.virtual = 'backend' }
  ]) { const value = lock(); mutate(value); assert.throws(() => validateOfflineUvLock(value, uv), error => error instanceof Error && !(error instanceof TypeError) && !error.message.includes('PRIVATE_VALUE')) }
})

test('uv preparation distinguishes process termination, stale locks and cache failure without retry', async t => {
  const { source, workspace } = await fixture(t)
  for (const [change, code] of [
    [{ exitCode: 1, stderr: { tail: 'lockfile needs update' } }, 'python-lock-out-of-date'],
    [{ exitCode: 0, signal: 'SIGTERM', stderr: { tail: 'offline cache missing' } }, 'workspace-preparation-failed'],
    [{ exitCode: 0, timedOut: true, stderr: { tail: 'offline cache missing' } }, 'workspace-preparation-failed'],
    [{ exitCode: 0, stdioDrainTimedOut: true }, 'workspace-preparation-failed']
  ]) {
    let calls = 0
    const result = await prepareWorkspaceDependencies(source, workspace, config, paths, { processRunner: async () => { calls++; return processResult(change) } })
    assert.equal(result.status, 'failed')
    assert.equal(result.failureCode, code)
    assert.equal(calls, 1)
  }
})

test('uv preparation rejects external manifest sources and version requests before execution', async t => {
  const { source, workspace } = await fixture(t)
  const path = join(workspace, 'backend/pyproject.toml'), original = await readFile(path, 'utf8')
  const options = { processRunner: async () => assert.fail('must not execute') }
  for (const entry of ['{path="../outside"}', '{git="https://example.invalid/repo"}', '{url="https://example.invalid/file.whl"}']) {
    await writeFile(path, original + '[tool.uv.sources]\nsomething=' + entry + '\n')
    await assert.rejects(prepareWorkspaceDependencies(source, workspace, config, paths, options), /manifest sources/)
  }
  await writeFile(path, original)
  await assert.rejects(prepareWorkspaceDependencies(source, workspace, { ...config, pythonVersion: '../python' }, paths, options), /numeric Python 3/)
  await assert.rejects(prepareWorkspaceDependencies(source, workspace, { ...config, projectPath: 'absent' }, paths, options), /unambiguous/)
})
