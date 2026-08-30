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
      priorPasses: 3,
      maxParallel: 2
    },
    gates: [{
      id: 'tests', required: true, reorderable: true, parallelSafe: true, resourceClass: 'unit-jvm', command: ['./verify'],
      result: { type: 'junit', reports: ['reports/junit.xml'], minimumTests: 1 }
    }]
  }))

  assert.equal(config.scheduling.strategy, 'adaptive-failure-first')
  assert.equal(config.scheduling.minimumObservations, 4)
  assert.equal(config.scheduling.maxParallel, 2)
  assert.equal(config.gates[0].reorderable, true)
  assert.equal(config.gates[0].parallelSafe, true)

  assert.throws(() => parseVerificationConfig(JSON.stringify({
    schemaVersion: 1,
    scheduling: { strategy: 'adaptive-failure-first' },
    gates: [
      { id: 'tests', required: true, command: ['./verify'], result: { type: 'junit', reports: ['reports/junit.xml'] } },
      { id: 'graph', required: false, reorderable: true, command: ['./graph'], result: { type: 'observation', reports: ['reports/graph.json'] } }
    ]
  })), /only required gates may be reorderable/)

  assert.throws(() => parseVerificationConfig(JSON.stringify({
    schemaVersion: 1,
    gates: [{
      id: 'tests', required: true, reorderable: true, parallelSafe: true, command: ['./verify'],
      result: { type: 'junit', reports: ['reports/junit.xml'] }
    }]
  })), /require an explicit resourceClass/)
})

test('gate dependencies are source-ordered, bounded, and cannot make required evidence depend on an optional observation', () => {
  const baseGates = [
    { id: 'compile', required: true, command: ['./compile'], result: { type: 'junit', reports: ['reports/compile.xml'] } },
    { id: 'integration', required: true, dependsOn: ['compile'], command: ['./integration'], result: { type: 'junit', reports: ['reports/integration.xml'] } }
  ]
  const parsed = parseVerificationConfig(JSON.stringify({ schemaVersion: 1, gates: baseGates }))
  assert.deepEqual(parsed.gates[1].dependsOn, ['compile'])

  assert.throws(() => parseVerificationConfig(JSON.stringify({
    schemaVersion: 1,
    gates: [baseGates[1], baseGates[0]]
  })), /declare dependency compile before itself/)
  assert.throws(() => parseVerificationConfig(JSON.stringify({
    schemaVersion: 1,
    gates: [{ ...baseGates[0], dependsOn: ['missing'] }, baseGates[1]]
  })), /unknown gate missing/)
  assert.throws(() => parseVerificationConfig(JSON.stringify({
    schemaVersion: 1,
    gates: [
      { id: 'advisory', required: false, command: ['./scan'], result: { type: 'observation', reports: ['reports/advisory.json'] } },
      { ...baseGates[0], dependsOn: ['advisory'] }
    ]
  })), /required gate compile cannot depend on optional gate advisory/)
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
  await writeFile(join(root, 'mvnw'), '#!/bin/sh\n', 'utf8')

  const config = await defaultVerificationConfig(root)

  assert.deepEqual(config.gates[0].command, ['./mvnw', '-o', '-B', 'verify'])
  assert.deepEqual(config.gates[0].result.reports, [
    'target/surefire-reports/TEST-*.xml',
    'target/failsafe-reports/TEST-*.xml'
  ])
  assert.deepEqual(config.gates[0].inputs, [
    '.mvn/wrapper/maven-wrapper.jar',
    '.mvn/wrapper/maven-wrapper.properties',
    'pom.xml'
  ])
})

