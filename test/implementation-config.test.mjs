import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseImplementationConfig, resolveImplementationExecutable } from '../src/config/implementation.mjs'

const valid = {
  schemaVersion: 1,
  adapter: {
    id: 'team-agent',
    command: ['./tools/implement', '--mode', 'bounded'],
    network: false,
    timeoutMs: 120000
  },
  writePolicy: {
    allowedPrefixes: ['src/', 'build.gradle.kts'],
    maxChangedFiles: 20,
    maxDiffBytes: 1048576
  },
  recovery: { maxAttempts: 2 }
}

test('project formatting is optional, schema-v2 only and bounded without shell evaluation', () => {
  const formatting = { command: ['./mvnw', '-o', 'spring-javaformat:apply'], network: false, inputs: ['pom.xml', '.editorconfig'] }
  const config = { schemaVersion: 2, adapter: null, formatting }
  assert.deepEqual(parseImplementationConfig(JSON.stringify(config)).formatting, { ...formatting, inputs: ['.editorconfig', 'pom.xml'], timeoutMs: 60000 })
  assert.equal(parseImplementationConfig(JSON.stringify({ ...config, formatting: null })).formatting, null)
  assert.throws(() => parseImplementationConfig(JSON.stringify({ ...config, schemaVersion: 1 })), /schemaVersion 2/)
  for (const patch of [
    { command: [] }, { command: ['/usr/bin/mvn'] }, { command: ['../mvnw'] }, { command: ['./mvnw', '\0'] },
    { network: undefined }, { network: 'false' }, { inputs: ['../policy'] }, { inputs: 'pom.xml' },
    { timeoutMs: 999 }, { timeoutMs: 600001 }, { shell: true }
  ]) assert.throws(() => parseImplementationConfig(JSON.stringify({ ...config, formatting: { ...formatting, ...patch } })))
})

test('implementation config is disabled by default and normalizes a strict enabled contract', () => {
  assert.deepEqual(parseImplementationConfig('{"schemaVersion":1,"adapter":null}'), {
    schemaVersion: 1,
    adapter: null,
    recovery: { maxAttempts: 2 }
  })
  const parsed = parseImplementationConfig(JSON.stringify(valid), 'implementation.json')
  assert.equal(parsed.adapter.command[0], './tools/implement')
  assert.deepEqual(parsed.writePolicy.allowedPrefixes, ['src/', 'build.gradle.kts'])
  assert.equal(parsed.recovery.maxAttempts, 2)
})

test('optional workspace preparation is explicit, bounded and schema-v2 only', () => {
  const document = { schemaVersion: 2, adapter: null, workspacePreparation: { kind: 'npm-ci-offline', projectPath: 'backend' } }
  assert.deepEqual(parseImplementationConfig(JSON.stringify(document)).workspacePreparation, { kind: 'npm-ci-offline', projectPath: 'backend', timeoutMs: 180000 })
  assert.equal(parseImplementationConfig(JSON.stringify({ ...document, workspacePreparation: null })).workspacePreparation, null)
  for (const value of [{ ...document, schemaVersion: 1 }, ...[
    { kind: 'npm-install-online' }, { projectPath: '../outside' }, { projectPath: '/tmp' }, { timeoutMs: 0 }, { timeoutMs: 600001 }, { command: ['sh'] }
  ].map(change => ({ ...document, workspacePreparation: { ...document.workspacePreparation, ...change } }))]) assert.throws(() => parseImplementationConfig(JSON.stringify(value)))
})

test('uv preparation accepts only an optional numeric Python 3 interpreter selection', () => {
  const document = { schemaVersion: 2, adapter: null, workspacePreparation: { kind: 'uv-sync-offline', projectPath: '.', pythonVersion: '3.12.13' } }
  assert.deepEqual(parseImplementationConfig(JSON.stringify(document)).workspacePreparation,
    { kind: 'uv-sync-offline', projectPath: '.', pythonVersion: '3.12.13', timeoutMs: 180000 })
  for (const value of ['3', 'python3', '/usr/bin/python3', '--system', '3.12\n', '2.7', 3.12, null]) {
    assert.throws(() => parseImplementationConfig(JSON.stringify({ ...document, workspacePreparation: { ...document.workspacePreparation, pythonVersion: value } })), /numeric Python 3/)
  }
  assert.throws(() => parseImplementationConfig(JSON.stringify({ ...document, workspacePreparation: { ...document.workspacePreparation, kind: 'npm-ci-offline' } })), /numeric Python 3/)
})

