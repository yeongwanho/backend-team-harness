import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmod, lstat, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initProject } from '../src/init-project.mjs'
import { installPack } from '../src/packs/install.mjs'
import { getPack } from '../src/packs/catalog.mjs'
import { checkProject } from '../src/runtime/backend-harness.mjs'
import { initializeGit, writeGradleFixture } from '../test-support/git-project.mjs'
import { serializeGraphReport } from '../packs/codegraph-advisory/graph-report.mjs'
import { indexProjectGraph } from '../packs/codegraph-advisory/indexer.mjs'

async function gradleProject(prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix))
  await writeGradleFixture(root)
  initializeGit(root)
  await initProject(root)
  return root
}

test('the advisory graph Pack installs safely and never replaces executed tests', async () => {
  const root = await gradleProject('bth-pack-graph-')
  await mkdir(join(root, 'src/main/java/example'), { recursive: true })
  await writeFile(join(root, 'src/main/java/example/Orders.java'), 'package example;\nimport example.Payments;\nclass Orders {}\n', 'utf8')
  await writeFile(join(root, 'src/main/java/example/Payments.java'), 'package example;\nclass Payments {}\n', 'utf8')

  const installed = await installPack(root, 'codegraph-advisory')
  const result = await checkProject(root)

  assert.equal(installed.pack.evidenceTier, 'REPORTED')
  assert.equal(result.confirmed, true, JSON.stringify(result.result, null, 2))
  assert.equal(result.result.tests.executed, 1)
  assert.equal(result.result.reported[0].metrics.nodes, 2)
  assert.equal(result.result.reported[0].metrics.edges, 1)
  assert.equal(result.result.reported[0].metrics.unresolvedImports, 0)
  assert.equal(result.result.reported[0].metrics.ambiguousImports, 0)
  assert.equal(result.result.reported[0].metrics.oversizedFiles, 0)
  const graph = JSON.parse(await readFile(join(root, '.backend-harness/generated/packs/codegraph-advisory/graph.json'), 'utf8'))
  const graphText = await readFile(join(root, '.backend-harness/generated/packs/codegraph-advisory/graph.json'), 'utf8')
  assert.equal(graph.graph.advisory, true)
  assert.deepEqual(graph.graph.forbiddenUses, ['pass-verdict', 'test-skipping'])
  assert.equal(graph.graph.edges[0].provenance, 'static-import-resolved')
  assert.equal(graph.graph.ranking.algorithm, 'weighted-pagerank')
  assert.ok(graph.graph.nodes.every((node) => Number.isFinite(node.globalRank)))
  assert.ok(Math.abs(graph.graph.nodes.reduce((sum, node) => sum + node.globalRank, 0) - 1) < 1e-9)
  assert.equal(graphText.includes('\n  "'), false)
  assert.ok(Buffer.byteLength(graphText) <= 16 * 1024 * 1024)
  await assert.rejects(installPack(root, 'codegraph-advisory'), /gate already exists|directory already exists/)
})

test('the advisory graph resolves only unique static TypeScript and Python module imports', async () => {
  const root = await gradleProject('bth-pack-polyglot-graph-')
  await mkdir(join(root, 'src/orders'), { recursive: true })
  await mkdir(join(root, 'backend/app/api'), { recursive: true })
  await mkdir(join(root, 'backend/app/services'), { recursive: true })
  await writeFile(join(root, 'src/orders/orders.service.ts'), 'export class OrdersService {}\n', 'utf8')
  await writeFile(join(root, 'src/orders/orders.controller.ts'), [
    "import { OrdersService } from './orders.service'",
    'export class OrdersController {}',
    ''
  ].join('\n'), 'utf8')
  await writeFile(join(root, 'backend/app/services/orders.py'), 'class OrdersService:\n    pass\n', 'utf8')
  await writeFile(join(root, 'backend/app/api/orders.py'), [
    'from app.services.orders import OrdersService',
    '',
    'async def list_orders():',
    '    return []',
    ''
  ].join('\n'), 'utf8')
  await installPack(root, 'codegraph-advisory')

  const result = await checkProject(root)
  assert.equal(result.confirmed, true, JSON.stringify(result.result, null, 2))
  const graph = JSON.parse(await readFile(join(root, '.backend-harness/generated/packs/codegraph-advisory/graph.json'), 'utf8'))
  assert.equal(graph.metrics['language.typescript'], 2)
  assert.equal(graph.metrics['language.python'], 2)
  const byPath = new Map(graph.graph.nodes.map((node) => [node.path, node]))
  const edges = new Set(graph.graph.edges.map((edge) => {
    const from = graph.graph.nodes.find((node) => node.id === edge.from).path
    const to = graph.graph.nodes.find((node) => node.id === edge.to).path
    return from + ' -> ' + to
  }))
  assert.ok(edges.has('src/orders/orders.controller.ts -> src/orders/orders.service.ts'))
  assert.ok(edges.has('backend/app/api/orders.py -> backend/app/services/orders.py'))
  assert.equal(byPath.get('src/orders/orders.controller.ts').language, 'typescript')
  assert.equal(byPath.get('backend/app/api/orders.py').language, 'python')
})

