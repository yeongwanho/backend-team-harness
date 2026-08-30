import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { canonicalJson } from '../src/core/canonical-json.mjs'
import { redactForShare } from '../src/core/redaction.mjs'

test('canonical JSON hashes equivalent objects identically', () => {
  const left = { z: 1, nested: { b: 2, a: 1 } }
  const right = { nested: { a: 1, b: 2 }, z: 1 }

  assert.equal(canonicalJson(left), canonicalJson(right))
  assert.equal(
    createHash('sha256').update(canonicalJson(left)).digest('hex'),
    createHash('sha256').update(canonicalJson(right)).digest('hex')
  )
})

test('shareable records redact project paths and common credential forms', () => {
  const result = redactForShare({
    failure: '/work/service/build failed ' + 'pass' + 'word=hunter2',
    endpoint: 'mysql://' + 'user' + ':pa' + 'ss@localhost/db',
    token: ['gh', 'p_', 'abcdefghijklmnopqrstuvwxyz123456'].join('')
  }, { projectRoot: '/work/service' })

  assert.equal(result.value.failure, '<project>/build failed password=<redacted>')
  assert.equal(result.value.endpoint, 'mysql://<redacted>@localhost/db')
  assert.equal(result.value.token, '<redacted-github-token>')
  assert.equal(result.redactionsApplied, 4)
})

test('shareable records redact underscore-delimited environment credential names', () => {
  const result = redactForShare({
    database: 'DB_PASSWORD=hunter2',
    mysql: 'MYSQL_ROOT_PASSWORD=root-secret',
    api: 'MY_API_KEY=api-secret'
  })

  assert.equal(result.value.database, 'DB_PASSWORD=<redacted>')
  assert.equal(result.value.mysql, 'MYSQL_ROOT_PASSWORD=<redacted>')
  assert.equal(result.value.api, 'MY_API_KEY=<redacted>')
  assert.equal(result.redactionsApplied, 3)
})
