import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { indexProjectGraph } from '../packs/codegraph-advisory/indexer.mjs'

async function writeSource(root, name, text, sourceSet = 'main') {
  const directory = join(root, 'src', sourceSet, 'java', 'example')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, name + '.java'), 'package example;\n' + text + '\n', 'utf8')
}

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
