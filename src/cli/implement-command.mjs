import { configureImplementationProvider } from '../config/implementation-setup.mjs'
import { probeImplementationProvider, PROVIDER_IDS } from '../providers/model-cli.mjs'
import { applyImplementation } from '../runtime/implementation-apply.mjs'
import { cleanupImplementation, implementationStatus, resetImplementation, runImplementation } from '../runtime/implementation-orchestrator.mjs'
import {
  acknowledgedNetworkRisk,
  assertPositionalCount,
  parseArguments,
  parseJsonArrayOption,
  parseNumericOption,
  printResult
} from './options.mjs'

function printPreservationReview(result) {
  const review = result.preservationReview
  if (!review || review.status === 'not-required') return
  console.log('Structural review: ' + review.status + '; passed tests do not mean this change is approved.')
  if (review.fingerprint) console.log('Review fingerprint: ' + review.fingerprint)
  console.log('Inspect the exact diff and findings with bth implement status <id> <project> --json before apply.')
}

export async function runImplementCommand(args) {
  const [subcommand, ...rest] = args
  if (subcommand === 'configure') {
    const parsed = parseArguments(rest, {
      booleans: ['--json', '--force'],
      values: ['--model', '--mode', '--context-budget', '--max-budget-usd', '--allowed-prefixes', '--max-changed-files', '--max-diff-bytes', '--max-attempts', '--timeout-ms']
    })
    assertPositionalCount(parsed.positionals, 1, 2, 'bth implement configure <codex|claude> [path] ...')
    const [provider, path = '.'] = parsed.positionals
    if (!PROVIDER_IDS.includes(provider)) throw new Error('Implementation provider must be codex or claude.')
    const result = await configureImplementationProvider(path, provider, {
      force: parsed.flags.has('--force'), model: parsed.options.get('--model'), mode: parsed.options.get('--mode'),
      contextBudgetCharacters: parseNumericOption(parsed.options.get('--context-budget'), '--context-budget'),
      maxBudgetUsd: parseNumericOption(parsed.options.get('--max-budget-usd'), '--max-budget-usd', 'number'),
      allowedPrefixes: parseJsonArrayOption(parsed.options.get('--allowed-prefixes'), '--allowed-prefixes'),
      maxChangedFiles: parseNumericOption(parsed.options.get('--max-changed-files'), '--max-changed-files'),
      maxDiffBytes: parseNumericOption(parsed.options.get('--max-diff-bytes'), '--max-diff-bytes'),
      maxAttempts: parseNumericOption(parsed.options.get('--max-attempts'), '--max-attempts'),
      timeoutMs: parseNumericOption(parsed.options.get('--timeout-ms'), '--timeout-ms')
    })
    printResult(result, parsed.flags.has('--json'), () => {
      console.log('Configured ' + provider + ' implementation provider at ' + result.path + '.')
      console.log('Mode: ' + result.config.adapter.mode + '; allowed prefixes: ' + result.config.writePolicy.allowedPrefixes.join(', '))
      if (result.backup) console.log('Previous config backup: ' + result.backup)
      console.log('Next: bth implement providers ' + JSON.stringify(result.root))
    })
    return
  }
  if (subcommand === 'providers') {
    const parsed = parseArguments(rest, { booleans: ['--json'] })
    assertPositionalCount(parsed.positionals, 0, 1, 'bth implement providers [path] [--json]')
    const providers = []
    for (const provider of PROVIDER_IDS) {
      try { providers.push(await probeImplementationProvider(provider, { cwd: parsed.positionals[0] ?? '.' })) }
      catch (error) { providers.push({ provider, available: false, version: null, diagnostic: error instanceof Error ? error.message : String(error) }) }
    }
    printResult({ providers }, parsed.flags.has('--json'), () => {
      for (const provider of providers) {
        console.log('[' + (provider.available ? 'AVAILABLE' : 'UNAVAILABLE') + '] ' + provider.provider + (provider.version ? ' — ' + provider.version : ''))
        if (provider.diagnostic) console.log('  ' + provider.diagnostic)
      }
    })
    return
  }
  if (subcommand === 'status') {
    const parsed = parseArguments(rest, { booleans: ['--json'] })
    assertPositionalCount(parsed.positionals, 1, 2, 'bth implement status <id> [path] [--json]')
    const [id, path = '.'] = parsed.positionals
    const result = await implementationStatus(path, id)
    printResult(result, parsed.flags.has('--json'), () => {
      console.log('Implementation ' + id + ': ' + result.record.status + '.')
      console.log('Workspace: ' + result.record.workspace)
      console.log('Attempts: ' + result.record.attempts.length)
      printPreservationReview(result)
      console.log('Next: ' + result.nextAction)
    })
    if (result.preservationReview && result.preservationReview.status !== 'not-required') process.exitCode = 2
    return
  }
  if (subcommand === 'run') {
    const parsed = parseArguments(rest, { booleans: ['--json', '--allow-write', '--acknowledge-network-risk', '--allow-network'], values: ['--by'] })
    assertPositionalCount(parsed.positionals, 1, 2, 'bth implement run <id> [path] --by <actor> --allow-write [--acknowledge-network-risk] [--json]')
    const actor = parsed.options.get('--by')
    if (!actor) throw new Error('Implementation requires --by <actor>.')
    const [id, path = '.'] = parsed.positionals
    const result = await runImplementation(path, id, { actor, allowWrite: parsed.flags.has('--allow-write'), allowNetwork: acknowledgedNetworkRisk(parsed) })
    printResult(result, parsed.flags.has('--json'), () => {
      console.log('Isolated implementation ' + result.record.status + ' for task ' + id + '.')
      console.log('Workspace: ' + result.record.workspace)
      console.log('Changed files: ' + result.record.changedFiles.changedEntryCount)
      console.log('Original bound source unchanged: ' + result.record.originalBoundSourceUnchanged)
      if (result.record.verification?.failure?.code) console.log('Failure code: ' + result.record.verification.failure.code)
      printPreservationReview(result)
      console.log('Next: ' + result.nextAction)
    })
    if (result.record.status !== 'passed') process.exitCode = 1
    else if (result.preservationReview && result.preservationReview.status !== 'not-required') process.exitCode = 2
    return
  }
  if (subcommand === 'apply') {
    const parsed = parseArguments(rest, { booleans: ['--json', '--allow-write'], values: ['--by', '--accept-preservation-review', '--review-note'] })
    assertPositionalCount(parsed.positionals, 1, 2, 'bth implement apply <id> [path] --by <actor> --allow-write [--accept-preservation-review <sha256> --review-note <text>] [--json]')
    const actor = parsed.options.get('--by')
    if (!actor) throw new Error('Implementation apply requires --by <actor>.')
    const [id, path = '.'] = parsed.positionals
    const result = await applyImplementation(path, id, { actor, allowWrite: parsed.flags.has('--allow-write'),
      acceptPreservationReview: parsed.options.get('--accept-preservation-review'), reviewNote: parsed.options.get('--review-note') })
    printResult(result, parsed.flags.has('--json'), () => {
      console.log('Applied sealed implementation candidate for task ' + id + '.')
      console.log('Receipt: ' + result.receipt)
      console.log('Complete integration evidence: ' + result.integration.integrated)
      if (!result.lifecycleRecorded) console.log('WARNING: source was applied and the sealed receipt exists, but the shared task lifecycle event could not be appended.')
      console.log('Next: ' + result.nextAction)
    })
    if (!result.lifecycleRecorded) process.exitCode = 2
    return
  }
  if (subcommand === 'reset' || subcommand === 'cleanup') {
    const parsed = parseArguments(rest, { booleans: ['--json', '--discard-workspace'], values: ['--by'] })
    assertPositionalCount(parsed.positionals, 1, 2, 'bth implement ' + subcommand + ' <id> [path] --by <actor> --discard-workspace [--json]')
    const actor = parsed.options.get('--by')
    if (!actor) throw new Error('Implementation ' + subcommand + ' requires --by <actor>.')
    const [id, path = '.'] = parsed.positionals
    const result = subcommand === 'reset'
      ? await resetImplementation(path, id, { actor, discardWorkspace: parsed.flags.has('--discard-workspace') })
      : await cleanupImplementation(path, id, { actor, discardWorkspace: parsed.flags.has('--discard-workspace') })
    printResult(result, parsed.flags.has('--json'), () => {
      console.log((subcommand === 'reset' ? 'Reset isolated implementation for task ' : 'Removed integrated implementation workspace for task ') + id + '.')
      console.log('Archived record: ' + result.archivedRecord)
      if (subcommand === 'reset') {
        console.log('Reset receipt: ' + result.resetReceipt)
        console.log('Workspace removed: ' + result.workspaceRemoved)
        console.log('Next: ' + result.nextAction)
      }
    })
    return
  }
  throw new Error('Usage: bth implement <run|apply|status|reset|cleanup> ...')
}
