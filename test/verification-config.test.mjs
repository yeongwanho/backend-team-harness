import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultVerificationConfig, parseVerificationConfig } from '../src/config/verification.mjs'

test('verification config accepts a project-owned command and structured JUnit result', () => {
  const config = parseVerificationConfig(JSON.stringify({
    schemaVersion: 1,
    gates: [{
      id: 'integration-tests',
      required: true,
      command: ['./tools/verify', '--profile', 'local'],
      inputs: ['gradle.properties', '.env.test'],
      timeoutMs: 120000,
      result: {
        type: 'junit',
        reports: ['reports/**/*.xml'],
        minimumTests: 3
      }
    }]
  }))

  assert.equal(config.gates[0].id, 'integration-tests')
  assert.equal(config.gates[0].result.minimumTests, 3)
  assert.deepEqual(config.gates[0].inputs, ['gradle.properties', '.env.test'])
  assert.equal(config.scheduling.strategy, 'configured')
  assert.equal(config.gates[0].reorderable, false)
})

test('adaptive scheduling is explicit and only required gates may opt into reordering', () => {
  const config = parseVerificationConfig(JSON.stringify({
    schemaVersion: 1,
    scheduling: {
      strategy: 'adaptive-failure-first',
      minimumObservations: 4,
      priorFailures: 1,
      priorPasses: 3
    },
    gates: [{
      id: 'tests', required: true, reorderable: true, command: ['./verify'],
      result: { type: 'junit', reports: ['reports/junit.xml'], minimumTests: 1 }
    }]
  }))

  assert.equal(config.scheduling.strategy, 'adaptive-failure-first')
  assert.equal(config.scheduling.minimumObservations, 4)
  assert.equal(config.gates[0].reorderable, true)

  assert.throws(() => parseVerificationConfig(JSON.stringify({
    schemaVersion: 1,
    scheduling: { strategy: 'adaptive-failure-first' },
    gates: [
      { id: 'tests', required: true, command: ['./verify'], result: { type: 'junit', reports: ['reports/junit.xml'] } },
      { id: 'graph', required: false, reorderable: true, command: ['./graph'], result: { type: 'observation', reports: ['reports/graph.json'] } }
    ]
  })), /only required gates may be reorderable/)
})

test('verification config rejects external executables, traversal, and exit-only success', () => {
  const base = {
    schemaVersion: 1,
    gates: [{
      id: 'tests',
      required: true,
      command: ['./verify'],
      result: { type: 'junit', reports: ['reports/*.xml'], minimumTests: 1 }
    }]
  }
  assert.throws(
    () => parseVerificationConfig(JSON.stringify({ ...base, gates: [{ ...base.gates[0], command: ['/bin/sh'] }] })),
    /must not be absolute/
  )
  assert.throws(
    () => parseVerificationConfig(JSON.stringify({ ...base, gates: [{ ...base.gates[0], command: ['../verify'] }] })),
    /cannot traverse/
  )
  assert.throws(
    () => parseVerificationConfig(JSON.stringify({
      schemaVersion: 1,
      gates: [{ id: 'compile', required: true, command: ['./verify'], result: { type: 'exit-code' } }]
    })),
    /required junit gate/
  )
})

test('Maven default uses verify and ingests Surefire plus Failsafe reports', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-maven-default-'))
  await mkdir(join(root, '.mvn/wrapper'), { recursive: true })
  await writeFile(join(root, 'pom.xml'), '<project></project>\n', 'utf8')
  await writeFile(join(root, '.mvn/wrapper/maven-wrapper.properties'), 'distributionUrl=maven.zip\n', 'utf8')
  await writeFile(join(root, '.mvn/wrapper/maven-wrapper.jar'), 'wrapper', 'utf8')

  const config = await defaultVerificationConfig(root)

  assert.deepEqual(config.gates[0].command, ['./mvnw', '-o', '-B', 'verify'])
  assert.deepEqual(config.gates[0].result.reports, [
    'target/surefire-reports/TEST-*.xml',
    'target/failsafe-reports/TEST-*.xml'
  ])
  assert.deepEqual(config.gates[0].inputs, [
    '.mvn/wrapper/maven-wrapper.properties',
    '.mvn/wrapper/maven-wrapper.jar'
  ])
})

test('Gradle default reads only the unit-test task report directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-gradle-default-'))
  await writeFile(join(root, 'build.gradle.kts'), 'plugins { java }\n', 'utf8')

  const config = await defaultVerificationConfig(root)

  assert.deepEqual(config.gates[0].result.reports, ['build/test-results/test/**/*.xml'])
})

test('findings can block while observations must remain optional', () => {
  const config = parseVerificationConfig(JSON.stringify({
    schemaVersion: 1,
    gates: [
      {
        id: 'security', required: true, command: ['./scan'],
        result: { type: 'findings', reports: ['reports/security.json'], blockingSeverities: ['high'] }
      },
      {
        id: 'tests', required: true, command: ['./verify'],
        result: { type: 'junit', reports: ['reports/junit.xml'] }
      },
      {
        id: 'graph', required: false, command: ['./graph'],
        result: { type: 'observation', reports: ['reports/graph.json'] }
      }
    ]
  }))

  assert.equal(config.gates[0].result.type, 'findings')
  assert.equal(config.gates[2].result.type, 'observation')
  assert.throws(() => parseVerificationConfig(JSON.stringify({
    schemaVersion: 1,
    gates: [
      { id: 'tests', required: true, command: ['./verify'], result: { type: 'junit', reports: ['reports/junit.xml'] } },
      { id: 'graph', required: true, command: ['./graph'], result: { type: 'observation', reports: ['reports/graph.json'] } }
    ]
  })), /required must be false/)
})
