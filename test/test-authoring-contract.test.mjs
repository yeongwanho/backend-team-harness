import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { inspectTestAuthoringContract } from '../src/core/test-authoring-contract.mjs'
import { portableVerificationConfig, portableVerificationTemplates } from '../src/core/portable-test-discovery.mjs'
import { parseVerificationConfig } from '../src/config/verification.mjs'

async function fixture(t, { projectPath = '.', testArgs = [], jest = { rootDir: 'src', testRegex: '.*\\.spec\\.ts$' } } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'bth-test-authoring-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const manifest = (projectPath === '.' ? '' : projectPath + '/') + 'package.json'
  const detection = { canGenerateVerification: true, framework: 'jest', projectPath, buildInputs: [manifest], testArgs }
  const config = parseVerificationConfig(JSON.stringify(portableVerificationConfig(detection)))
  await mkdir(dirname(join(root, manifest)), { recursive: true })
  await writeFile(join(root, manifest), JSON.stringify({
    scripts: { test: ['jest', ...testArgs].join(' '), 'test:e2e': 'jest --config test/e2e.json' },
    devDependencies: { jest: '29.7.0' }, jest,
    privateSecret: 'must-never-enter-provider-context',
  }))
  for (const template of portableVerificationTemplates(detection)) {
    await mkdir(dirname(join(root, template.path)), { recursive: true })
    await writeFile(join(root, template.path), template.content)
  }
  return { root, config, manifest }
}

test('generated Jest gate exposes source-bound inline test scope, not the nearby E2E suite', async t => {
  const { root, config, manifest } = await fixture(t)
  const result = await inspectTestAuthoringContract(root, config)
  assert.equal(result.status, 'observed')
  assert.equal(result.authority, 'source-bound-test-authoring-guidance')
  assert.equal(result.framework, 'jest')
  assert.equal(result.gateId, 'tests')
  assert.equal(result.projectPath, '.')
  assert.deepEqual(result.declaredDiscovery, { rootDir: 'src', testRegex: '.*\\.spec\\.ts$' })
  assert.equal(result.source.path, manifest)
  assert.equal(result.source.sha256, createHash('sha256').update(await readFile(join(root, manifest))).digest('hex'))
  assert.match(result.guidance, /test:e2e/)
  assert.doesNotMatch(JSON.stringify(result), /must-never|e2e\.json|devDependencies/)
})

test('nested project test roots stay relative to their selected package', async t => {
  const { root, config } = await fixture(t, { projectPath: 'apps/api', jest: { rootDir: '.', roots: ['<rootDir>/src'], testMatch: ['**/*.spec.ts'], testPathIgnorePatterns: ['/fixtures/'] } })
  const result = await inspectTestAuthoringContract(root, config)
  assert.equal(result.status, 'observed')
  assert.equal(result.projectPath, 'apps/api')
  assert.deepEqual(result.declaredDiscovery.roots, ['<rootDir>/src'])
})

test('custom gate and changed generated runner cannot borrow the default Jest scope', async t => {
  const { root, config } = await fixture(t)
  const custom = structuredClone(config)
  custom.gates[0].command.push('--e2e')
  assert.equal((await inspectTestAuthoringContract(root, custom)).status, 'unknown')
  await writeFile(join(root, '.backend-harness/bin/verify-portable.mjs'), 'throw new Error("must not execute")')
  assert.equal((await inspectTestAuthoringContract(root, config)).status, 'unknown')
})

test('external config, presets, projects and absent inline config stay unknown', async t => {
  for (const options of [
    { testArgs: ['--config', 'test/custom.json'] },
    { jest: { rootDir: 'src', preset: 'other-config' } },
    { jest: { projects: ['apps/*'] } },
    { jest: undefined, testArgs: ['--roots', 'test'] },
    { jest: null },
  ]) {
    const { root, config } = await fixture(t, options)
    const result = await inspectTestAuthoringContract(root, config)
    assert.equal(result.status, 'unknown', JSON.stringify(options))
    assert.equal(result.declaredDiscovery, undefined)
  }
})

test('malformed, oversized, secret-bearing or escaping discovery values stay unknown', async t => {
  for (const jest of [
    { rootDir: '../../outside' }, { rootDir: '/tmp/outside' }, { rootDir: 'C:\\outside' },
    { roots: ['<rootDir>/../outside'] }, { testRegex: 'x'.repeat(513) },
    { testMatch: [42] }, { testRegex: 'password=super-secret-value' },
  ]) {
    const { root, config } = await fixture(t, { jest })
    assert.equal((await inspectTestAuthoringContract(root, config)).status, 'unknown', JSON.stringify(jest))
  }
})

test('unsafe or missing manifest inputs produce no inferred test contract', async t => {
  const { root, config, manifest } = await fixture(t)
  await rm(join(root, manifest))
  assert.equal((await inspectTestAuthoringContract(root, config)).status, 'unknown')
  if (process.platform !== 'win32') {
    await writeFile(join(root, 'outside.json'), '{"jest":{"rootDir":"src"}}')
    await symlink('outside.json', join(root, manifest))
    assert.equal((await inspectTestAuthoringContract(root, config)).status, 'unknown')
  }
})
