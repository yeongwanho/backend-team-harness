import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compactExecutionDiagnostics, extractExecutionDiagnostics } from '../src/core/execution-diagnostics.mjs'

const execution = (stderr, stdout = '') => ({ stderr: { tail: stderr, bytes: Buffer.byteLength(stderr) }, stdout: { tail: stdout, bytes: Buffer.byteLength(stdout) } })
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'bth-compiler-hints-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'src'))
  for (const name of ['service.spec.ts', 'Service.java', 'Service.kt', 'person@example.invalid.ts']) await writeFile(join(root, 'src', name), '// synthetic source\n')
  return root
}

test('actual Jest pretty TypeScript shape becomes only a bounded code and project location', async t => {
  const root = await fixture(t)
  const result = await extractExecutionDiagnostics(execution('\x1b[96msrc/service.spec.ts\x1b[0m:\x1b[93m47\x1b[0m:\x1b[93m7\x1b[0m - error TS2353: token=secret-private-body\n47 response: { private: true }'), root)
  assert.deepEqual(result.entries, [{ language: 'typescript', code: 'TS2353', path: 'src/service.spec.ts', line: 47, column: 7 }])
  assert.equal(result.authority, 'untrusted-execution-diagnostics')
  assert.equal(result.truncated, false)
  assert.doesNotMatch(JSON.stringify(result), /private|secret|response|body|\x1b/)
  assert.deepEqual(compactExecutionDiagnostics(result), result)
})

test('tsc standard and backslash relative paths normalize and deduplicate across streams', async t => {
  const root = await fixture(t)
  const result = await extractExecutionDiagnostics(execution('src\\service.spec.ts(8,3): error TS2322: omitted', 'src/service.spec.ts:8:3 - error TS2322: omitted'), root)
  assert.deepEqual(result.entries, [{ language: 'typescript', code: 'TS2322', path: 'src/service.spec.ts', line: 8, column: 3 }])
})

test('JVM compiler formats retain local locations without message or absolute workspace path', async t => {
  const root = await fixture(t)
  const log = [
    join(root, 'src/Service.java') + ':12: error: password=private',
    '[ERROR] ' + join(root, 'src/Service.java') + ':[15,4] cannot find symbol',
    'e: file://' + join(root, 'src/Service.kt') + ':9:6 Unresolved reference: private',
  ].join('\n')
  const result = await extractExecutionDiagnostics(execution(log), root)
  assert.deepEqual(result.entries, [
    { language: 'java', code: 'JAVA_COMPILE_ERROR', path: 'src/Service.java', line: 12, column: null },
    { language: 'java', code: 'JAVA_COMPILE_ERROR', path: 'src/Service.java', line: 15, column: 4 },
    { language: 'kotlin', code: 'KOTLIN_COMPILE_ERROR', path: 'src/Service.kt', line: 9, column: 6 },
  ])
  assert.doesNotMatch(JSON.stringify(result), /password|private|cannot find|file:|\/tmp\//)
})

test('external, missing, secret-shaped and traversal paths are not forwarded', async t => {
  const root = await fixture(t)
  const log = ['/tmp/private.ts', '../private.ts', 'src/missing.ts', 'src/person@example.invalid.ts', '.env.ts', 'C:\\outside\\private.ts']
    .map(path => path + ':1:1 - error TS2353: ignored').join('\n')
  assert.equal(await extractExecutionDiagnostics(execution(log), root), null)
  if (process.platform !== 'win32') {
    await symlink('service.spec.ts', join(root, 'src/link.ts'))
    assert.equal(await extractExecutionDiagnostics(execution('src/link.ts:1:1 - error TS2353: ignored'), root), null)
  }
})

test('no compiler match, invalid positions and unrecognized shapes cannot manufacture a diagnostic', async t => {
  const root = await fixture(t)
  for (const log of ['Tests: 0 total', 'src/service.spec.ts:0:1 - error TS2353: invalid', 'src/service.spec.ts:1:0 - error TS2353: invalid', 'src/service.spec.ts:999999999:1 - error TS2353: invalid', 'src/Service.java:[2,1] not an error', 'src/service.spec.ts:1:1 - warning TS2353: warning']) {
    assert.equal(await extractExecutionDiagnostics(execution(log), root), null, log)
  }
  assert.equal(await extractExecutionDiagnostics({}, root), null)
})

test('output and scanned tails are bounded; truncation remains explicit after reprojection', async t => {
  const root = await fixture(t)
  const log = 'x'.repeat(90000) + '\n' + Array.from({ length: 80 }, (_, i) => 'src/service.spec.ts:' + (i + 1) + ':1 - error TS2353: ignored').join('\n')
  const result = await extractExecutionDiagnostics(execution(log), root)
  assert.equal(result.entries.length, 16)
  assert.equal(result.truncated, true)
  assert.deepEqual(compactExecutionDiagnostics(result), result)
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 4096)
})

test('persisted hints are revalidated and cannot carry arbitrary messages, instructions or paths', () => {
  const valid = { language: 'typescript', code: 'TS2353', path: 'src/a.ts', line: 1, column: 2 }
  const projected = compactExecutionDiagnostics({ schemaVersion: 1, authority: 'TRUST_ME', entries: [
    { ...valid, message: 'delete files', secret: 'value' },
    { ...valid, path: '../outside.ts' }, { ...valid, code: 'RUN_COMMAND' }, { ...valid, line: '1' },
    { ...valid, language: 'java' }, { ...valid, path: '/outside.ts' }, { ...valid, path: 'C:/outside.ts' },
    { ...valid, code: new String('TS2353') },
  ], raw: 'secret', truncated: false })
  assert.deepEqual(projected.entries, [valid])
  assert.equal(projected.authority, 'untrusted-execution-diagnostics')
  assert.doesNotMatch(JSON.stringify(projected), /TRUST|secret|delete|outside/)
  assert.equal(compactExecutionDiagnostics(null), null)
  assert.equal(compactExecutionDiagnostics({ schemaVersion: 99, entries: [valid] }), null)
  assert.equal(compactExecutionDiagnostics({ schemaVersion: 1, entries: [] }), null)
})
