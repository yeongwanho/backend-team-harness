import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

test('retrieval probe rejects incomplete, duplicate and unrelated options before Git or a provider can run', () => {
  for (const args of [[], ['--cache'], ['--provider', 'codex'], ['--cache', 'one', '--cache', 'two'], ['--output', '--cache']]) {
    const result = spawnSync(process.execPath, [resolve('scripts/benchmark-retrieval-query.mjs'), ...args], {
      encoding: 'utf8', timeout: 5000, env: { PATH: '' }
    })
    assert.equal(result.error, undefined)
    assert.equal(result.signal, null)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Expected --cache|Duplicate option|--cache and --output are required/)
    assert.doesNotMatch(result.stderr, /spawn git|ENOENT|provider is unavailable/)
  }
})
