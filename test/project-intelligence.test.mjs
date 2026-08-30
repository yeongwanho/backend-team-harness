import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rename, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectProjectIntelligence } from '../src/adapters/project-intelligence.mjs'
import { initProject } from '../src/init-project.mjs'
import { initializeGit, writeGradleFixture } from '../test-support/git-project.mjs'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'bth-intelligence-'))
  await writeGradleFixture(root)
  await initProject(root)
  await mkdir(join(root, 'src/main/java/com/example/users'), { recursive: true })
  await mkdir(join(root, 'src/test/java/com/example/users'), { recursive: true })
  await mkdir(join(root, 'src/main/resources/db/migration'), { recursive: true })
  await writeFile(join(root, 'src/main/java/com/example/users/UserController.java'), [
    'package com.example.users;',
    'import org.springframework.web.bind.annotation.GetMapping;',
    'import org.springframework.web.bind.annotation.RestController;',
    '@RestController',
    'class UserController {',
    '  private final UserService service;',
    '  UserController(UserService service) { this.service = service; }',
    '  @GetMapping("/users") Object users() { return service.users(); }',
    '}',
    'class ControllerHelper {}',
    ''
  ].join('\n'), 'utf8')
  await writeFile(join(root, 'src/main/java/com/example/users/UserService.java'), [
    'package com.example.users;',
    'import org.springframework.stereotype.Service;',
    '@Service class UserService { Object users() { return null; } }',
    ''
  ].join('\n'), 'utf8')
  await writeFile(join(root, 'src/main/java/com/example/users/UserEntity.java'), [
    'package com.example.users;',
    'import jakarta.persistence.Entity;',
    'import jakarta.persistence.Table;',
    '@Entity',
    '@Table(name = "users")',
    'class UserEntity {}',
    ''
  ].join('\n'), 'utf8')
  await writeFile(join(root, 'src/test/java/com/example/users/UserServiceTest.java'), [
    'package com.example.users;',
    'class UserServiceTest {}',
    ''
  ].join('\n'), 'utf8')
  await writeFile(join(root, 'src/main/resources/db/migration/V1__create_users.sql'), 'create table users(id bigint primary key);\n', 'utf8')
  await writeFile(join(root, '.backend-harness/project-rules.json'), JSON.stringify({
    schemaVersion: 1,
    rules: [
      {
        id: 'api-contract-gate',
        description: 'HTTP routes require a contract verification Gate.',
        severity: 'blocker',
        when: { fact: 'code.routes.count', operator: 'not-equals', value: 0 },
        assert: { fact: 'verification.gates', operator: 'includes', value: 'contract' },
        source: { path: '.backend-harness/policies/api.md', section: 'Executable verification' }
      },
      {
        id: 'released-migration-immutable',
        description: 'Existing versioned migrations are immutable.',
        severity: 'blocker',
        assert: { fact: 'database.flyway.modified-existing', operator: 'equals', value: false },
        source: { path: '.backend-harness/policies/database.md', section: 'Migration policy' }
      },
      {
        id: 'dialect-known',
        description: 'The verification database dialect is explicit.',
        severity: 'warning',
        assert: { fact: 'database.dialect', operator: 'present' },
        source: { path: '.backend-harness/policies/database.md', section: 'Database dialect' }
      }
    ]
  }, null, 2) + '\n', 'utf8')
  initializeGit(root)
  return root
}

