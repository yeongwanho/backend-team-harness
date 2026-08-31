import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { chmod, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { initProject } from '../src/init-project.mjs'
import { installPack } from '../src/packs/install.mjs'
import { checkProject } from '../src/runtime/backend-harness.mjs'
import { initializeGit } from '../test-support/git-project.mjs'
import { ownedMysqlContainers, removeOwnedMysqlContainer } from '../test-support/owned-docker-resources.mjs'

const enabled = process.env.BTH_REAL_DB_E2E === '1'

function docker(args) {
  return spawnSync('docker', args, { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 })
}

function dockerReady() {
  return docker(['info', '--format', '{{.ServerVersion}}']).status === 0
}

async function waitForMySqlCleanup(owner, image, scenario) {
  let leaked = []
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    leaked = ownedMysqlContainers(owner, docker)
    if (leaked.length === 0) {
      return
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500))
  }
  for (const id of leaked) {
    removeOwnedMysqlContainer(id, owner, image, docker)
  }
  assert.fail('MySQL Testcontainers cleanup exceeded 60 seconds after ' + scenario + ': ' + leaked.join(', '))
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
  const owner = randomUUID()
  const image = docker(['image', 'inspect', 'mysql:8.4.11', '--format', '{{.Id}}'])
  assert.equal(image.status, 0, 'The reviewed MySQL 8.4.11 image must already be cached; this fixture never pulls an image.')
  const imageId = image.stdout.trim()
  assert.match(imageId, /^sha256:[a-f0-9]{64}$/)
  const observations = []
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
  const integration = config.gates.find(gate => gate.id === 'db-integration')
  integration.command.splice(1, 0, '-Dbth.fixture.owner=' + owner)
  config.gates[0].network = true
  config.gates[0].command = config.gates[0].command.filter((entry) => entry !== '--offline')
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8')

  try {
    const result = await checkProject(root, { allowNetwork: true })

    assert.equal(result.confirmed, true, JSON.stringify(result.result, null, 2))
    const dbGate = result.result.gates.find((gate) => gate.id === 'db-integration')
    assert.equal(dbGate.outcome, 'passed')
    assert.equal(dbGate.result.executed, 1)
    assert.equal(result.result.toolchain.declaredContext.databaseDialect, 'mysql')
    await waitForMySqlCleanup(owner, imageId, 'success')
    observations.push({ mode: 'success', confirmed: result.confirmed, outcome: dbGate.outcome,
      executed: dbGate.result.executed, ownerResourcesRemaining: ownedMysqlContainers(owner, docker).length })

    for (const scenario of [
      { mode: 'assertion-failure', expectedReason: 'process_failed', timeoutMs: 900000 },
      { mode: 'process-failure', expectedReason: 'process_failed', timeoutMs: 900000 },
      { mode: 'timeout', expectedReason: 'process_timed_out', timeoutMs: 15000 }
    ]) {
      await configureMode(configPath, scenario.mode, scenario.timeoutMs)
      const failed = await checkProject(root, { allowNetwork: true })
      const failedGate = failed.result.gates.find((gate) => gate.id === 'db-integration')
      assert.equal(failed.confirmed, false)
      assert.equal(failedGate.reason, scenario.expectedReason)
      await waitForMySqlCleanup(owner, imageId, scenario.mode)
      observations.push({ mode: scenario.mode, confirmed: failed.confirmed, reason: failedGate.reason,
        ownerResourcesRemaining: ownedMysqlContainers(owner, docker).length })
    }
  } finally {
    for (const id of ownedMysqlContainers(owner, docker)) removeOwnedMysqlContainer(id, owner, imageId, docker)
    await rm(root, { recursive: true, force: true })
    console.log('BTH_REAL_MYSQL_EVIDENCE ' + JSON.stringify({ imageId, observations }))
  }
})
