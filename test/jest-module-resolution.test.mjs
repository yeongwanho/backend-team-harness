import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { inspectPortableTestBuild, portableVerificationConfig, portableVerificationTemplates } from '../src/core/portable-test-discovery.mjs'
import { inspectTestAuthoringContract } from '../src/core/test-authoring-contract.mjs'
import { parseVerificationConfig } from '../src/config/verification.mjs'
import { initProject } from '../src/init-project.mjs'
import { initializeGit } from '../test-support/git-project.mjs'
import { jestDocument } from '../test-support/jest-document.mjs'

async function fixture(t, options = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bth-jest-resolution-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const projectPath = options.projectPath ?? '.'
  const directory = join(root, projectPath)
  await mkdir(join(directory, 'src'), { recursive: true })
  const document = { scripts: { test: options.command ?? 'jest' }, devDependencies: { jest: '29.7.0', 'ts-jest': '29.1.2' },
    jest: { rootDir: 'src', testRegex: '.*\\.spec\\.ts$', transform: { '^.+\\.(t|j)s$': 'ts-jest' }, ...options.jest } }
  await writeFile(join(directory, 'package.json'), JSON.stringify(document))
  await writeFile(join(directory, 'tsconfig.json'), JSON.stringify(options.tsconfig ?? { compilerOptions: { baseUrl: './' } }))
  const prefix = projectPath === '.' ? '' : projectPath + '/'
  const files = ['package.json', 'tsconfig.json'].map(p => prefix + p)
  const detect = () => inspectPortableTestBuild(root, { files })
  return { root, directory, projectPath, files, detect }
}

test('new Jest gate binds an explicit TypeScript baseUrl without changing test discovery', async t => {
  const f = await fixture(t)
  const detection = await f.detect()
  assert.equal(detection.moduleSearchPath, '.')
  assert.ok(detection.buildInputs.includes('tsconfig.json'))
  const config = parseVerificationConfig(JSON.stringify(portableVerificationConfig(detection)))
  for (const template of portableVerificationTemplates(detection)) {
    await mkdir(join(f.root, '.backend-harness/bin'), { recursive: true })
    await writeFile(join(f.root, template.path), template.content)
  }
  const contract = await inspectTestAuthoringContract(f.root, config)
  assert.equal(contract.status, 'observed')
  assert.deepEqual(contract.moduleResolution, { kind: 'additional-jest-module-path', relativeTo: 'projectPath', path: '.', source: 'tsconfig.json' })
  assert.equal(contract.declaredDiscovery.rootDir, 'src')
  await writeFile(join(f.root, 'tsconfig.json'), '{"compilerOptions":{"baseUrl":"src"}}')
  assert.equal((await inspectTestAuthoringContract(f.root, config)).status, 'unknown')
})

test('nested package module path is absolute at execution and stays inside the selected package', async t => {
  const f = await fixture(t, { projectPath: 'apps/my api' })
  const detection = await f.detect()
  assert.equal(detection.moduleSearchPath, '.')
  assert.ok(detection.buildInputs.includes('apps/my api/tsconfig.json'))
  const runner = portableVerificationTemplates(detection)[0]
  await mkdir(join(f.root, '.backend-harness/bin'), { recursive: true })
  await writeFile(join(f.root, runner.path), runner.content)
  await mkdir(join(f.directory, 'node_modules/jest/bin'), { recursive: true })
  await writeFile(join(f.directory, 'node_modules/jest/bin/jest.js'), [
    'const fs = require("node:fs")',
    'if (!process.argv.includes(' + JSON.stringify('--modulePaths=' + resolve(f.directory)) + ')) process.exit(23)',
    'fs.writeFileSync(process.argv.find(a => a.startsWith("--outputFile=")).slice(13), ' + JSON.stringify(JSON.stringify(jestDocument())) + ')'
  ].join('\n'))
  const result = spawnSync(process.execPath, [runner.path], { cwd: f.root, encoding: 'utf8', timeout: 15000 })
  assert.equal(result.status, 0, result.stderr)
  assert.match(await readFile(join(f.root, '.backend-harness/local/reports/tests/junit.xml'), 'utf8'), /<testcase/)
})

