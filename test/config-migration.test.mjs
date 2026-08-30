import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateProjectConfig } from '../src/config/migration.mjs'

async function projectWithV1() {
  const root = await mkdtemp(join(tmpdir(), 'bth-config-migration-'))
  await writeFile(join(root, 'build.gradle'), 'plugins { id "java" }\n')
  await mkdir(join(root, '.backend-harness'), { recursive: true })
  await writeFile(join(root, '.backend-harness', 'implementation.json'), JSON.stringify({
    schemaVersion: 1,
    adapter: { id: 'team-agent', command: ['./tools/implement'], network: false, timeoutMs: 120000 },
    writePolicy: { allowedPrefixes: ['src/'], maxChangedFiles: 20, maxDiffBytes: 1048576 },
    recovery: { maxAttempts: 2 }
  }, null, 2) + '\n')
  return root
}

test('v1 command config migration is explicit, backed up, and idempotent', async () => {
  const root = await projectWithV1()
  await assert.rejects(migrateProjectConfig(root), (error) => error.code === 'config_migration_write_required')
  const migrated = await migrateProjectConfig(root, {
    allowWrite: true,
    now: () => new Date('2026-08-31T00:00:00.000Z'),
    backupSuffix: 'test'
  })
  assert.equal(migrated.changed, true)
  assert.equal(migrated.config.schemaVersion, 2)
  assert.equal(migrated.config.adapter.kind, 'command')
  assert.match(await readFile(join(root, migrated.backup), 'utf8'), /"schemaVersion": 1/)
  const second = await migrateProjectConfig(root, { allowWrite: true })
  assert.equal(second.changed, false)
  assert.equal(second.backup, null)
})
