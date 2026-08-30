import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { portableVerificationTemplates } from '../src/core/portable-test-discovery.mjs'
import { jestDocument } from '../test-support/jest-document.mjs'

async function fixture(t, document, script = null) {
  const root = await mkdtemp(join(tmpdir(), 'bth-jest-contract-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'node_modules/jest/bin'), { recursive: true })
  await mkdir(join(root, '.backend-harness/bin'), { recursive: true })
  await writeFile(join(root, 'package.json'), '{"type":"module"}\n')
  const runner = portableVerificationTemplates({ canGenerateVerification: true, framework: 'jest', projectPath: '.' })[0]
  await writeFile(join(root, runner.path), runner.content)
  await writeFile(join(root, 'node_modules/jest/bin/jest.js'), script ?? [
    "import { writeFileSync } from 'node:fs'",
    "const output = process.argv.find(value => value.startsWith('--outputFile=')).slice(13)",
    'writeFileSync(output, ' + JSON.stringify(JSON.stringify(document)) + ')', ''
  ].join('\n'))
  return { root, run: () => spawnSync(process.execPath, [runner.path], { cwd: root, encoding: 'utf8', timeout: 15000 }) }
}

test('generated Jest runner rejects unknown assertion status instead of minting a passed case', async (t) => {
  const { run, root } = await fixture(t, jestDocument(['focused']))
  const result = run()
  assert.notEqual(result.status, 0, result.stderr)
  await assert.rejects(readFile(join(root, '.backend-harness/local/reports/tests/junit.xml')), { code: 'ENOENT' })
})

test('generated Jest runner cannot reuse a previous raw JSON result', async (t) => {
  const { root, run } = await fixture(t, null, 'process.exitCode = 0\n')
  const directory = join(root, '.backend-harness/local/reports/tests')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'jest.json'), JSON.stringify(jestDocument()))
  const result = run()
  assert.notEqual(result.status, 0, result.stderr)
  await assert.rejects(readFile(join(directory, 'junit.xml')), { code: 'ENOENT' })
})

test('generated Jest runner rejects aggregate and suite failures', async (t) => {
  for (const mutate of [
    (d) => { d.numFailedTests = 1 },
    (d) => { d.testResults[0].status = 'failed' },
    (d) => { d.success = false },
    (d) => { d.wasInterrupted = true }
  ]) {
    const document = jestDocument()
    mutate(document)
    const { run } = await fixture(t, document)
    assert.notEqual(run().status, 0)
  }
})

test('generated Jest runner keeps the child exit authoritative despite passing JSON', async (t) => {
  const { root, run } = await fixture(t, jestDocument(['passed', 'pending']))
  const entry = join(root, 'node_modules/jest/bin/jest.js')
  await writeFile(entry, await readFile(entry, 'utf8') + '\nprocess.exitCode = 7\n')
  assert.equal(run().status, 7)
  assert.match(await readFile(join(root, '.backend-harness/local/reports/tests/junit.xml'), 'utf8'), /skipped="1"/)
})

test('generated Jest runner rejects report-directory links before running Jest', async (t) => {
  const { root, run } = await fixture(t, jestDocument())
  const outside = await mkdtemp(join(tmpdir(), 'bth-jest-outside-'))
  t.after(() => rm(outside, { recursive: true, force: true }))
  await symlink(outside, join(root, '.backend-harness/local'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.notEqual(run().status, 0)
  await assert.rejects(readFile(join(outside, 'reports/tests/junit.xml')), { code: 'ENOENT' })
})

test('generated Jest runner refuses oversized and non-file JSON outputs', async (t) => {
  for (const body of [
    "import { writeFileSync } from 'node:fs'; writeFileSync(output, Buffer.alloc(16 * 1024 * 1024 + 1))",
    "import { mkdirSync } from 'node:fs'; mkdirSync(output)"
  ]) {
    const { run } = await fixture(t, null, "const output = process.argv.find(value => value.startsWith('--outputFile=')).slice(13)\n" + body)
    assert.notEqual(run().status, 0)
  }
})

test('generated Jest runner does not print malformed raw result contents', async (t) => {
  const { run } = await fixture(t, null, [
    "import { writeFileSync } from 'node:fs'",
    "const output = process.argv.find(value => value.startsWith('--outputFile=')).slice(13)",
    "writeFileSync(output, 'SYNTHETIC_SECRET_DO_NOT_PRINT {malformed')"
  ].join('\n'))
  const result = run()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Jest JSON is malformed/)
  assert.doesNotMatch(result.stderr, /SYNTHETIC_SECRET_DO_NOT_PRINT/)
})

test('generated runner leaves external files untouched when raw JSON or XML is a symlink', { skip: process.platform === 'win32' }, async (t) => {
  const outside = await mkdtemp(join(tmpdir(), 'bth-jest-external-'))
  t.after(() => rm(outside, { recursive: true, force: true }))
  const target = join(outside, 'result.json')
  const original = JSON.stringify(jestDocument())
  await writeFile(target, original)
  const raw = await fixture(t, null, [
    "import { symlinkSync } from 'node:fs'",
    "const output = process.argv.find(value => value.startsWith('--outputFile=')).slice(13)",
    'symlinkSync(' + JSON.stringify(target) + ', output)'
  ].join('\n'))
  assert.notEqual(raw.run().status, 0)
  const xml = await fixture(t, jestDocument())
  const directory = join(xml.root, '.backend-harness/local/reports/tests')
  await mkdir(directory, { recursive: true })
  await symlink(target, join(directory, 'junit.xml'))
  assert.notEqual(xml.run().status, 0)
  assert.equal(await readFile(target, 'utf8'), original)
})

test('generated Vitest runner retains declared arguments and direct JUnit output', async (t) => {
  const { root } = await fixture(t, null)
  const runner = portableVerificationTemplates({ canGenerateVerification: true, framework: 'vitest', projectPath: '.', testArgs: ['--config', 'test/custom.mjs'] })[0]
  await writeFile(join(root, runner.path), runner.content)
  await mkdir(join(root, 'node_modules/vitest'), { recursive: true })
  await writeFile(join(root, 'node_modules/vitest/vitest.mjs'), [
    "import { writeFileSync } from 'node:fs'",
    "if (!process.argv.includes('run') || !process.argv.includes('test/custom.mjs') || !process.argv.includes('--reporter=junit')) process.exit(19)",
    "const output = process.argv.find(value => value.startsWith('--outputFile=')).slice(13)",
    "writeFileSync(output, '<testsuite tests=\"1\"><testcase name=\"example\"/></testsuite>')"
  ].join('\n'))
  const result = spawnSync(process.execPath, [runner.path], { cwd: root, encoding: 'utf8', timeout: 15000 })
  assert.equal(result.status, 0, result.stderr)
  assert.match(await readFile(join(root, '.backend-harness/local/reports/tests/junit.xml'), 'utf8'), /name="example"/)
})