test('custom Jest resolution, alternate transforms and scripts are never overridden', async t => {
  for (const options of [
    ...['modulePaths', 'moduleNameMapper', 'moduleDirectories', 'resolver', 'preset', 'projects', 'globals'].map(k => ({ jest: { [k]: [] } })),
    { jest: { transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'other.json' }] } } },
    { jest: { transform: { '^.+\\.ts$': 'other-transform' } } },
    { command: 'jest --config custom.json' }, { command: 'jest --roots test' },
  ]) {
    const f = await fixture(t, options)
    assert.equal((await f.detect()).moduleSearchPath, undefined, JSON.stringify(options))
  }
})

test('inherited, aliased, missing, malformed and oversized tsconfig are not guessed', async t => {
  for (const tsconfig of [
    { extends: './base.json', compilerOptions: { baseUrl: '.' } },
    { compilerOptions: { baseUrl: '.', paths: {} } },
    { compilerOptions: {} }, { compilerOptions: { baseUrl: null } },
  ]) {
    const f = await fixture(t, { tsconfig })
    assert.equal((await f.detect()).moduleSearchPath, undefined)
  }
  const f = await fixture(t)
  for (const text of ['{broken', ' '.repeat(65537), 'null']) {
    await writeFile(join(f.root, 'tsconfig.json'), text)
    assert.equal((await f.detect()).moduleSearchPath, undefined)
  }
  await rm(join(f.root, 'tsconfig.json'))
  assert.equal((await f.detect()).moduleSearchPath, undefined)
})

test('escaping, secret-shaped, non-directory and linked paths do not become module search roots', async t => {
  for (const baseUrl of ['../', '/tmp', 'C:\\outside', 'missing', 'tsconfig.json', 'person@example.invalid', 'src/../../', 'password=secret']) {
    const f = await fixture(t, { tsconfig: { compilerOptions: { baseUrl } } })
    assert.equal((await f.detect()).moduleSearchPath, undefined, baseUrl)
  }
  if (process.platform !== 'win32') {
    const f = await fixture(t)
    await rm(join(f.root, 'tsconfig.json'))
    await writeFile(join(f.root, 'other.json'), '{"compilerOptions":{"baseUrl":"."}}')
    await symlink('other.json', join(f.root, 'tsconfig.json'))
    assert.equal((await f.detect()).moduleSearchPath, undefined)
    await rm(join(f.root, 'tsconfig.json'))
    await writeFile(join(f.root, 'tsconfig.json'), '{"compilerOptions":{"baseUrl":"linked"}}')
    await symlink('src', join(f.root, 'linked'))
    assert.equal((await f.detect()).moduleSearchPath, undefined)
  }
})

test('external Jest config is detected without executing it or requiring it in the manifest', async t => {
  const f = await fixture(t)
  await writeFile(join(f.root, 'jest.config.cjs'), 'throw new Error("MUST_NOT_EXECUTE")')
  assert.equal((await f.detect()).moduleSearchPath, undefined)
})

test('plain projects retain the existing generated runner bytes', async t => {
  const f = await fixture(t, { tsconfig: { compilerOptions: {} } })
  const detection = await f.detect()
  assert.equal(detection.moduleSearchPath, undefined)
  assert.equal(portableVerificationTemplates(detection)[0].content,
    portableVerificationTemplates({ canGenerateVerification: true, framework: 'jest', projectPath: '.', testArgs: [] })[0].content)
})

test('init does not rewrite an installed gate after compiler metadata changes', async t => {
  const f = await fixture(t)
  initializeGit(f.root)
  await initProject(f.root)
  const path = join(f.root, '.backend-harness/bin/verify-portable.mjs')
  const original = await readFile(path, 'utf8')
  assert.match(original, /--modulePaths=/)
  await writeFile(join(f.root, 'tsconfig.json'), '{"compilerOptions":{"baseUrl":"src"}}')
  await initProject(f.root)
  assert.equal(await readFile(path, 'utf8'), original)
})