test('installed standalone graph runner pairs nested Python tests without changing required verification', async () => {
  const root = await gradleProject('bth-pack-parallel-tests-')
  await mkdir(join(root, 'backend/app/api'), { recursive: true })
  await mkdir(join(root, 'backend/tests/api'), { recursive: true })
  await writeFile(join(root, 'backend/app/api/records.py'), 'def records(): return []\n')
  await writeFile(join(root, 'backend/tests/api/test_records.py'), 'def test_records(): pass\n')
  await installPack(root, 'codegraph-advisory')
  const result = await checkProject(root)
  assert.equal(result.confirmed, true)
  assert.equal(result.result.tests.executed, 1, 'The required fixture gate remains separate from graph observations')
  const document = JSON.parse(await readFile(join(root, '.backend-harness/generated/packs/codegraph-advisory/graph.json'), 'utf8'))
  assert.equal(document.tool.version, '2.1.0')
  assert.equal(document.metrics['edges.tests'], 1)
  assert.equal(document.metrics.ambiguousTestPaths, 0)
  assert.equal(document.graph.edges[0].provenance, 'convention-test-path-resolved')
  assert.deepEqual(document.graph.forbiddenUses, ['pass-verdict', 'test-skipping'])
})

test('artifact nodes expose paths without reading secret-bearing artifact bodies', async () => {
  const root = await gradleProject('bth-pack-artifact-graph-')
  await mkdir(join(root, '.agents'), { recursive: true })
  await writeFile(join(root, '.agents', 'SKILL.md'), 'SHOULD_NOT_BE_INDEXED')
  await writeFile(join(root, '.env'), 'BTH_SECRET_BODY_MARKER=never-index-this')

  const report = await indexProjectGraph(root)
  const artifact = report.graph.nodes.find((node) => node.path === '.env')
  assert.ok(artifact)
  assert.equal(artifact.language, 'artifact')
  assert.ok(artifact.qualifiedName)
  assert.equal(JSON.stringify(artifact).includes('BTH_SECRET_BODY_MARKER'), false)
  assert.equal(report.graph.nodes.some((node) => node.path.startsWith('.agents/')), false)
})

test('the polyglot graph leaves ambiguous alias suffixes unresolved', async () => {
  const root = await gradleProject('bth-pack-polyglot-ambiguous-')
  await mkdir(join(root, 'src/a'), { recursive: true })
  await mkdir(join(root, 'src/b'), { recursive: true })
  await mkdir(join(root, 'src/use'), { recursive: true })
  await writeFile(join(root, 'src/a/shared.ts'), 'export class Shared {}\n', 'utf8')
  await writeFile(join(root, 'src/b/shared.ts'), 'export class Shared {}\n', 'utf8')
  await writeFile(join(root, 'src/use/consumer.ts'), "import { Shared } from '@/shared'\n", 'utf8')
  await installPack(root, 'codegraph-advisory')

  const result = await checkProject(root)
  const graph = JSON.parse(await readFile(join(root, '.backend-harness/generated/packs/codegraph-advisory/graph.json'), 'utf8'))
  assert.equal(result.confirmed, true)
  assert.equal(graph.metrics.ambiguousImports, 1)
  assert.equal(graph.graph.edges.length, 0)
})

