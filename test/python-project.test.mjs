import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { inspectPortableTestBuild } from '../src/core/portable-test-discovery.mjs'
import { scanProjectManifest } from '../src/core/project-manifest.mjs'
import { readPythonMetadata, parsePythonToml } from '../src/core/python-project.mjs'

async function fixture(t, files) {
  const root = await mkdtemp(join(tmpdir(), 'bth-python-metadata-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), text)
  }
  return root
}
const app = '[project]\nname="app"\n[dependency-groups]\ndev=["pytest>=7"]\n'
const inspect = async root => inspectPortableTestBuild(root, await scanProjectManifest(root))

test('uv member binds the root lock and every workspace manifest, retaining the backend cwd', async t => {
  const root = await fixture(t, { 'pyproject.toml': '[tool.uv.workspace]\nmembers=["backend", "libraries/*"]\n',
    'uv.lock': 'version=1\n', '.python-version': '3.12\n', 'backend/pyproject.toml': app,
    'libraries/common/pyproject.toml': '[project]\nname="common"\n' })
  const result = await inspect(root)
  assert.equal(result.canGenerateVerification, true)
  assert.equal(result.projectPath, 'backend')
  for (const path of ['pyproject.toml', 'uv.lock', '.python-version', 'backend/pyproject.toml', 'libraries/common/pyproject.toml']) assert.ok(result.buildInputs.includes(path), path)
  assert.equal(result.uv.workspacePath, '.')
  assert.equal(result.uv.packageName, 'app')
  assert.equal(result.uv.pythonVersion, '3.12')
  assert.deepEqual(result.uv.testGroups, ['dev'])
  assert.equal(result.venvPath, '.venv')
})

test('pytest in comments or unrelated strings is not a dependency', async t => {
  for (const text of ['[project]\nname="example"\n# pytest >=8\n', '[project]\nname="example"\ndescription="pytest >=8"\n', '[broken\n# pytest\n']) {
    const root = await fixture(t, { 'pyproject.toml': text })
    assert.equal((await inspect(root)).canGenerateVerification, false)
  }
})

test('standalone and optional test dependencies resolve without inventing an installation', async t => {
  const root = await fixture(t, { 'api/pyproject.toml': '[project]\nname="api"\n[project.optional-dependencies]\ntests=["pytest[foo]>=8"]\n', 'api/uv.lock': 'version=1\n' })
  const result = await inspect(root)
  assert.equal(result.projectPath, 'api')
  assert.equal(result.uv.workspacePath, 'api')
  assert.deepEqual(result.uv.testExtras, ['tests'])
  assert.equal(result.venvPath, 'api/.venv')
  const legacy = await fixture(t, { 'api/pyproject.toml': app })
  assert.equal((await inspect(legacy)).uv, null)
})

test('existing non-uv environments do not require a package name and retain their own lock inputs', async t => {
  for (const text of ['[dependency-groups]\ndev=["pytest"]\n',
    '[tool.poetry.group.test.dependencies]\npytest="^8.0"\n',
    '[tool.poetry.dev-dependencies]\npytest={version="^8.0"}\n']) {
    const root = await fixture(t, { 'api/pyproject.toml': text, 'api/poetry.lock': '# lock', 'api/pdm.lock': '# lock' })
    const result = await inspect(root)
    assert.equal(result.canGenerateVerification, true)
    assert.equal(result.uv, null)
    assert.equal(result.venvPath, 'api/.venv')
    assert.deepEqual([...result.buildInputs].sort(), ['api/pdm.lock', 'api/poetry.lock', 'api/pyproject.toml'])
  }
})

test('Python metadata enforces file, UTF-8 and nesting budgets without quoting input', async t => {
  const root = await fixture(t, { 'pyproject.toml': 'password="PRIVATE_VALUE"', 'large.toml': 'x'.repeat(50) })
  await assert.rejects(readPythonMetadata(root, 'large.toml', 16), /bounded file budget/)
  await writeFile(join(root, 'invalid.toml'), Buffer.from([0xff, 0xfe]))
  await assert.rejects(readPythonMetadata(root, 'invalid.toml'), /UTF-8/)
  await symlink(join(root, 'pyproject.toml'), join(root, 'linked.toml'))
  await assert.rejects(readPythonMetadata(root, 'linked.toml'), /symbolic link|regular file/)
  assert.equal(await readPythonMetadata(root, 'absent.toml'), null)
  assert.throws(() => parsePythonToml('secret=PRIVATE_VALUE'), { message: 'Python metadata is not valid bounded TOML.' })
  assert.throws(() => parsePythonToml('secret=' + '['.repeat(40) + '1' + ']'.repeat(40)), /bounded TOML/)
})

test('Python workspace discovery rejects missing locks, duplicate names, nested owners and unsafe pins', async t => {
  const basic = { 'pyproject.toml': '[tool.uv.workspace]\nmembers=["backend", "lib"]\n', 'backend/pyproject.toml': app,
    'lib/pyproject.toml': '[project]\nname="lib"\n', 'uv.lock': 'version=1\n' }
  for (const changes of [
    { 'uv.lock': null }, { 'lib/pyproject.toml': '[project]\nname="App"\n' },
    { 'lib/pyproject.toml': '[broken' }, { '.python-version': 'system\n' },
    { 'backend/pyproject.toml': app + '[tool.uv.workspace]\nmembers=["."]\n' },
    { 'pyproject.toml': '[tool.uv.workspace]\nmembers=["backend"]\nexclude="lib"\n' }
  ]) {
    const files = Object.fromEntries(Object.entries({ ...basic, ...changes }).filter(([, value]) => value !== null))
    assert.equal((await inspect(await fixture(t, files))).canGenerateVerification, false)
  }
  const root = await fixture(t, { ...basic, '.python-version': '3.11', 'backend/.python-version': '3.12.13' })
  const result = await inspect(root)
  assert.equal(result.uv.pythonVersion, '3.12.13')
  assert.ok(result.buildInputs.includes('.python-version'))
  assert.ok(result.buildInputs.includes('backend/.python-version'))
})

test('ambiguous, escaping, excluded and malformed workspace membership never confirms a layout', async t => {
  for (const workspace of [
    '[tool.uv.workspace]\nmembers=["../outside"]\n',
    '[tool.uv.workspace]\nmembers=["backend"]\nexclude=["backend"]\n',
    '[tool.uv.workspace]\nmembers=["other"]\n',
    '[tool.uv.workspace]\nmembers="backend"\n',
    '[tool.uv.workspace]\nmembers=["backend"\n'
  ]) {
    const root = await fixture(t, { 'pyproject.toml': workspace, 'backend/pyproject.toml': app, 'uv.lock': 'version=1\n' })
    assert.equal((await inspect(root)).canGenerateVerification, false)
  }
  const root = await fixture(t, { 'a/pyproject.toml': app, 'b/pyproject.toml': app })
  assert.equal((await inspect(root)).status, 'conflict')
})
