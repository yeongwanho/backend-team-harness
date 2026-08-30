import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'

test('model-free controls reject malformed options before Git or execution', () => {
  for (const args of [[], ['--provider', 'codex'], ['--cache'], ['--task', 'task-one', '--task', 'task-one'], ['--cache', 'a', '--cache', 'b']]) {
    const result = spawnSync(process.execPath, [resolve('scripts/acceptance-controls.mjs'), ...args], {
      encoding: 'utf8', timeout: 5000, env: { PATH: '' },
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Expected --cache|--cache, --output|Invalid or duplicate task|Duplicate option/)
    assert.doesNotMatch(result.stderr, /spawn.*git|ENOENT|provider is unavailable/)
  }
})

test('model-free controls preserve existing evidence and reject unknown tasks before Git', async t => {
  const root = await mkdtemp(resolve(tmpdir(), 'bth-controls-options-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const output = resolve(root, 'existing.json')
  await writeFile(output, 'preserve me')
  const invoke = (path, task) => spawnSync(process.execPath, [resolve('scripts/acceptance-controls.mjs'), '--cache', root, '--output', path, '--task', task], {
    encoding: 'utf8', timeout: 5000, env: { PATH: '' },
  })
  const existing = invoke(output, 'nest-06-user-email-conflict')
  assert.equal(existing.status, 1)
  assert.match(existing.stderr, /Output already exists/)
  assert.equal(await readFile(output, 'utf8'), 'preserve me')
  const missing = invoke(resolve(root, 'new.json'), 'task-does-not-exist')
  assert.equal(missing.status, 1)
  assert.match(missing.stderr, /No independent acceptance is configured/)
  assert.doesNotMatch(missing.stderr, /spawn.*git|ENOENT/)
})
