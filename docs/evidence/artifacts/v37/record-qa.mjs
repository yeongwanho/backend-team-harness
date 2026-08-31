import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const coverage = await readFile('/tmp/bth-v37-coverage.log', 'utf8')
const mutation = await readFile('/tmp/bth-v37-mutation.log', 'utf8')
const count = key => Number(coverage.match(new RegExp('^# ' + key + ' (\\d+)$', 'm'))?.[1])
const totals = coverage.match(/^All files\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)/m)
if (!totals || count('fail') !== 0 || !Number.isFinite(count('tests'))) throw new Error('Full-suite success evidence missing.')
const install = await readFile('/tmp/bth-v37-install.log', 'utf8')
const windows = await readFile('/tmp/bth-v37-windows-contract.log', 'utf8')
const auditRaw = await readFile('/tmp/bth-v37-audit.json', 'utf8')
const audit = JSON.parse(auditRaw)
const paths = ['src/core/preservation-review.mjs', 'src/core/implementation-preservation.mjs',
  'src/runtime/implementation-orchestrator.mjs', 'src/runtime/implementation-apply.mjs', 'src/runtime/work-orchestrator.mjs',
  'src/cli.mjs', 'src/cli/implement-command.mjs', 'scripts/mutation-smoke.mjs', 'scripts/benchmark-provider-comparison.mjs']
const sourceHashes = Object.fromEntries(await Promise.all(paths.map(async path => [path, hash(await readFile(join(root, path)))])))
console.log(JSON.stringify({ schemaVersion: 1, recordedAt: new Date().toISOString(), platform: process.platform, node: process.version,
  sourceHashes, tests: { total: count('tests'), passed: count('pass'), failed: count('fail'), skipped: count('skipped'), logSha256: hash(coverage) },
  coverage: { lines: Number(totals[4]), branches: Number(totals[2]), functions: Number(totals[3]) },
  mutation: { killed: (mutation.match(/^KILLED /gm) ?? []).length, logSha256: hash(mutation), limitation: 'Curated mutation smoke, not exhaustive mutation coverage.' },
  installSmoke: { passed: install.includes('Installed package smoke passed'), logSha256: hash(install) },
  windowsContract: { passed: /# pass 8\n/.test(windows) && /# fail 0\n/.test(windows), logSha256: hash(windows), actualWindowsExecution: false },
  productionDependencies: { vulnerabilities: audit.metadata.vulnerabilities, logSha256: hash(auditRaw) },
  skipped: ['real MySQL container E2E', 'separate Maven/Gradle cold-cache E2E', 'real Windows provider JSON execution', 'real Windows descendant termination'],
  limitations: ['Passing unit tests and curated mutations does not prove production adoption or all requirement semantics.',
    'Actual public Spring runs are recorded separately; never use these skips as PASS.'] }, null, 2))
