import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configureImplementationProvider } from '../src/config/implementation-setup.mjs'
import { initProject } from '../src/init-project.mjs'
import { initializeGit, writeGradleFixture } from '../test-support/git-project.mjs'

async function project() {
  const root = await mkdtemp(join(tmpdir(), 'bth-provider-setup-'))
  await writeGradleFixture(root)
  initializeGit(root)
  await initProject(root)
  return root
}

test('provider configure replaces the disabled template and preserves a recoverable backup', async () => {
  const root = await project()
  const result = await configureImplementationProvider(root, 'codex', {
    allowedPrefixes: ['src/', 'pom.xml'],
    mode: 'auto',
    now: () => new Date('2026-08-30T00:00:00.000Z'),
    backupSuffix: 'fixture'
  })
  assert.equal(result.config.adapter.provider, 'codex')
  assert.deepEqual(result.config.writePolicy.allowedPrefixes, ['src/', 'pom.xml'])
  assert.match(result.backup, /implementation-2026-08-30_00-00-00-000-fixture\.json/)
  const backup = JSON.parse(await readFile(join(root, result.backup), 'utf8'))
  assert.equal(backup.adapter, null)

  await assert.rejects(configureImplementationProvider(root, 'claude'), /already configured/)
  const replaced = await configureImplementationProvider(root, 'claude', {
    force: true,
    model: 'sonnet',
    maxBudgetUsd: 2
  })
  assert.equal(replaced.config.adapter.provider, 'claude')
  assert.equal(replaced.config.adapter.maxBudgetUsd, 2)
})

test('provider configure rejects invalid write scope before replacing the shared contract', async () => {
  const root = await project()
  const before = await readFile(join(root, '.backend-harness/implementation.json'), 'utf8')
  await assert.rejects(
    configureImplementationProvider(root, 'codex', { allowedPrefixes: ['../outside'] }),
    /stay inside the project/
  )
  assert.equal(await readFile(join(root, '.backend-harness/implementation.json'), 'utf8'), before)
})

test('provider selection preserves explicit workspace preparation and its null opt-out', async () => {
  const root = await project()
  for (const value of [{ kind: 'npm-ci-offline', projectPath: '.', timeoutMs: 9000 }, null]) {
    await writeFile(join(root, '.backend-harness/implementation.json'), JSON.stringify({ schemaVersion: 2, adapter: null, workspacePreparation: value }))
    const result = await configureImplementationProvider(root, 'codex')
    assert.deepEqual(result.config.workspacePreparation, value)
    assert.deepEqual(JSON.parse(await readFile(join(root, result.backup), 'utf8')).workspacePreparation, value)
  }
})

test('CLI configures a provider with explicit model, mode, and write prefixes', async () => {
  const root = await project()
  const cli = join(import.meta.dirname, '../src/cli.mjs')
  const result = spawnSync(process.execPath, [
    cli, 'implement', 'configure', 'claude', root,
    '--model', 'sonnet', '--mode', 'fast', '--max-budget-usd', '1.25',
    '--allowed-prefixes', '["src/","pom.xml"]', '--json'
  ], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(output.config.adapter.provider, 'claude')
  assert.equal(output.config.adapter.mode, 'fast')
  assert.deepEqual(output.config.writePolicy.allowedPrefixes, ['src/', 'pom.xml'])
})
