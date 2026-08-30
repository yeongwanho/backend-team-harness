import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadProjectRules, parseProjectRules } from '../src/config/project-rules.mjs'

const valid = {
  schemaVersion: 1,
  rules: [
    {
      id: 'mysql-dialect',
      description: 'The service must use MySQL in its verification profile.',
      severity: 'blocker',
      assert: { fact: 'database.dialect', operator: 'equals', value: 'mysql' },
      source: { path: '.backend-harness/policies/database.md', section: 'Supported dialect' }
    },
    {
      id: 'contract-when-api-exists',
      description: 'An API-bearing service needs contract verification.',
      severity: 'warning',
      when: { fact: 'code.routes.count', operator: 'not-equals', value: 0 },
      assert: { fact: 'verification.gates', operator: 'includes', value: 'contract' },
      source: { path: '.backend-harness/policies/api.md', section: 'Contract verification' }
    }
  ]
}

test('project-rule parser accepts a strict bounded condition contract', () => {
  const parsed = parseProjectRules(JSON.stringify(valid), 'rules.json')
  assert.deepEqual(parsed, valid)
})

test('project-rule parser rejects unknown fields, invalid operators, and duplicate ids', () => {
  const unknown = structuredClone(valid)
  unknown.rules[0].command = 'rm -rf .'
  assert.throws(() => parseProjectRules(JSON.stringify(unknown), 'rules.json'), /unknown key command/)

  const operator = structuredClone(valid)
  operator.rules[0].assert.operator = 'regex'
  assert.throws(() => parseProjectRules(JSON.stringify(operator), 'rules.json'), /unsupported operator regex/)

  const duplicate = structuredClone(valid)
  duplicate.rules.push(structuredClone(duplicate.rules[0]))
  assert.throws(() => parseProjectRules(JSON.stringify(duplicate), 'rules.json'), /duplicate rule id mysql-dialect/)
})

test('project-rule parser bounds recursive conditions', () => {
  const tooDeep = structuredClone(valid)
  let condition = { fact: 'database.dialect', operator: 'present' }
  for (let index = 0; index < 12; index += 1) {
    condition = { not: condition }
  }
  tooDeep.rules[0].assert = condition
  assert.throws(() => parseProjectRules(JSON.stringify(tooDeep), 'rules.json'), /condition nesting exceeds/)
})

test('project-rule loader rejects symlinks and reports an absent optional contract', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-rules-'))
  await mkdir(join(root, '.backend-harness'), { recursive: true })
  const missing = await loadProjectRules(root)
  assert.deepEqual(missing.rules, [])
  assert.equal(missing.source, null)
  assert.match(missing.diagnostics[0], /not configured/)

  const outside = join(root, 'outside.json')
  await writeFile(outside, JSON.stringify(valid), 'utf8')
  await symlink(outside, join(root, '.backend-harness/project-rules.json'))
  await assert.rejects(loadProjectRules(root), /symbolic link/)
})

test('project-rule loader reads the exact project-contained file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-rules-'))
  await mkdir(join(root, '.backend-harness/policies'), { recursive: true })
  await writeFile(join(root, '.backend-harness/policies/database.md'), '# Database\n\n## Supported dialect\n', 'utf8')
  await writeFile(join(root, '.backend-harness/policies/api.md'), '# API\n\n## Contract verification\n', 'utf8')
  const path = join(root, '.backend-harness/project-rules.json')
  await writeFile(path, JSON.stringify(valid, null, 2), 'utf8')
  const loaded = await loadProjectRules(root)
  assert.deepEqual(loaded.rules, valid.rules)
  assert.equal(loaded.source, '.backend-harness/project-rules.json')
  assert.deepEqual(loaded.diagnostics, [])
  assert.match(await readFile(path, 'utf8'), /mysql-dialect/)
})

test('project-rule loader rejects invented or symlinked policy provenance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-rule-provenance-'))
  await mkdir(join(root, '.backend-harness/policies'), { recursive: true })
  await writeFile(join(root, '.backend-harness/project-rules.json'), JSON.stringify(valid), 'utf8')
  await writeFile(join(root, '.backend-harness/policies/database.md'), '# Database\n\n## Another section\n', 'utf8')
  await writeFile(join(root, 'outside-api.md'), '# API\n\n## Contract verification\n', 'utf8')
  await symlink(join(root, 'outside-api.md'), join(root, '.backend-harness/policies/api.md'))

  await assert.rejects(loadProjectRules(root), /source section was not found|regular non-symbolic link/)

  await writeFile(join(root, '.backend-harness/policies/database.md'), '# Database\n\n## Supported dialect\n', 'utf8')
  await assert.rejects(loadProjectRules(root), /symbolic link/)
})