test('project intelligence turns source, documents, Git changes, and Gates into bounded facts', async () => {
  const root = await fixture()
  const result = await inspectProjectIntelligence(root)
  const facts = new Map(result.intelligence.facts.map((fact) => [fact.id, fact]))

  assert.equal(result.intelligence.schemaVersion, 1)
  assert.equal(facts.get('code.jvm.files').value, 4)
  assert.equal(facts.get('code.declarations.count').value, 5)
  assert.equal(facts.get('code.routes.count').value, 1)
  assert.deepEqual(facts.get('code.roles').value, ['controller', 'entity', 'service', 'test'])
  assert.deepEqual(facts.get('database.tables').value, ['users'])
  assert.equal(facts.get('database.flyway.modified-existing').value, false)
  assert.equal(facts.get('knowledge.documents.complete').value, true)
  assert.deepEqual(facts.get('verification.gates').value, ['tests'])
  assert.equal(result.intelligence.conventions.status, 'observed')
  assert.deepEqual(result.intelligence.conventions.modules, ['root'])
  assert.ok(result.intelligence.conventions.tests.pairs.some((pair) => pair.test.endsWith('UserServiceTest.java')))

  assert.equal(result.intelligence.evaluation.status, 'conflict')
  assert.deepEqual(
    result.intelligence.evaluation.results.map((entry) => [entry.id, entry.status]),
    [['api-contract-gate', 'conflict'], ['released-migration-immutable', 'confirmed'], ['dialect-known', 'unknown']]
  )
})

test('project-owned facts extend the rule vocabulary without replacing built-in authority', async () => {
  const root = await fixture()
  await writeFile(join(root, '.backend-harness/project-facts.json'), JSON.stringify({
    schemaVersion: 1,
    providers: [
      {
        id: 'team-policy',
        version: '1',
        authority: 'project-declared',
        facts: [
          {
            id: 'project.api.compatibility.required',
            status: 'confirmed',
            value: true,
            summary: 'Compatibility review is required.',
            sources: [{ path: '.backend-harness/policies/api.md', section: 'Compatibility' }]
          }
        ]
      }
    ]
  }, null, 2) + '\n', 'utf8')
  await writeFile(join(root, '.backend-harness/project-rules.json'), JSON.stringify({
    schemaVersion: 1,
    rules: [
      {
        id: 'company-api-compatibility',
        description: 'The team policy requires compatibility review.',
        severity: 'blocker',
        assert: { fact: 'project.api.compatibility.required', operator: 'equals', value: true },
        source: { path: '.backend-harness/policies/api.md', section: 'Compatibility' }
      }
    ]
  }, null, 2) + '\n', 'utf8')

  const result = await inspectProjectIntelligence(root)
  const custom = result.intelligence.facts.find((entry) => entry.id === 'project.api.compatibility.required')

  assert.equal(custom.status, 'confirmed')
  assert.equal(custom.authority.type, 'project-owned')
  assert.deepEqual(custom.authority.providers, ['team-policy'])
  assert.equal(result.intelligence.projectFacts.count, 1)
  assert.equal(result.intelligence.evaluation.results[0].outcome, 'satisfied')
})

test('project intelligence reports an edited existing Flyway migration as a source-bound conflict', async () => {
  const root = await fixture()
  await writeFile(join(root, 'src/main/resources/db/migration/V1__create_users.sql'), 'create table users(id bigint primary key, name varchar(255));\n', 'utf8')
  const result = await inspectProjectIntelligence(root)
  const fact = result.intelligence.facts.find((entry) => entry.id === 'database.flyway.modified-existing')
  const rule = result.intelligence.evaluation.results.find((entry) => entry.id === 'released-migration-immutable')

  assert.equal(fact.status, 'confirmed')
  assert.equal(fact.value, true)
  assert.equal(rule.status, 'conflict')
  assert.equal(rule.outcome, 'violated')
  assert.equal(result.intelligence.evaluation.blocking, true)
})

test('renaming an existing Flyway migration out of its migration directory remains a conflict', async () => {
  const root = await fixture()
  await mkdir(join(root, 'archive'), { recursive: true })
  await rename(
    join(root, 'src/main/resources/db/migration/V1__create_users.sql'),
    join(root, 'archive/V1__create_users.sql')
  )

  const result = await inspectProjectIntelligence(root)
  const fact = result.intelligence.facts.find((entry) => entry.id === 'database.flyway.modified-existing')
  const rule = result.intelligence.evaluation.results.find((entry) => entry.id === 'released-migration-immutable')

  assert.equal(fact.value, true)
  assert.equal(rule.outcome, 'violated')
  assert.equal(result.intelligence.evaluation.blocking, true)
})

