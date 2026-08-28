import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initProject } from '../src/init-project.mjs'
import { createTask } from '../src/core/task-store.mjs'
import { recordEvidence } from '../src/core/evidence-store.mjs'

test('a symlinked evidence directory cannot redirect records outside the project', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-evidence-root-'))
  const outside = await mkdtemp(join(tmpdir(), 'bth-evidence-outside-'))
  await writeFile(join(root, 'build.gradle.kts'), 'plugins { java }\n', 'utf8')
  await initProject(root)
  await createTask(root, { id: 'EVIDENCE-1' })
  await symlink(outside, join(root, '.backend-harness/tasks/EVIDENCE-1/evidence'))

  await assert.rejects(
    recordEvidence(root, 'EVIDENCE-1', {
      type: 'test',
      toolId: 'none',
      outcome: 'blocked',
      confirmed: false
    }),
    /symbolic link/
  )
  assert.deepEqual(await readdir(outside), [])
})