test('the advisory graph writer replaces a report symlink without touching its target', async () => {
  const root = await gradleProject('bth-pack-graph-symlink-')
  await mkdir(join(root, 'src/main/java/example'), { recursive: true })
  await writeFile(join(root, 'src/main/java/example/App.java'), 'package example; class App {}\n', 'utf8')
  const installed = await installPack(root, 'codegraph-advisory')
  const reportDir = join(root, '.backend-harness/generated/packs/codegraph-advisory')
  const outside = await mkdtemp(join(tmpdir(), 'bth-pack-graph-outside-'))
  const victim = join(outside, 'victim.json')
  const report = join(reportDir, 'graph.json')
  await mkdir(reportDir, { recursive: true })
  await writeFile(victim, 'ORIGINAL\n', 'utf8')
  await symlink(victim, report)

  const executed = spawnSync(process.execPath, [join(root, installed.path, 'run.mjs')], {
    cwd: root,
    encoding: 'utf8'
  })

  assert.equal(executed.status, 0, executed.stderr || executed.stdout)
  assert.equal(await readFile(victim, 'utf8'), 'ORIGINAL\n')
  assert.equal((await lstat(report)).isFile(), true)
})

test('the advisory graph serializer rejects output above its loader-compatible limit', () => {
  assert.throws(
    () => serializeGraphReport({ payload: 'x'.repeat(256) }, { maximumBytes: 64 }),
    /exceeds.*64-byte safety limit/i
  )
})

test('the advisory graph refuses a report directory symlink before creating outside output', async () => {
  const root = await gradleProject('bth-pack-graph-dir-symlink-')
  const installed = await installPack(root, 'codegraph-advisory')
  const outside = await mkdtemp(join(tmpdir(), 'bth-pack-graph-dir-outside-'))
  await mkdir(join(root, '.backend-harness/generated'), { recursive: true })
  await symlink(outside, join(root, '.backend-harness/generated/packs'))

  const executed = spawnSync(process.execPath, [join(root, installed.path, 'run.mjs')], {
    cwd: root,
    encoding: 'utf8'
  })

  assert.notEqual(executed.status, 0)
  await assert.rejects(lstat(join(outside, 'codegraph-advisory')), /ENOENT/)
})

test('the advisory graph refuses to invent an edge for duplicate qualified types', async () => {
  const root = await gradleProject('bth-pack-graph-duplicate-')
  await mkdir(join(root, 'module-a/src/main/java/example'), { recursive: true })
  await mkdir(join(root, 'module-b/src/main/java/example'), { recursive: true })
  await mkdir(join(root, 'consumer/src/main/java/consumer'), { recursive: true })
  await writeFile(join(root, 'module-a/src/main/java/example/Shared.java'), 'package example; class Shared {}\n', 'utf8')
  await writeFile(join(root, 'module-b/src/main/java/example/Shared.java'), 'package example; class Shared {}\n', 'utf8')
  await writeFile(join(root, 'consumer/src/main/java/consumer/Use.java'), 'package consumer;\nimport example.Shared;\nclass Use {}\n', 'utf8')
  await installPack(root, 'codegraph-advisory')

  const result = await checkProject(root)

  assert.equal(result.confirmed, true)
  const metrics = result.result.reported[0].metrics
  assert.equal(metrics.edges, 0)
  assert.equal(metrics.ambiguousImports, 1)
  assert.equal(metrics.duplicateTypes, 1)
})

test('DB, architecture, and contract Packs add project-owned executed gates', async () => {
  for (const id of ['db-integration', 'architecture', 'contract']) {
    const root = await gradleProject('bth-pack-' + id + '-')
    const installed = await installPack(root, id)
    const config = JSON.parse(await readFile(join(root, '.backend-harness/verification.json'), 'utf8'))

    assert.equal(installed.pack.evidenceTier, 'EXECUTED')
    assert.equal(config.gates.at(-1).id, installed.gate.id)
    assert.equal(config.gates.at(-1).result.type, 'junit')
    assert.ok(config.gates.at(-1).result.reports.every((report) => !config.gates[0].result.reports.includes(report)))
    assert.match(await readFile(join(root, installed.path, 'README.md'), 'utf8'), /JUnit|integration|contract/i)
    if (id === 'architecture') {
      const kotlinSnippet = await readFile(join(root, installed.path, 'gradle-kotlin-dsl.snippet.gradle.kts'), 'utf8')
      const groovySnippet = await readFile(join(root, installed.path, 'gradle-groovy-dsl.snippet.gradle'), 'utf8')
      assert.match(kotlinSnippet, /tasks\.register<Test>\("architectureTest"\)/)
      assert.match(groovySnippet, /tasks\.register\('architectureTest', Test\)/)
      assert.match(kotlinSnippet, /excludeTestsMatching\("\*ArchitectureTest"\)/)
      assert.match(groovySnippet, /excludeTestsMatching '\*ArchitectureTest'/)
    }
  }
})

