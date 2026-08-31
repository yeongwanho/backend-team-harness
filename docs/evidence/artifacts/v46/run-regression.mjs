// Run after provider timing has finished. Keep raw logs local and publish hashes.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const directory = dirname(fileURLToPath(import.meta.url)), root = resolve(directory, '../../../..')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const pair = JSON.parse(await readFile(join(directory, 'codex-native-spring-pair.json')))
const testPaths = (await readdir(join(root, 'test'))).filter(path => path.endsWith('.test.mjs')).sort().map(path => 'test/' + path)
const paths = [...new Set([...Object.keys(pair.sourceHashes), ...testPaths, 'docs/evidence/artifacts/v46/run-regression.mjs'])]
const sourceHashes = Object.fromEntries(await Promise.all(paths.map(async path => [path, hash(await readFile(join(root, path)))])))
const sourceChangesSinceComparison = Object.entries(pair.sourceHashes).filter(([path, expected]) => sourceHashes[path] !== expected)
  .map(([path, beforeSha256]) => ({ path, beforeSha256, afterSha256: sourceHashes[path] }))
const logs = await mkdtemp(join(tmpdir(), 'bth-v46-regression-'))
const commands = [
  ['coverage', process.execPath, ['node_modules/c8/bin/c8.js', '--all', '--include=src/**/*.mjs', '--check-coverage', '--lines', '88', '--branches', '77', '--functions', '90', '--reporter=text', process.execPath, '--test', '--test-concurrency=4', ...testPaths]],
  ['syntax', process.execPath, ['scripts/check-syntax.mjs']],
  ['diff', 'git', ['diff', '--check']]
]
const results = []
for (const [name, program, args] of commands) {
  const started = Date.now(), chunks = []
  const child = spawn(program, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', bytes => chunks.push(bytes)); child.stderr.on('data', bytes => chunks.push(bytes))
  const result = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', (exitCode, signal) => resolve({ exitCode, signal })) })
  const bytes = Buffer.concat(chunks)
  await writeFile(join(logs, name + '.log'), bytes, { flag: 'wx' })
  const entry = { name, program, args, ...result, durationMs: Date.now() - started, logSha256: hash(bytes), logBytes: bytes.length }
  if (name === 'coverage') {
    const text = bytes.toString(), summary = {}
    for (const key of ['tests', 'pass', 'fail', 'skipped']) {
      const match = text.match(new RegExp('^# ' + key + ' (\\d+)$', 'm'))
      summary[key] = match ? +match[1] : null
    }
    entry.suite = summary
    const totals = text.match(/^All files\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)/m)
    entry.coverage = totals ? { statements: +totals[1], branches: +totals[2], functions: +totals[3], lines: +totals[4] } : null
    entry.skips = text.split('\n').filter(line => /# SKIP/.test(line))
  }
  results.push(entry); console.log(JSON.stringify(entry))
  if (result.exitCode !== 0 || result.signal) break
}
for (const [path, expected] of Object.entries(sourceHashes)) assert.equal(hash(await readFile(join(root, path))), expected, 'Source changed during QA: ' + path)
const passed = results.length === commands.length && results.every(r => r.exitCode === 0 && r.signal === null) && results[0].suite.fail === 0
await writeFile(join(directory, 'qa.json'), JSON.stringify({ schemaVersion: 1, recordedAt: new Date().toISOString(),
  platform: process.platform, node: process.version, sourceHashes, sourceUnchanged: true, sourceChangesSinceComparison, passed, results,
  pairArtifactSha256: hash(await readFile(join(directory, 'codex-native-spring-pair.json'))),
  goalComplete: false, limitations: ['No actual Windows or twenty-task completion claim.',
    'Runtime changes listed separately were made after the saved provider comparison. This QA is not a new model trial.',
    'This suite runs after provider timing to avoid competing with the measured workflow.'] }, null, 2) + '\n', { flag: 'wx' })
console.log(JSON.stringify({ passed, logs }))
if (!passed) process.exitCode = 1
