// Sanitize immutable raw benchmark results without changing their scores.
// node .../record-pair.mjs <task-id> <output-directory> <v36|working-tree>
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const { redactForShare } = await import(pathToFileURL(join(root, 'src/core/redaction.mjs')))
const [taskId, output, revision] = process.argv.slice(2)
if (!/^(spring|nest|fastapi)-[0-9]{2}-[a-z-]+$/.test(taskId ?? '') || !output || !['v36', 'working-tree'].includes(revision)) throw new Error('Explicit task, raw output directory and runtime revision required.')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const sourcePaths = [
  'scripts/benchmark-provider-comparison.mjs', 'src/evaluation/task-acceptance.mjs',
  'src/evaluation/provider-benchmark-runner.mjs', 'src/runtime/implementation-orchestrator.mjs',
  'src/runtime/implementation-apply.mjs', 'src/runtime/work-orchestrator.mjs',
  'src/core/implementation-preservation.mjs', 'src/adapters/java-preservation.mjs',
  ...(revision === 'working-tree' ? ['src/core/preservation-review.mjs'] : [])
]
const v36 = 'a4f0b674bf195239f276e0bf4d0d0481d7227af9'
const sourceHashes = Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, hash(revision === 'v36'
  ? execFileSync('git', ['show', v36 + ':' + path], { cwd: root }) : await readFile(join(root, path)))])))
const records = {}
for (const lane of ['bth', 'direct']) {
  const raw = await readFile(join(resolve(output), 'codex', lane, taskId + '.json'))
  const record = JSON.parse(raw)
  if (record.case.taskId !== taskId || record.case.lane !== lane) throw new Error('Raw result identity mismatch.')
  records[lane] = { originalArtifactSha256: hash(raw), ...redactForShare(record).value }
}
console.log(JSON.stringify({ schemaVersion: 1, kind: 'actual-provider-pair', recordedAt: new Date().toISOString(),
  taskId, runtime: revision === 'v36' ? { commit: v36 } : { baseCommit: v36, workingTreeSourceHashes: true },
  sourceHashes, provider: 'codex', model: 'gpt-5.6-sol', mode: 'fast', order: ['bth', 'direct'], attemptsPerLane: 1,
  records, limitations: ['One stochastic pair is not an aggregate product score.',
    'Cached tokens are included in total tokens; cost is unknown when the CLI does not report it.',
    'Rule violation counters cover recorded control policies, not proof of all team conventions.',
    'Passing required and independent tests is not authorization to apply a candidate with pending structural review.'] }, null, 2))