test('Pack lookup never exposes inherited Object prototype properties', () => {
  assert.equal(getPack('toString'), null)
  assert.equal(getPack('__proto__'), null)
})

test('concurrent Pack installs preserve both verification gates', async () => {
  const root = await gradleProject('bth-pack-concurrent-')

  await Promise.all([
    installPack(root, 'architecture'),
    installPack(root, 'contract')
  ])

  const config = JSON.parse(await readFile(join(root, '.backend-harness/verification.json'), 'utf8'))
  assert.deepEqual(config.gates.map((gate) => gate.id).sort(), ['architecture', 'contract', 'tests'])
  const reports = config.gates.flatMap((gate) => gate.result.reports ?? [])
  assert.equal(new Set(reports).size, reports.length)
})

test('the Gitleaks converter discards raw secret-bearing fields', async () => {
  const root = await gradleProject('bth-pack-gitleaks-')
  await installPack(root, 'secrets-gitleaks')
  const bin = join(root, 'fake-bin')
  await mkdir(bin)
  const fake = join(bin, 'gitleaks')
  await writeFile(fake, [
    '#!/bin/sh',
    'if [ "$1" = version ]; then echo "gitleaks 9.9.9"; exit 0; fi',
    'report=""',
    'previous=""',
    'for value in "$@"; do',
    '  if [ "$previous" = "--report-path" ]; then report="$value"; fi',
    '  previous="$value"',
    'done',
    'printf \'%s\\n\' \'[{"RuleID":"generic-api-key","Description":"Potential key","File":"src/config.txt","StartLine":4,"Fingerprint":"fixture","Secret":"DO-NOT-COPY","Match":"DO-NOT-COPY","Line":"DO-NOT-COPY"}]\' > "$report"',
    ''
  ].join('\n'), 'utf8')
  await chmod(fake, 0o755)

  const reportDir = join(root, '.backend-harness/generated/packs/secrets-gitleaks')
  const outside = await mkdtemp(join(tmpdir(), 'bth-pack-gitleaks-outside-'))
  const rawVictim = join(outside, 'raw-victim.json')
  const findingsVictim = join(outside, 'findings-victim.json')
  await mkdir(reportDir, { recursive: true })
  await writeFile(rawVictim, 'RAW-ORIGINAL\n', 'utf8')
  await writeFile(findingsVictim, 'FINDINGS-ORIGINAL\n', 'utf8')
  await symlink(rawVictim, join(reportDir, 'gitleaks-redacted.json'))
  await symlink(findingsVictim, join(reportDir, 'findings.json'))

  const runner = join(root, '.backend-harness/packs/secrets-gitleaks/run')
  const executed = spawnSync(runner, [], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, BTH_NODE: process.execPath, PATH: bin + ':' + process.env.PATH }
  })
  assert.equal(executed.status, 0, executed.stderr || executed.stdout)
  assert.equal(await readFile(rawVictim, 'utf8'), 'RAW-ORIGINAL\n')
  assert.equal(await readFile(findingsVictim, 'utf8'), 'FINDINGS-ORIGINAL\n')
  const reportText = await readFile(join(root, '.backend-harness/generated/packs/secrets-gitleaks/findings.json'), 'utf8')
  assert.equal((await lstat(join(reportDir, 'findings.json'))).isFile(), true)
  assert.equal(reportText.includes('DO-NOT-COPY'), false)
  const report = JSON.parse(reportText)
  assert.equal(report.findings[0].severity, 'high')
  assert.match(report.findings[0].fingerprint, /^[a-f0-9]{64}$/)
})