test('editing a repeatable Flyway migration is not mislabeled as an immutable versioned migration', async () => {
  const root = await fixture()
  const repeatable = join(root, 'src/main/resources/db/migration/R__refresh_user_view.sql')
  await writeFile(repeatable, 'create view user_view as select id from users;\n', 'utf8')
  initializeGit(root)
  await writeFile(repeatable, 'create or replace view user_view as select id from users;\n', 'utf8')

  const result = await inspectProjectIntelligence(root)
  const fact = result.intelligence.facts.find((entry) => entry.id === 'database.flyway.modified-existing')
  const rule = result.intelligence.evaluation.results.find((entry) => entry.id === 'released-migration-immutable')

  assert.equal(fact.status, 'confirmed')
  assert.equal(fact.value, false)
  assert.equal(rule.outcome, 'satisfied')
})

test('nested vendor and undo Flyway migrations remain immutable once committed', async () => {
  const root = await fixture()
  const migrationDir = join(root, 'src/main/resources/db/migration/mysql/archive')
  await mkdir(migrationDir, { recursive: true })
  const undo = join(migrationDir, 'U2_1__undo_users.sql')
  await writeFile(undo, 'drop table users;\n', 'utf8')
  initializeGit(root)
  await writeFile(undo, 'drop table if exists users;\n', 'utf8')

  const result = await inspectProjectIntelligence(root)
  const fact = result.intelligence.facts.find((entry) => entry.id === 'database.flyway.modified-existing')

  assert.equal(fact.status, 'confirmed')
  assert.equal(fact.value, true)
  assert.deepEqual(fact.evidence.paths, ['src/main/resources/db/migration/mysql/archive/U2_1__undo_users.sql'])
})

test('Kotlin declaration indexing keeps the name after enum class and sealed interface modifiers', async () => {
  const root = await fixture()
  await mkdir(join(root, 'src/main/kotlin/com/example/users'), { recursive: true })
  await writeFile(join(root, 'src/main/kotlin/com/example/users/UserKind.kt'), [
    'package com.example.users',
    'enum class UserKind { ACTIVE }',
    'sealed interface UserEvent',
    'data class UserCreated(val id: Long) : UserEvent',
    ''
  ].join('\n'), 'utf8')

  const result = await inspectProjectIntelligence(root)
  const file = result.intelligence.code.files.find((entry) => entry.path.endsWith('UserKind.kt'))

  assert.deepEqual(file.declarations.map((entry) => [entry.kind, entry.name]), [
    ['enum', 'UserKind'],
    ['interface', 'UserEvent'],
    ['class', 'UserCreated']
  ])
})

test('skipped JVM symlinks downgrade source-pattern facts to unknown instead of certifying a partial index', async () => {
  const root = await fixture()
  await symlink(
    join(root, 'src/main/java/com/example/users/UserService.java'),
    join(root, 'src/main/java/com/example/users/LinkedService.java')
  )

  const result = await inspectProjectIntelligence(root)
  const files = result.intelligence.facts.find((entry) => entry.id === 'code.jvm.files')
  const routes = result.intelligence.facts.find((entry) => entry.id === 'code.routes.count')

  assert.equal(files.status, 'unknown')
  assert.equal(routes.status, 'unknown')
  assert.equal(files.evidence.complete, false)
  assert.equal(files.evidence.skippedSymlinks, 1)
})

test('an unrelated file symlink does not downgrade JVM source coverage', async () => {
  const root = await fixture()
  await symlink(join(root, 'build.gradle.kts'), join(root, 'LICENSE-link'))

  const result = await inspectProjectIntelligence(root)
  const files = result.intelligence.facts.find((entry) => entry.id === 'code.jvm.files')

  assert.equal(files.status, 'confirmed')
  assert.equal(files.evidence.skippedSymlinks, 0)
})
