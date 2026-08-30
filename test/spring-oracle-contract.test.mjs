import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

test('search and binder oracles pin explicit behavior assertions without accepting JUnit errors', async () => {
  const config = JSON.parse(await readFile('benchmarks/public-backend-v1/provider-comparison.json', 'utf8'))
  const tasks = config.repositories.find(r => r.id === 'spring-petclinic').tasks
  for (const id of ['spring-02-owner-search-whitespace', 'spring-05-binder-id-protection']) {
    const acceptance = tasks.find(t => t.id === id).acceptance
    assert.equal(acceptance.kind, 'fixture-tests')
    assert.equal(acceptance.files.length, 1)
    const file = acceptance.files[0]
    const content = await readFile('benchmarks/public-backend-v1/' + file.fixture, 'utf8')
    assert.equal(createHash('sha256').update(content).digest('hex'), file.sha256)
    const names = [...content.matchAll(/@Test\s+void ([a-zA-Z]+)\(/g)].map(m => m[1])
    assert.deepEqual(acceptance.cases.map(c => c.name), names)
    if (id.includes('whitespace')) {
      assert.equal(names.length, 6)
      assert.ok(content.includes('thenReturn(Page.empty())'))
    } else {
      assert.equal(names.length, 5)
      assert.match(content, /visitRequestRejectsDirectAndNestedIdsButBindsDescription[^]*?assertDoesNotThrow/)
    }
  }
})
