import test from 'node:test'
import assert from 'node:assert/strict'
import { compileProjectConventions } from '../src/core/convention-compiler.mjs'

function file(path, declarations, roles, annotations = [], packageName = 'example.users', contracts = {}) {
  return {
    path,
    contentSha256: path.padEnd(64, 'a').slice(0, 64),
    packageName,
    declarations: declarations.map((name) => ({ name, qualifiedName: packageName + '.' + name })),
    roles,
    annotations,
    imports: [],
    routes: contracts.routes ?? [],
    tables: contracts.tables ?? [],
    persistenceSignals: contracts.persistenceSignals ?? {}
  }
}

test('compiler derives repeated backend conventions with source citations', () => {
  const result = compileProjectConventions({ files: [
    file('users/src/main/java/example/users/UserController.java', ['UserController'], ['controller'], ['RestController'], 'example.users', {
      routes: [{ method: 'GET', path: '/users/{id}' }]
    }),
    file('users/src/main/java/example/users/AccountController.java', ['AccountController'], ['controller'], ['RestController']),
    file('users/src/main/java/example/users/UserService.java', ['UserService'], ['service'], ['Service', 'Transactional']),
    file('users/src/main/java/example/users/UserRepository.java', ['UserRepository'], ['repository'], ['Repository'], 'example.users', {
      persistenceSignals: {
        declaredQueries: 2, nativeQueries: 1, selectStarQueries: 1, leadingWildcardLikes: 0,
        lockingQueries: 1, pessimisticLocks: 0, indexDeclarations: 0, toOneAssociations: 0,
        defaultEagerToOneAssociations: 0, collectionAssociations: 0, joinFetches: 0, entityGraphs: 0
      }
    }),
    file('users/src/main/java/example/users/UserEntity.java', ['UserEntity'], ['entity'], ['Entity', 'Table'], 'example.users', {
      tables: ['users']
    }),
    file('users/src/main/java/example/users/UserResponse.java', ['UserResponse'], ['dto']),
    file('users/src/main/java/example/users/UserNotFoundException.java', ['UserNotFoundException'], ['error']),
    file('users/src/test/java/example/users/UserControllerTest.java', ['UserControllerTest'], ['test']),
    file('users/src/test/java/example/users/UserServiceTest.java', ['UserServiceTest'], ['test'])
  ] })

  assert.equal(result.status, 'observed')
  assert.deepEqual(result.modules, ['users'])
  const controller = result.layers.find((layer) => layer.role === 'controller')
  assert.equal(controller.count, 2)
  assert.deepEqual(controller.naming, [{ suffix: 'Controller', occurrences: 2, status: 'repeated' }])
  assert.ok(controller.examples.every((example) => example.path.startsWith('users/src/main/')))
  assert.deepEqual(result.transactions.roles, ['service'])
  assert.deepEqual(result.transactions.examples.map((example) => example.path), [
    'users/src/main/java/example/users/UserService.java'
  ])
  assert.deepEqual(result.persistence.roles, ['entity', 'repository'])
  assert.deepEqual(result.contracts.routes.methods, ['GET'])
  assert.deepEqual(result.contracts.tables.names, ['users'])
  assert.equal(result.database.totals.declaredQueries, 2)
  assert.equal(result.database.reviewCandidates.queryShape, 1)
  assert.equal(result.database.reviewCandidates.locking, 1)
  assert.equal(result.database.reviewCandidates.indexCoverageUnknown, true)
  assert.equal(result.database.authority.queryPlanExecuted, false)
  assert.equal(result.layers.find((layer) => layer.role === 'dto').naming[0].suffix, 'Response')
  assert.equal(result.layers.find((layer) => layer.role === 'error').naming[0].suffix, 'Exception')
  assert.ok(result.tests.pairs.some((pair) => pair.production.endsWith('UserController.java') && pair.test.endsWith('UserControllerTest.java')))
  assert.equal(result.authority.providerClaimIsEvidence, false)
  assert.equal(result.authority.verdictAuthority, false)
})

test('compiler labels single examples honestly instead of inventing a team rule', () => {
  const result = compileProjectConventions({ files: [
    file('src/main/java/example/OrderService.java', ['OrderService'], ['service'], ['Service'])
  ] })
  assert.equal(result.status, 'observed')
  assert.deepEqual(result.modules, ['root'])
  assert.deepEqual(result.layers[0].naming, [{ suffix: 'Service', occurrences: 1, status: 'single-example' }])
  assert.deepEqual(result.tests.pairs, [])
  assert.equal(result.tests.status, 'not-observed')
})

test('compiler returns an explicit unknown boundary when no supported source exists', () => {
  const result = compileProjectConventions({ files: [] })
  assert.equal(result.status, 'unknown')
  assert.deepEqual(result.layers, [])
  assert.deepEqual(result.modules, [])
  assert.match(result.limitations[0], /supported backend source/)
})

