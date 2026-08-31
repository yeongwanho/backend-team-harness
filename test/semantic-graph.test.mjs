import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { indexProjectGraph } from '../packs/codegraph-advisory/indexer.mjs'
import { rankCodeContext } from '../src/core/code-context.mjs'

async function writeSource(root, name, text, sourceSet = 'main') {
  const directory = join(root, 'src', sourceSet, 'java', 'example')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, name + '.java'), 'package example;\n' + text + '\n', 'utf8')
}

async function pathFixture(t, files) {
  const root = await mkdtemp(join(tmpdir(), 'bth-parallel-test-paths-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const path of files) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), path.endsWith('.py') ? 'pass\n' : 'export {}\n')
  }
  return indexProjectGraph(root)
}

function testEdges(document) {
  const paths = new Map(document.graph.nodes.map(node => [node.id, node.path]))
  return document.graph.edges.filter(edge => edge.kind === 'tests')
    .map(edge => [paths.get(edge.from), paths.get(edge.to)]).sort()
}

test('parallel nested Python tests pair within their module and co-select the production file', async t => {
  const document = await pathFixture(t, [
    'clinic/app/api/routes/records.py', 'clinic/tests/api/routes/test_records.py',
    'clinic/app/unrelated.py', 'admin/app/api/routes/records.py',
    'admin/tests/api/routes/records_test.py', 'orphan/tests/api/routes/test_records.py'
  ])
  assert.deepEqual(testEdges(document), [
    ['admin/tests/api/routes/records_test.py', 'admin/app/api/routes/records.py'],
    ['clinic/tests/api/routes/test_records.py', 'clinic/app/api/routes/records.py']
  ])
  const result = rankCodeContext(document, 'test_records', { budgetCharacters: 1200 })
  const first = result.entries.findIndex(entry => entry.path === 'clinic/tests/api/routes/test_records.py')
  assert.ok(first >= 0)
  assert.equal(result.entries[first + 1].path, 'clinic/app/api/routes/records.py')
  assert.deepEqual(document.graph.forbiddenUses, ['pass-verdict', 'test-skipping'])
})

test('parallel nested ECMAScript paths pair without searching another module or language', async t => {
  const document = await pathFixture(t, [
    'orders/src/controllers/orders.ts', 'orders/tests/controllers/orders.spec.ts',
    'audit/app/nested/events.js', 'audit/test/nested/events.test.js',
    'other/src/controllers/orders.ts', 'other/tests/controllers/orders.spec.py'
  ])
  assert.deepEqual(testEdges(document), [
    ['audit/test/nested/events.test.js', 'audit/app/nested/events.js'],
    ['orders/tests/controllers/orders.spec.ts', 'orders/src/controllers/orders.ts']
  ])
})

test('ambiguous parallel source layouts remain unresolved and cannot invent test coverage', async t => {
  const document = await pathFixture(t, [
    'backend/app/api/accounts.py', 'backend/src/api/accounts.py',
    'backend/tests/api/test_accounts.py', 'backend/app/unrelated/accounts.py'
  ])
  assert.deepEqual(testEdges(document), [])
  assert.equal(document.metrics.ambiguousTestPaths, 1)
  assert.ok(document.findings.some(finding => finding.ruleId === 'graph.coverage.ambiguous-test-paths'))
})

test('semantic advisory graph resolves multiple declarations, inheritance, injection, tests, and SCCs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-semantic-graph-'))
  await writeSource(root, 'BaseService', 'class BaseService {}')
  await writeSource(root, 'UserPort', 'interface UserPort {}')
  await writeSource(root, 'UserService', [
    '@org.springframework.stereotype.Service',
    'class UserService',
    '  extends BaseService',
    '  implements UserPort',
    '{}'
  ].join('\n'))
  await writeSource(root, 'UserController', [
    '@org.springframework.web.bind.annotation.RestController',
    'class UserController {',
    '  private final UserService service;',
    '  UserController(UserService service) { this.service = service; }',
    '  @org.springframework.web.bind.annotation.GetMapping("/users") Object users() { return null; }',
    '}',
    'class ControllerHelper {}'
  ].join('\n'))
  await writeSource(root, 'UserServiceTest', 'class UserServiceTest {}', 'test')
  await writeSource(root, 'CycleA', 'class CycleA { private final CycleB b; CycleA(CycleB b) { this.b = b; } }')
  await writeSource(root, 'CycleB', 'class CycleB { private final CycleA a; CycleB(CycleA a) { this.a = a; } }')

  const document = await indexProjectGraph(root, { generatedAt: '2026-08-30T00:00:00.000Z', parallelism: 2 })
  const nodesByType = new Map(document.graph.nodes.flatMap((node) => node.declaredTypes.map((type) => [type, node])))
  const edgeKinds = (from, to) => document.graph.edges
    .filter((edge) => edge.from === nodesByType.get(from).id && edge.to === nodesByType.get(to).id)
    .map((edge) => edge.kind)

  assert.equal(document.metrics.nodes, 7)
  assert.equal(document.metrics.declarations, 8)
  assert.ok(nodesByType.has('example.ControllerHelper'))
  assert.deepEqual(edgeKinds('example.UserService', 'example.BaseService'), ['inherits'])
  assert.deepEqual(edgeKinds('example.UserService', 'example.UserPort'), ['implements'])
  assert.deepEqual(edgeKinds('example.UserController', 'example.UserService'), ['injects'])
  assert.deepEqual(edgeKinds('example.UserServiceTest', 'example.UserService'), ['tests'])
  assert.equal(document.metrics['edges.injects'], 3)
  assert.equal(document.metrics.cyclicComponents, 1)
  assert.equal(nodesByType.get('example.CycleA').componentId, nodesByType.get('example.CycleB').componentId)
  assert.equal(document.graph.ranking.algorithm, 'weighted-pagerank')
  assert.deepEqual(document.graph.permittedUses, ['navigation', 'review-questions', 'impact-localization'])
})

