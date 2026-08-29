import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmod, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { initProject } from '../src/init-project.mjs'
import { installPack } from '../src/packs/install.mjs'
import { checkProject } from '../src/runtime/backend-harness.mjs'
import { initializeGit } from '../test-support/git-project.mjs'

const enabled = process.env.BTH_REAL_DB_E2E === '1'

function docker(args) {
  return spawnSync('docker', args, { encoding: 'utf8' })
}

function dockerReady() {
  return docker(['info', '--format', '{{.ServerVersion}}']).status === 0
}

function mysqlContainerIds() {
  const result = docker(['ps', '-aq', '--filter', 'ancestor=mysql:8.4.11'])
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'docker ps failed')
  }
  return new Set(result.stdout.split('\n').filter(Boolean))
}

async function waitForMySqlCleanup(before) {
  let leaked = []
  for (let attempt = 0; attempt < 40; attempt += 1) {
    leaked = [...mysqlContainerIds()].filter((id) => !before.has(id))
    if (leaked.length === 0) {
      return
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250))
  }
  for (const id of leaked) {
    docker(['rm', '-f', id])
  }
  assert.fail('MySQL Testcontainers cleanup left containers behind: ' + leaked.join(', '))
}

async function configureMode(configPath, mode, timeoutMs = 900000) {
  const config = JSON.parse(await readFile(configPath, 'utf8'))
  const gate = config.gates.find((entry) => entry.id === 'db-integration')
  gate.command = gate.command.filter((entry) => !entry.startsWith('-Dbth.fixture.mode='))
  gate.command.splice(1, 0, '-Dbth.fixture.mode=' + mode)
  gate.timeoutMs = timeoutMs
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8')
}

test('DB Pack runs real MySQL migrations and integration behavior', { skip: !enabled || !dockerReady() }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-real-mysql-'))
  const example = resolve('examples/spring-service')
  await cp(example, root, {
    recursive: true,
    filter: (source) => !/(?:^|\/)(?:build|\.gradle|\.backend-harness)(?:\/|$)/.test(source.slice(example.length))
  })
  await chmod(join(root, 'gradlew'), 0o755)
  await writeFile(join(root, '.gitignore'), 'build/\n.gradle/\n.backend-harness/local/\n.backend-harness/generated/\n', 'utf8')
  initializeGit(root)
  await initProject(root)
  await installPack(root, 'db-integration')
  const configPath = join(root, '.backend-harness/verification.json')
  const config = JSON.parse(await readFile(configPath, 'utf8'))
  config.context = { profile: 'integration-test', databaseDialect: 'mysql' }
  config.gates[0].network = true
  config.gates[0].command = config.gates[0].command.filter((entry) => entry !== '--offline')
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8')

  try {
    const successBefore = mysqlContainerIds()
    const result = await checkProject(root, { allowNetwork: true })

    assert.equal(result.confirmed, true, JSON.stringify(result.result, null, 2))
    const dbGate = result.result.gates.find((gate) => gate.id === 'db-integration')
    assert.equal(dbGate.outcome, 'passed')
    assert.equal(dbGate.result.executed, 1)
    assert.equal(result.result.toolchain.declaredContext.databaseDialect, 'mysql')
    await waitForMySqlCleanup(successBefore)

    for (const scenario of [
      { mode: 'assertion-failure', expectedReason: 'process_failed', timeoutMs: 900000 },
      { mode: 'process-failure', expectedReason: 'process_failed', timeoutMs: 900000 },
      { mode: 'timeout', expectedReason: 'process_timed_out', timeoutMs: 15000 }
    ]) {
      await configureMode(configPath, scenario.mode, scenario.timeoutMs)
      const before = mysqlContainerIds()
      const failed = await checkProject(root, { allowNetwork: true })
      const failedGate = failed.result.gates.find((gate) => gate.id === 'db-integration')
      assert.equal(failed.confirmed, false)
      assert.equal(failedGate.reason, scenario.expectedReason)
      await waitForMySqlCleanup(before)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
