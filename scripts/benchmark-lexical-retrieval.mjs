#!/usr/bin/env node
// Fixed local microbenchmark: no provider, source scan, dependency install or
// project gate. Process peak RSS includes Node and fixture metadata, not just
// the prior's live memory. This is not an end-to-end throughput benchmark.
import { spawnSync, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { personalizeCodeNodes } from '../src/core/lexical-retrieval.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const baselineSha = 'f10bb39b8677564c4f4d04f6144b0e78991ca9de'
const queries = { empty: '', matching: 'account symbol10', absent: 'zzunmatchedzz' }
const iterations = 3
const digest = value => createHash('sha256').update(value).digest('hex')

function legacySource() {
  return execFileSync('git', ['show', baselineSha + ':src/core/code-context.mjs'], {
    cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 10000,
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' }
  })
}

function child(variant, count, queryId) {
  if (!['legacy', 'candidate'].includes(variant) || ![10000, 100000].includes(count) || !Object.hasOwn(queries, queryId)) {
    throw new Error('Invalid fixed benchmark case.')
  }
  let prior = personalizeCodeNodes
  if (variant === 'legacy') {
    const source = legacySource()
    const constants = source.slice(source.indexOf('const STOP_TERMS ='), source.indexOf('\nfunction assertObject'))
    const functions = source.slice(source.indexOf('function lexicalTerms('), source.indexOf('\nfunction stronglyConnectedComponents('))
    if (!constants.startsWith('const STOP_TERMS') || !functions.startsWith('function lexicalTerms')) throw new Error('Legacy anchors changed.')
    // Evaluate only these pinned pure functions, not arbitrary revision input.
    prior = new Function(constants + '\n' + functions + '\nreturn personalization')()
  }
  const nodes = Array.from({ length: count }, (_, index) => ({
    path: 'src/module' + index + '/AccountComponent.java', qualifiedName: 'app.billing.AccountComponent',
    searchTerms: Array.from({ length: 128 }, (_, term) => 'symbol' + term)
  }))
  const query = queries[queryId]
  prior(nodes, query) // unmeasured warm-up, identical for both variants
  const times = []
  let result
  for (let index = 0; index < iterations; index += 1) {
    global.gc()
    const started = performance.now()
    result = prior(nodes, query)
    times.push(performance.now() - started)
  }
  if (result.weights.length !== count || result.weights.some(value => !Number.isFinite(value))) throw new Error('Invalid weights.')
  const { weights, mode, seededNodeCount, matchedTokens, seededIndexes } = result
  const sorted = [...times].sort((a, b) => a - b)
  return {
    variant, nodes: count, queryId, iterations, timesMs: times,
    medianMs: sorted[1], processPeakRssKiB: process.resourceUsage().maxRSS,
    mode, seededNodeCount, weightsSha256: digest(JSON.stringify(weights)),
    matchesSha256: digest(JSON.stringify({ matchedTokens, seededIndexes }))
  }
}

if (process.argv[2] === '--child' && process.argv.length === 6) {
  process.stdout.write(JSON.stringify(child(process.argv[3], Number(process.argv[4]), process.argv[5])) + '\n')
} else {
  if (process.argv.length !== 2) throw new Error('Run without options; cases and baseline are fixed.')
  const cases = []
  for (const count of [10000, 100000]) {
    for (const query of Object.keys(queries)) {
      const pair = []
      for (const variant of ['legacy', 'candidate']) {
        const execution = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), '--child', variant, String(count), query], {
          cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024
        })
        if (execution.status !== 0 || execution.error) throw new Error('Benchmark child failed: ' + (execution.error?.message ?? execution.stderr))
        pair.push(JSON.parse(execution.stdout))
      }
      if (pair[0].weightsSha256 !== pair[1].weightsSha256 || pair[0].matchesSha256 !== pair[1].matchesSha256) throw new Error('Fixed ordinary-term outputs diverged.')
      cases.push(...pair)
    }
  }
  const hashes = Object.fromEntries(['src/core/lexical-retrieval.mjs', 'src/core/code-context.mjs', 'scripts/benchmark-lexical-retrieval.mjs']
    .map(path => [path, digest(readFileSync(resolve(root, path)))]))
  process.stdout.write(JSON.stringify({
    schemaVersion: 1, kind: 'lexical-prior-only-synthetic-microbenchmark',
    baselineSha, baselineSourceSha256: digest(legacySource()), sourceHashes: hashes,
    nodeVersion: process.version, platform: process.platform, arch: process.arch,
    outputEquivalence: true, cases
  }, null, 2) + '\n')
}