test('implementation config rejects unknown authority, traversal, missing budgets, and excessive recovery', () => {
  const unknown = structuredClone(valid)
  unknown.adapter.deploy = true
  assert.throws(() => parseImplementationConfig(JSON.stringify(unknown)), /unknown key: deploy/)

  const traversal = structuredClone(valid)
  traversal.adapter.command[0] = '../outside'
  assert.throws(() => parseImplementationConfig(JSON.stringify(traversal)), /stay inside the project/)

  const missingBudget = structuredClone(valid)
  delete missingBudget.writePolicy
  assert.throws(() => parseImplementationConfig(JSON.stringify(missingBudget)), /writePolicy must be an object/)

  const retries = structuredClone(valid)
  retries.recovery.maxAttempts = 6
  assert.throws(() => parseImplementationConfig(JSON.stringify(retries)), /between 1 and 5/)
})

test('implementation executable resolver accepts only a project-owned regular executable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-implementation-config-'))
  await mkdir(join(root, 'tools'), { recursive: true })
  await writeFile(join(root, 'tools/real'), '#!/bin/sh\nexit 0\n', 'utf8')
  await chmod(join(root, 'tools/real'), 0o755)
  const resolved = await resolveImplementationExecutable(root, ['./tools/real'])
  assert.equal(resolved.displayPath, './tools/real')

  await symlink(join(root, 'tools/real'), join(root, 'tools/link'))
  await assert.rejects(resolveImplementationExecutable(root, ['./tools/link']), /symbolic link/)
})

test('schema v2 accepts bounded Codex and Claude providers without accepting arbitrary executables', () => {
  const codex = parseImplementationConfig(JSON.stringify({
    schemaVersion: 2,
    adapter: {
      kind: 'provider', provider: 'codex', network: true, mode: 'auto',
      contextBudgetCharacters: 6000, model: null
    },
    writePolicy: { allowedPrefixes: ['src/'], maxChangedFiles: 20, maxDiffBytes: 1048576 },
    recovery: { maxAttempts: 2 }
  }))
  assert.equal(codex.adapter.kind, 'provider')
  assert.equal(codex.adapter.provider, 'codex')
  assert.equal(codex.adapter.contextBudgetCharacters, 6000)

  const providerConfig = (provider) => ({
    schemaVersion: 2,
    adapter: {
      kind: 'provider', provider, network: true, mode: 'auto',
      contextBudgetCharacters: 6000, model: null
    },
    writePolicy: { allowedPrefixes: ['src/'], maxChangedFiles: 20, maxDiffBytes: 1048576 },
    recovery: { maxAttempts: 2 }
  })
  const claude = providerConfig('claude')
  Object.assign(claude.adapter, { mode: 'fast', contextBudgetCharacters: null, model: 'sonnet', maxBudgetUsd: 2.5 })
  const parsedClaude = parseImplementationConfig(JSON.stringify(claude))
  assert.equal(parsedClaude.adapter.maxBudgetUsd, 2.5)

  const arbitrary = providerConfig('codex')
  arbitrary.adapter.provider = 'arbitrary-shell'
  assert.throws(() => parseImplementationConfig(JSON.stringify(arbitrary)), /codex or claude/)

  const offline = providerConfig('codex')
  offline.adapter.network = false
  assert.throws(() => parseImplementationConfig(JSON.stringify(offline)), /must declare network/)

  const codexBudget = providerConfig('codex')
  codexBudget.adapter.maxBudgetUsd = 1
  assert.throws(() => parseImplementationConfig(JSON.stringify(codexBudget)), /only for Claude/)
})