test('semantic graph names Kotlin modifier declarations instead of indexing the word class', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-semantic-kotlin-'))
  const directory = join(root, 'src/main/kotlin/example')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'Kinds.kt'), [
    'package example',
    'enum class UserKind { ACTIVE }',
    ''
  ].join('\n'), 'utf8')
  await writeFile(join(directory, 'UserEvent.kt'), 'package example\nsealed interface UserEvent\n', 'utf8')
  await writeFile(join(directory, 'UserCreated.kt'), 'package example\ndata class UserCreated(val id: Long) : UserEvent\n', 'utf8')

  const document = await indexProjectGraph(root, { generatedAt: '2026-08-30T00:00:00.000Z' })
  const nodesByType = new Map(document.graph.nodes.flatMap((node) => node.declaredTypes.map((type) => [type, node])))
  const relation = document.graph.edges.find((edge) =>
    edge.from === nodesByType.get('example.UserCreated').id && edge.to === nodesByType.get('example.UserEvent').id
  )

  assert.deepEqual([...nodesByType.keys()].sort(), ['example.UserCreated', 'example.UserEvent', 'example.UserKind'])
  assert.equal(nodesByType.get('example.UserKind').qualifiedName, 'example.UserKind')
  assert.equal(relation.kind, 'implements')
})

test('semantic graph can stay inside one backend while retaining project-relative paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-semantic-scope-'))
  await mkdir(join(root, 'backend/app'), { recursive: true })
  await mkdir(join(root, 'frontend/src'), { recursive: true })
  await writeFile(join(root, 'backend/app/users.py'), 'class User: pass\n')
  await writeFile(join(root, 'frontend/src/users.ts'), 'export class FrontendUser {}\n')

  const document = await indexProjectGraph(root, { projectPath: 'backend' })

  assert.deepEqual(document.graph.nodes.map((node) => node.path), ['backend/app/users.py'])
})

test('semantic graph pairs adjacent TypeScript production and test files without guessing across directories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-semantic-ts-test-pair-'))
  await mkdir(join(root, 'src/users'), { recursive: true })
  await writeFile(join(root, 'src/users/users.controller.ts'), 'export class UsersController {}\n')
  await writeFile(join(root, 'src/users/users.controller.spec.ts'), 'describe("UsersController", () => {})\n')

  const document = await indexProjectGraph(root)
  const byPath = new Map(document.graph.nodes.map((node) => [node.path, node]))
  const edge = document.graph.edges.find((entry) =>
    entry.from === byPath.get('src/users/users.controller.spec.ts').id &&
    entry.to === byPath.get('src/users/users.controller.ts').id &&
    entry.kind === 'tests'
  )

  assert.equal(edge.provenance, 'convention-test-path-resolved')
})
