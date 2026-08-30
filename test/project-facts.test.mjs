import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadProjectFacts, mergeProjectFacts, parseProjectFacts } from '../src/config/project-facts.mjs'

const source = { path: '.backend-harness/policies/api.md', section: 'Compatibility' }

const contract = {
  schemaVersion: 1,
  providers: [
    {
      id: 'team-policy',
      version: '2026-08-30',
      authority: 'project-declared',
      facts: [
        {
          id: 'project.api.compatibility.required',
          status: 'confirmed',
          value: true,
          summary: 'API compatibility review is mandatory.',
          sources: [source]
        }
      ]
    }
  ]
}

test('project-fact parser accepts bounded project-owned facts with explicit authority', () => {
  assert.deepEqual(parseProjectFacts(JSON.stringify(contract), 'facts.json'), contract)
})

test('project-fact parser rejects non-project namespaces, unproven confirmed facts, and unbounded values', () => {
  const namespace = structuredClone(contract)
  namespace.providers[0].facts[0].id = 'database.dialect'
  assert.throws(() => parseProjectFacts(JSON.stringify(namespace), 'facts.json'), /project-owned namespace/)

  const noSource = structuredClone(contract)
  noSource.providers[0].facts[0].sources = []
  assert.throws(() => parseProjectFacts(JSON.stringify(noSource), 'facts.json'), /at least one policy source/)

  const oversized = structuredClone(contract)
  oversized.providers[0].facts[0].value = Array.from({ length: 65 }, (_, index) => 'module-' + index)
  assert.throws(() => parseProjectFacts(JSON.stringify(oversized), 'facts.json'), /at most 64 scalar entries/)
})

test('project-fact loader verifies regular Markdown sources and exact headings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-project-facts-'))
  await mkdir(join(root, '.backend-harness/policies'), { recursive: true })
  await writeFile(join(root, '.backend-harness/policies/api.md'), '# API\n\n## Compatibility\n\nKeep clients compatible.\n', 'utf8')
  await writeFile(join(root, '.backend-harness/project-facts.json'), JSON.stringify(contract), 'utf8')

  const loaded = await loadProjectFacts(root)
  assert.equal(loaded.facts.length, 1)
  assert.equal(loaded.facts[0].authority.type, 'project-declared')
  assert.match(loaded.facts[0].evidence.sources[0].sha256, /^[a-f0-9]{64}$/)

  const invented = structuredClone(contract)
  invented.providers[0].facts[0].sources[0].section = 'Invented section'
  await writeFile(join(root, '.backend-harness/project-facts.json'), JSON.stringify(invented), 'utf8')
  await assert.rejects(loadProjectFacts(root), /source section was not found/)

  const outside = join(root, 'outside.md')
  await writeFile(outside, '# API\n\n## Compatibility\n', 'utf8')
  await symlink(outside, join(root, '.backend-harness/policies/link.md'))
  const linked = structuredClone(contract)
  linked.providers[0].facts[0].sources[0].path = '.backend-harness/policies/link.md'
  await writeFile(join(root, '.backend-harness/project-facts.json'), JSON.stringify(linked), 'utf8')
  await assert.rejects(loadProjectFacts(root), /symbolic link/)
})

test('project-fact merge keeps agreement, exposes provider disagreement, and rejects built-in collisions', () => {
  const first = {
    id: 'project.api.compatibility.required',
    status: 'confirmed',
    value: true,
    summary: 'first',
    authority: { type: 'project-declared', provider: 'one', version: '1' },
    evidence: { sources: [{ ...source, sha256: 'a'.repeat(64) }] }
  }
  const agreeing = structuredClone(first)
  agreeing.authority.provider = 'two'
  const merged = mergeProjectFacts([{ id: 'git.clean', status: 'confirmed', value: true }], [first, agreeing])
  assert.equal(merged.length, 1)
  assert.equal(merged[0].status, 'confirmed')
  assert.deepEqual(merged[0].authority.providers, ['one', 'two'])

  const disagreeing = structuredClone(agreeing)
  disagreeing.value = false
  const conflicted = mergeProjectFacts([], [first, disagreeing])
  assert.equal(conflicted[0].status, 'conflict')
  assert.deepEqual(conflicted[0].value, [false, true])

  const collision = structuredClone(first)
  collision.id = 'git.clean'
  assert.throws(() => mergeProjectFacts([{ id: 'git.clean' }], [collision]), /collides with built-in fact/)
})

test('missing project-fact contract stays optional and diagnostic', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-project-facts-missing-'))
  const loaded = await loadProjectFacts(root)
  assert.deepEqual(loaded.facts, [])
  assert.match(loaded.diagnostics[0], /not configured/)
})
