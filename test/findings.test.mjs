import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectFindingsResults } from '../src/core/findings.mjs'
import { snapshotReportFiles } from '../src/core/junit.mjs'
import { checkProject } from '../src/runtime/backend-harness.mjs'
import { initProject } from '../src/init-project.mjs'
import { initializeGit } from '../test-support/git-project.mjs'

test('fresh findings reports expose bounded blocking results', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-findings-'))
  await mkdir(join(root, 'reports'))
  await writeFile(join(root, 'reports/security.json'), JSON.stringify({
    schemaVersion: 1,
    tool: { id: 'fixture-scanner', version: '1.0.0' },
    findings: [{
      ruleId: 'secret.detected',
      severity: 'high',
      message: 'A credential-like value was detected.',
      location: { path: 'src/config.txt', line: 3 }
    }],
    metrics: { filesScanned: 7 }
  }), 'utf8')

  const result = await collectFindingsResults(
    root,
    ['reports/*.json'],
    new Map(),
    { blockingSeverities: ['high', 'critical'] }
  )

  assert.equal(result.passed, false)
  assert.equal(result.reason, 'blocking_findings_detected')
  assert.equal(result.blockingCount, 1)
  assert.equal(result.metrics.filesScanned, 7)
  assert.match(result.reportDigests[0].sha256, /^[a-f0-9]{64}$/)
})

test('a fresh findings sibling cannot hide a stale earlier report', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-findings-mixed-'))
  const reports = join(root, 'reports')
  await mkdir(reports)
  const clean = (tool) => JSON.stringify({
    schemaVersion: 1,
    tool: { id: tool, version: '1' },
    findings: []
  })
  await writeFile(join(reports, 'old.json'), clean('old'), 'utf8')
  const before = await snapshotReportFiles(root, ['reports/*.json'])
  await writeFile(join(reports, 'new.json'), clean('new'), 'utf8')

  const result = await collectFindingsResults(root, ['reports/*.json'], before)

  assert.equal(result.passed, false)
  assert.equal(result.reason, 'findings_reports_mixed_freshness')
  assert.equal(result.staleReportCount, 1)
})

async function findingsProject(blocking = false) {
  const root = await mkdtemp(join(tmpdir(), 'bth-findings-project-'))
  await writeFile(join(root, 'build.gradle.kts'), 'plugins { java }\n', 'utf8')
  await writeFile(join(root, '.gitignore'), 'reports/\n', 'utf8')
  const finding = blocking
    ? '{"ruleId":"secret.detected","severity":"high","message":"credential found","location":{"path":"src/config.txt","line":1}}'
    : ''
  await writeFile(
    join(root, 'scan'),
    '#!/bin/sh\nmkdir -p reports\nprintf \'%s\\n\' \'{"schemaVersion":1,"tool":{"id":"scanner","version":"1"},"findings":[' + finding + '],"metrics":{"filesScanned":2}}\' > reports/findings.json\n',
    'utf8'
  )
  await writeFile(
    join(root, 'test-project'),
    '#!/bin/sh\nmkdir -p reports\nprintf \'%s\\n\' \'<testsuite tests="1"><testcase name="works"/></testsuite>\' > reports/junit.xml\n',
    'utf8'
  )
  await writeFile(
    join(root, 'observe'),
    '#!/bin/sh\nmkdir -p reports\nprintf \'%s\\n\' \'{"schemaVersion":1,"tool":{"id":"graph","version":"1"},"findings":[],"metrics":{"nodes":12,"edges":9}}\' > reports/graph.json\n',
    'utf8'
  )
  await Promise.all(['scan', 'test-project', 'observe'].map((path) => chmod(join(root, path), 0o755)))
  initializeGit(root)
  await initProject(root)
  await writeFile(join(root, '.backend-harness/verification.json'), JSON.stringify({
    schemaVersion: 1,
    context: { profile: 'test', databaseDialect: 'postgresql' },
    gates: [
      {
        id: 'secrets', required: true, command: ['./scan'],
        result: { type: 'findings', reports: ['reports/findings.json'], blockingSeverities: ['high', 'critical'] }
      },
      {
        id: 'tests', required: true, command: ['./test-project'],
        result: { type: 'junit', reports: ['reports/junit.xml'], minimumTests: 1 }
      },
      {
        id: 'code-graph', required: false, command: ['./observe'],
        result: { type: 'observation', reports: ['reports/graph.json'] }
      }
    ]
  }, null, 2) + '\n', 'utf8')
  return root
}

test('reported gates can block defects but cannot replace executed tests', async () => {
  const clean = await checkProject(await findingsProject(false))
  assert.equal(clean.confirmed, true, JSON.stringify(clean.result, null, 2))
  assert.equal(clean.result.tests.executed, 1)
  assert.equal(clean.result.reported.length, 2)
  assert.deepEqual(clean.result.reported.at(-1).metrics, { nodes: 12, edges: 9 })

  const blocked = await checkProject(await findingsProject(true))
  assert.equal(blocked.confirmed, false)
  assert.equal(blocked.result.gates[0].reason, 'blocking_findings_detected')
  assert.equal(blocked.result.gates[1].outcome, 'skipped')
})
