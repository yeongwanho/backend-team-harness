import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { checkImplementationPreservation } from '../src/core/implementation-preservation.mjs'
import { compareJavaPreservation } from '../src/adapters/java-preservation.mjs'
import { extractExecutionDiagnostics } from '../src/core/execution-diagnostics.mjs'
import { implementationRecoveryInput } from '../src/core/implementation-verification.mjs'

const args = process.argv.slice(2)
const option = name => args[args.indexOf(name) + 1]
for (const flag of ['--workspace', '--mirror', '--historical-base', '--historical-target', '--formatter-root', '--formatter-log']) {
  if (!args.includes(flag) || !option(flag) || option(flag).startsWith('--')) throw new Error('Required: ' + flag)
}
const workspace = option('--workspace'), mirror = option('--mirror')
const git = (root, argv) => execFileSync('git', ['-C', root, ...argv], { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 5000 })
const sha256 = value => createHash('sha256').update(value).digest('hex')
const head = git(workspace, ['rev-parse', 'HEAD']).trim()
const diffBefore = sha256(git(workspace, ['diff', '--binary', head, '--']))
const paths = git(workspace, ['diff', '--name-only', '-z', head, '--']).split('\0').filter(Boolean)
const timings = [], candidates = []
for (let i = 0; i < 3; i++) {
  const start = performance.now()
  candidates.push(await checkImplementationPreservation(workspace, head, paths))
  timings.push(performance.now() - start)
}
const skipStart = performance.now()
for (let i = 0; i < 100; i++) await checkImplementationPreservation('/nonexistent', '', ['service.ts'])
const noJavaMeanMs = (performance.now() - skipStart) / 100
const historicalBase = option('--historical-base'), historicalTarget = option('--historical-target')
const historicalPaths = git(mirror, ['diff', '--name-only', '-z', historicalBase, historicalTarget, '--']).split('\0').filter(path => path.endsWith('.java'))
const historical = historicalPaths.map(path => ({ path, ...compareJavaPreservation(
  git(mirror, ['show', historicalBase + ':' + path]), git(mirror, ['show', historicalTarget + ':' + path])
) }))
const formatterLog = await readFile(option('--formatter-log'), 'utf8')
const formatter = await extractExecutionDiagnostics({ stderr: { tail: formatterLog, bytes: Buffer.byteLength(formatterLog) } }, option('--formatter-root'))
const recovery = implementationRecoveryInput({ confirmed: false, gates: [{ id: 'maven-test', outcome: 'failed', executionDiagnostics: formatter }] })
const candidateDiffUnchanged = diffBefore === sha256(git(workspace, ['diff', '--binary', head, '--']))
const sourceHashes = Object.fromEntries(await Promise.all([
  'src/adapters/java-preservation.mjs', 'src/adapters/java-preservation-worker.mjs',
  'src/core/implementation-preservation.mjs', 'src/core/execution-diagnostics.mjs',
  'src/core/implementation-verification.mjs', 'src/runtime/implementation-orchestrator.mjs',
  'src/runtime/implementation-apply.mjs', 'vendor/tree-sitter-java/tree-sitter-java.wasm'
].map(async path => [path, sha256(await readFile(new URL('../' + path, import.meta.url)))])))
const passed = candidates.every(value => value.status === 'review-required') &&
  candidates.every(value => JSON.stringify(value) === JSON.stringify(candidates[0])) &&
  historical.every(value => ['clear', 'not-applicable'].includes(value.status)) && historical.length > 0 &&
  formatter?.entries.length === 3 && recovery.failedGates[0]?.executionDiagnostics?.entries.length === 3 &&
  git(workspace, ['rev-parse', 'HEAD']).trim() === head && candidateDiffUnchanged
console.log(JSON.stringify({ schemaVersion: 1, kind: 'read-only-retained-candidate-preservation', passed,
  providerCalls: 0, runtimeBehavioralTests: 0, candidateBaseCommit: head, candidateDiffUnchanged, sourceHashes,
  candidate: candidates[0], repeatedResultsIdentical: candidates.every(value => JSON.stringify(value) === JSON.stringify(candidates[0])),
  timingsMs: timings, noJavaMeanMs, historicalBase, historicalTarget, historical,
  formatterLogSha256: createHash('sha256').update(formatterLog).digest('hex'), formatter,
  recoveredFormatterEntries: recovery.failedGates[0]?.executionDiagnostics?.entries.length ?? 0,
  limitations: ['Structural review signal, not a semantic bug proof.', 'Existing v35 scores and candidate source are unchanged.', 'No paid model recovery or real Windows execution in this check.']
}, null, 2))
if (!passed) process.exitCode = 1
