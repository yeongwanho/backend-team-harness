import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { inspectMigrationMechanisms } from '../src/core/migration-discovery.mjs'
import { scanProjectManifest } from '../src/core/project-manifest.mjs'

const nodeFiles = {
  'service/package.json': JSON.stringify({ dependencies: { typeorm: '0.3.19' }, scripts: { 'migration:run': 'typeorm migration:run -d src/database/data-source.ts' } }),
  'service/src/database/data-source.ts': "import { DataSource } from 'typeorm'; export const db = new DataSource({ password: 'PRIVATE_CONFIG_SENTINEL', migrations: [__dirname + '/migrations/**/*{.ts,.js}'] });",
  'service/src/database/migrations/1234-Init.ts': 'export class Init implements MigrationInterface { async up(queryRunner) {} async down(queryRunner) {} }'
}
const pythonFiles = {
  'backend/alembic.ini': '[alembic]\nscript_location = %(here)s/app/alembic\nsqlalchemy.url = PRIVATE_CONFIG_SENTINEL\n',
  'backend/app/alembic/env.py': 'from alembic import context\nraise RuntimeError("never execute configuration")\n',
  'backend/app/alembic/versions/abcd_init.py': 'revision: str = "abcd"\ndown_revision = None\ndef upgrade():\n    pass\ndef downgrade():\n    pass\n'
}

async function fixture(files) {
  const root = await mkdtemp(join(tmpdir(), 'bth-migration-discovery-'))
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), text)
  }
  return root
}

async function inspect(files, manifestOptions) {
  const root = await fixture(files)
  return inspectMigrationMechanisms(root, await scanProjectManifest(root, manifestOptions))
}

test('portable migration evidence links config to revisions without executing or exposing values', async () => {
  const result = await inspect({ ...nodeFiles, ...pythonFiles })
  assert.equal(result.status, 'observed')
  assert.equal(result.complete, true)
  assert.deepEqual(result.tools.map((tool) => tool.kind), ['typeorm', 'alembic'])
  assert.deepEqual(result.tools.map((tool) => tool.projectPath), ['service', 'backend'])
  assert.ok(result.tools.every((tool) => tool.revisionPaths.length === 1))
  assert.ok(result.sources.every((source) => /^[a-f0-9]{64}$/.test(source.sha256)))
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_CONFIG_SENTINEL|never execute/)
  assert.equal(result.authority.configurationExecuted, false)
  assert.equal(result.authority.databaseConnected, false)
  assert.equal(result.authority.migrationVerified, false)
})

test('TypeORM dependency alone, unlinked revisions, comments and dynamic paths are not mechanisms', async () => {
  for (const patch of [
    { 'service/package.json': '{"dependencies":{"typeorm":"0.3.19"}}' },
    { 'service/src/database/data-source.ts': 'export const db = new DataSource({migrations: []});' },
    { 'service/src/database/data-source.ts': '/* new DataSource({migrations: [__dirname + "/migrations/*.ts"]}) */' },
    { 'service/src/database/data-source.ts': 'const example = "new DataSource({migrations: []})";' },
    { 'service/src/database/data-source.ts': 'const example = "new DataSource({migrations: [__dirname + \'/migrations/*.ts\']})' },
    { 'service/src/database/data-source.ts': 'new DataSource({migrations: process.env.MIGRATION_PATHS});' },
    { 'service/src/database/data-source.ts': 'new DataSource({migrations: [__dirname + "/migrations/*.ts"], ...override});' },
    { 'service/src/database/data-source.ts': 'new DataSource({extra: {migrations: [__dirname + "/migrations/*.ts"]}});' },
    { 'service/src/database/data-source.ts': 'new DataSource({migrations: [__dirname + "/migrations/*.ts"], migrations: []});' },
    { 'service/src/database/data-source.ts': 'new DataSource({migrations: [__dirname + "/migrations/*.unrelated.ts"]});' },
    { 'service/src/database/data-source.ts': 'new DataSource({migrations: ["/external/migrations/*.ts"]});' },
    { 'service/src/database/data-source.ts': 'new DataSource({migrations: [__dirname + "/../../../../outside/*.ts"]});' },
    { 'service/src/database/data-source.ts': 'new DataSource({migrations: [__dirname + "/different/*.ts"]});' },
    { 'service/src/database/migrations/1234-Init.ts': '/* class Init implements MigrationInterface { up() {} down() {} } */' }
  ]) {
    const result = await inspect({ ...nodeFiles, ...patch })
    assert.equal(result.tools.length, 0, JSON.stringify(patch))
    assert.equal(result.complete, false)
  }
})