test('Python prefixes pair real modules, not empty package initializers', () => {
  const result = compileProjectConventions({ files: [
    file('backend/app/api/routes/users.py', ['read_user'], ['controller'], [], 'app.api.routes.users'),
    file('backend/app/core/__init__.py', [], [], [], 'app.core'),
    file('backend/tests/__init__.py', [], ['test'], [], 'tests'),
    file('backend/tests/api/__init__.py', [], ['test'], [], 'tests.api'),
    file('backend/tests/api/routes/test_users.py', ['test_missing_user'], ['test', 'controller'], [], 'tests.api.routes.test_users')
  ] })
  assert.deepEqual(result.tests.pairs.map(({ production, test }) => [production, test]), [
    ['backend/app/api/routes/users.py', 'backend/tests/api/routes/test_users.py']
  ])
  assert.equal(result.tests.count, 3)
  assert.equal(result.layers.find(layer => layer.role === 'controller').count, 1)
})

test('test pairing is module-aware, deduplicated and independent of input order', () => {
  const files = [
    file('hospital/src/main/java/example/UserService.java', ['UserService'], ['service']),
    file('admin/src/main/java/example/UserService.java', ['UserService'], ['service']),
    file('hospital/src/test/java/example/UserServiceTest.java', ['UserServiceTest'], ['test']),
    file('admin/src/test/java/example/UserServiceTest.java', ['UserServiceTest'], ['test'])
  ]
  const expected = [
    ['admin/src/main/java/example/UserService.java', 'admin/src/test/java/example/UserServiceTest.java'],
    ['hospital/src/main/java/example/UserService.java', 'hospital/src/test/java/example/UserServiceTest.java']
  ]
  for (const order of [files, [...files].reverse()]) {
    assert.deepEqual(compileProjectConventions({ files: order }).tests.pairs.map(pair => [pair.production, pair.test]), expected)
  }
})

test('test pairing resolves package or parallel directory evidence and leaves ties unknown', () => {
  const files = [
    file('src/main/kotlin/a/UserService.kt', ['UserService'], ['service'], [], 'a'),
    file('src/main/kotlin/b/UserService.kt', ['UserService'], ['service'], [], 'b'),
    file('src/test/kotlin/b/UserServiceTest.kt', ['UserServiceTest'], ['test'], [], 'b'),
    file('src/test/kotlin/other/UserServiceTest.kt', ['UserServiceTest'], ['test'], [], 'other'),
    file('src/a/users.ts', [], ['controller'], [], ''),
    file('src/b/users.ts', [], ['controller'], [], ''),
    file('tests/b/users.test.ts', [], ['test'], [], ''),
    file('tests/other/users.spec.ts', [], ['test'], [], ''),
    file('tests/index.ts', [], ['test'], [], ''),
    file('src/index.ts', [], [], [], '')
  ]
  const result = compileProjectConventions({ files }).tests
  assert.deepEqual(result.pairs.map(pair => [pair.production, pair.test]), [
    ['src/b/users.ts', 'tests/b/users.test.ts'],
    ['src/main/kotlin/b/UserService.kt', 'src/test/kotlin/b/UserServiceTest.kt']
  ])
  assert.equal(result.ambiguousTestFileCount, 2)
  assert.equal(result.unmatchedTestFileCount, 1)
})

test('tests do not invent production transactions, routes, tables or query risks', () => {
  const result = compileProjectConventions({ files: [
    file('src/main/java/example/UserService.java', ['UserService'], ['service']),
    file('src/test/java/example/UserServiceTest.java', ['UserServiceTest'], ['test', 'service', 'repository'], ['Transactional'], 'example', {
      routes: [{ method: 'POST', path: '/fixture' }], tables: ['fixture'],
      persistenceSignals: { declaredQueries: 3, selectStarQueries: 3, transactionalAnnotations: 1 }
    })
  ] })
  assert.equal(result.layers.find(layer => layer.role === 'service').count, 1)
  assert.ok(!result.layers.some(layer => layer.role === 'repository'))
  assert.equal(result.layers.find(layer => layer.role === 'test').count, 1)
  assert.equal(result.transactions.status, 'not-observed')
  assert.equal(result.persistence.status, 'not-observed')
  assert.equal(result.contracts.routes.count, 0)
  assert.deepEqual(result.contracts.tables.names, [])
  assert.equal(result.database.totals.declaredQueries, 0)
})

test('a huge ambiguous name bucket stays bounded and cannot match another language', () => {
  const files = Array.from({ length: 500 }, (_, index) => file('src/p' + index + '/users.py', [], ['controller'], [], ''))
  files.push(file('tests/test_users.py', [], ['test'], [], ''))
  files.push(file('src/unique.ts', [], ['controller'], [], ''))
  files.push(file('tests/test_unique.py', [], ['test'], [], ''))
  const result = compileProjectConventions({ files }).tests
  assert.deepEqual(result.pairs, [])
  assert.equal(result.candidateLimitExceededTestFileCount, 1)
  assert.equal(result.ambiguousTestFileCount, 1)
  assert.equal(result.unmatchedTestFileCount, 1)
})