test('Maven multi-module default binds each module build and report directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-maven-multimodule-'))
  await mkdir(join(root, '.mvn/wrapper'), { recursive: true })
  await mkdir(join(root, 'api/src/test/java/example'), { recursive: true })
  await mkdir(join(root, 'domain/src/test/java/example'), { recursive: true })
  await writeFile(join(root, 'pom.xml'), '<project><modules><module>api</module><module>domain</module></modules></project>\n', 'utf8')
  await writeFile(join(root, 'api/pom.xml'), '<project></project>\n', 'utf8')
  await writeFile(join(root, 'domain/pom.xml'), '<project></project>\n', 'utf8')
  await writeFile(join(root, 'api/src/test/java/example/ApiTest.java'), 'class ApiTest {}\n', 'utf8')
  await writeFile(join(root, 'domain/src/test/java/example/DomainTest.java'), 'class DomainTest {}\n', 'utf8')
  await writeFile(join(root, '.mvn/wrapper/maven-wrapper.properties'), 'distributionUrl=maven.zip\n', 'utf8')
  await writeFile(join(root, 'mvnw'), '#!/bin/sh\n', 'utf8')

  const config = await defaultVerificationConfig(root)

  assert.deepEqual(config.gates[0].result.reports, [
    'api/target/surefire-reports/TEST-*.xml',
    'api/target/failsafe-reports/TEST-*.xml',
    'domain/target/surefire-reports/TEST-*.xml',
    'domain/target/failsafe-reports/TEST-*.xml'
  ])
  assert.ok(config.gates[0].inputs.includes('api/pom.xml'))
  assert.ok(config.gates[0].inputs.includes('domain/pom.xml'))
})

test('Gradle default reads only the unit-test task report directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-gradle-default-'))
  await writeFile(join(root, 'build.gradle.kts'), 'plugins { java }\n', 'utf8')
  await writeFile(join(root, 'gradlew'), '#!/bin/sh\n', 'utf8')

  const config = await defaultVerificationConfig(root)

  assert.deepEqual(config.gates[0].result.reports, ['build/test-results/test/**/*.xml'])
})

test('default verification is not invented when a project-owned build wrapper is absent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-no-wrapper-default-'))
  await writeFile(join(root, 'build.gradle.kts'), 'plugins { java }\n', 'utf8')

  assert.equal(await defaultVerificationConfig(root), null)
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

test('two gates cannot claim the same report pattern', () => {
  assert.throws(() => parseVerificationConfig(JSON.stringify({
    schemaVersion: 1,
    gates: [
      { id: 'unit', required: true, command: ['./verify-unit'], result: { type: 'junit', reports: ['reports/TEST-*.xml'] } },
      { id: 'architecture', required: true, command: ['./verify-architecture'], result: { type: 'junit', reports: ['reports/TEST-*.xml'] } }
    ]
  })), /report pattern .* is owned by both unit and architecture/)
})

test('two gates cannot claim potentially overlapping wildcard report trees', () => {
  assert.throws(() => parseVerificationConfig(JSON.stringify({
    schemaVersion: 1,
    gates: [
      { id: 'unit', required: true, command: ['./verify-unit'], result: { type: 'junit', reports: ['build/test-results/**/*.xml'] } },
      { id: 'integration', required: true, command: ['./verify-integration'], result: { type: 'junit', reports: ['build/test-results/integrationTest/**/*.xml'] } }
    ]
  })), /report patterns .* may overlap/)

  const disjoint = parseVerificationConfig(JSON.stringify({
    schemaVersion: 1,
    gates: [
      { id: 'unit', required: true, command: ['./verify-unit'], result: { type: 'junit', reports: ['reports/unit/**/*.xml'] } },
      { id: 'integration', required: true, command: ['./verify-integration'], result: { type: 'junit', reports: ['reports/integration/**/*.xml'] } },
      { id: 'security', required: false, command: ['./scan'], result: { type: 'observation', reports: ['reports/security.json'] } }
    ]
  }))
  assert.equal(disjoint.gates.length, 3)
})

test('structured reports must have a dedicated directory instead of a project-root glob', () => {
  for (const report of ['**/*.xml', '*.xml', 'root-report.xml']) {
    assert.throws(() => parseVerificationConfig(JSON.stringify({
      schemaVersion: 1,
      gates: [{
        id: 'tests', required: true, command: ['./verify'],
        result: { type: 'junit', reports: [report], minimumTests: 1 }
      }]
    })), /dedicated project-relative directory/)
  }
})
