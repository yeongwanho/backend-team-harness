import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanProjectManifest } from '../src/core/project-manifest.mjs'
import { inspectMysqlMigrationIndexes } from '../src/core/mysql-migration-index.mjs'

test('MySQL migration index records source-bound primary, unique, and secondary indexes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-mysql-index-'))
  const directory = join(root, 'src/main/resources/db/migration')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'V1__users.sql'), [
    'CREATE TABLE users (',
    ' id BIGINT NOT NULL, tenant_id BIGINT NOT NULL, email VARCHAR(255) NOT NULL,',
    ' PRIMARY KEY (id), UNIQUE KEY uk_users_email (email), KEY idx_users_tenant (tenant_id)',
    ') ENGINE=InnoDB;',
    'CREATE INDEX idx_users_tenant_email ON users (tenant_id, email);'
  ].join('\n'))
  const manifest = await scanProjectManifest(root, { maxDepth: Infinity, maxEntries: 1000, onLimit: 'throw', onReadError: 'throw' })
  const result = await inspectMysqlMigrationIndexes(root, manifest)
  assert.equal(result.status, 'observed')
  assert.equal(result.migrationFiles, 1)
  assert.deepEqual(result.indexes.map((entry) => [entry.kind, entry.table, entry.columns]), [
    ['unique', 'users', ['email']],
    ['primary', 'users', ['id']],
    ['index', 'users', ['tenant_id']],
    ['index', 'users', ['tenant_id', 'email']]
  ])
  assert.equal(result.authority.databaseMetadataInspected, false)
  assert.equal(result.authority.queryPlanExecuted, false)
})
