import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
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
  await writeFile(join(root, 'pom.xml'), '<project></project>\n', 'utf8')

  const config = await defaultVerificationConfig(root)

  assert.deepEqual(config.gates[0].command, ['./mvnw', '-o', '-B', 'verify'])
  assert.deepEqual(config.gates[0].result.reports, [
    'target/surefire-reports/*.xml',
    'target/failsafe-reports/*.xml'
  ])
})