test('Alembic requires its linked environment and active revision functions, not examples in comments', async () => {
  for (const patch of [
    { 'backend/alembic.ini': '[other]\nscript_location = app/alembic\n' },
    { 'backend/alembic.ini': '[alembic]\nscript_location = ../../outside\n' },
    { 'backend/alembic.ini': '[alembic]\nscript_location = ${EXTERNAL}\n' },
    { 'backend/alembic.ini': '[alembic]\nscript_location = app/alembic\nscript_location = other\n' },
    { 'backend/alembic.ini': '[alembic]\nscript_location = app/alembic\nversion_locations = elsewhere\n' },
    { 'backend/app/alembic/env.py': '"""\nfrom alembic import context\n"""' },
    { 'backend/app/alembic/env.py': '"""\nfrom alembic import context\n' },
    { 'backend/app/alembic/versions/abcd_init.py': '"""\nrevision="abcd"\ndef upgrade():\n    pass\ndef downgrade():\n    pass\n"""' }
  ]) {
    const result = await inspect({ ...pythonFiles, ...patch })
    assert.equal(result.tools.length, 0, JSON.stringify(patch))
    assert.equal(result.complete, false)
  }
})

test('oversized, truncated and symlinked input remains unknown and cannot escape the project', async () => {
  const oversized = await inspect({ ...nodeFiles, 'service/src/database/data-source.ts': 'x'.repeat(256 * 1024 + 1) })
  assert.equal(oversized.complete, false)
  assert.equal(oversized.tools.length, 0)
  assert.equal((await inspect(nodeFiles, { maxEntries: 2 })).complete, false)
  const root = await fixture({ ...pythonFiles, 'outside.txt': 'PRIVATE_CONFIG_SENTINEL' })
  await symlink(join(root, 'outside.txt'), join(root, 'linked-alembic.ini'))
  const manifest = await scanProjectManifest(root)
  manifest.files.push('linked-alembic.ini', '../outside/alembic.ini')
  const result = await inspectMigrationMechanisms(root, manifest)
  assert.equal(result.complete, false)
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_CONFIG_SENTINEL/)
})

test('Alembic only links nested revisions when recursive_version_locations is explicitly true', async () => {
  const nested = { ...pythonFiles }
  nested['backend/app/alembic/versions/nested/abcd_init.py'] = nested['backend/app/alembic/versions/abcd_init.py']
  delete nested['backend/app/alembic/versions/abcd_init.py']
  assert.equal((await inspect(nested)).tools.length, 0)
  for (const value of ['false', '${RECURSIVE}', 'true\nrecursive_version_locations = false']) {
    const result = await inspect({ ...nested, 'backend/alembic.ini': nested['backend/alembic.ini'] + 'recursive_version_locations = ' + value + '\n' })
    assert.equal(result.tools.length, 0, value)
    assert.equal(result.complete, false)
  }
  const recursive = await inspect({ ...nested, 'backend/alembic.ini': nested['backend/alembic.ini'] + 'recursive_version_locations = true\n' })
  assert.equal(recursive.tools.length, 1)
  assert.deepEqual(recursive.tools[0].revisionPaths, ['backend/app/alembic/versions/nested/abcd_init.py'])
})

test('absence is a bounded not-observed result and unrelated manifests are not executed', async () => {
  const absent = await inspect({ 'package.json': '{"scripts":{"postinstall":"exit 88"}}' })
  assert.equal(absent.status, 'not-observed')
  assert.equal(absent.complete, true)
  assert.equal(absent.tools.length, 0)
  const invalid = await inspect({ 'package.json': '{broken' })
  assert.equal(invalid.complete, false)
  assert.ok(invalid.diagnostics.some((item) => item.code === 'invalid-package-json'))
})

test('non-recursive TypeORM globs do not activate nested revisions and aggregate reads stay bounded', async () => {
  const nested = { ...nodeFiles }
  nested['service/src/database/data-source.ts'] = 'new DataSource({ migrations: [__dirname + "/migrations/*.ts"] });'
  nested['service/src/database/migrations/nested/1234-Init.ts'] = nested['service/src/database/migrations/1234-Init.ts']
  delete nested['service/src/database/migrations/1234-Init.ts']
  assert.equal((await inspect(nested)).tools.length, 0)
  const many = await inspect(Object.fromEntries(Array.from({ length: 129 }, (_, index) => ['p' + index + '/package.json', '{}'])))
  assert.equal(many.complete, false)
  assert.ok(many.sources.length <= 128)
  assert.ok(many.diagnostics.some((item) => item.code === 'file-limit'))
  const large = await inspect(Object.fromEntries(Array.from({ length: 24 }, (_, index) => ['p' + index + '/package.json', JSON.stringify({ note: 'x'.repeat(200000) })])))
  assert.equal(large.complete, false)
  assert.ok(large.inspectedBytes <= 4 * 1024 * 1024)
})
