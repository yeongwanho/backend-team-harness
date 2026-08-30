#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { initProject } from './init-project.mjs'
import { doctorProject } from './doctor.mjs'
import {
  advanceTask,
  createTask,
  handoffTaskWriter,
  loadTask,
  updateTaskContext,
  updateTaskPlan
} from './core/task-store.mjs'
import { captureConfiguredSourceBinding, checkProject, verifyTask } from './runtime/backend-harness.mjs'
import { listPacks } from './packs/catalog.mjs'
import { installPack } from './packs/install.mjs'
import { updateTestBaseline } from './baseline.mjs'
import { withProjectVerificationLock } from './core/project-lock.mjs'
import { interviewStatus } from './runtime/interview-orchestrator.mjs'
import { exportApprovedPlan } from './runtime/plan-export.mjs'
import { diagnoseTaskFailure } from './runtime/failure-diagnosis.mjs'
import { inspectProjectIntelligence, warmProjectIntelligenceCache } from './adapters/project-intelligence.mjs'
import { runWork } from './runtime/work-orchestrator.mjs'
import { runImplementCommand } from './cli/implement-command.mjs'
import { printHelp } from './cli/help.mjs'
import { runConfigCommand } from './cli/config-command.mjs'
import { runInterviewCommand } from './cli/interview-command.mjs'
import { asBthError } from './core/errors.mjs'
import {
  acknowledgedNetworkRisk,
  assertPositionalCount,
  parseArguments,
  parseJsonObjectOption,
  printResult
} from './cli/options.mjs'

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

function printFailureTail(result) {
  const gate = result?.gates?.find((entry) => entry.outcome === 'failed')
  const tail = gate?.process?.stderr?.tail || gate?.process?.stdout?.tail
  if (tail?.trim()) {
    console.log('Failure output (last 8 KiB):')
    console.log(tail.trimEnd())
  }
}

async function runInit(args) {
  const parsed = parseArguments(args, { booleans: ['--force', '--allow-unversioned'] })
  assertPositionalCount(parsed.positionals, 0, 1, 'bth init [path] [--force] [--allow-unversioned]')
  const force = parsed.flags.has('--force')
  if (force && parsed.positionals.length === 0) {
    throw new Error('`--force` requires an explicit project path; refusing to overwrite the current directory implicitly.')
  }
  const result = await initProject(parsed.positionals[0] ?? '.', {
    force,
    allowUnversioned: parsed.flags.has('--allow-unversioned')
  })
  console.log('Initialized backend harness contract at ' + result.root)
  console.log(
    'Created: ' + result.created.length +
    ', updated: ' + result.updated.length +
    ', preserved: ' + result.skipped.length +
    ', backups: ' + result.backups.length
  )
  console.log(
    'Detected: build=' + result.detection.build +
    ', framework=' + result.detection.framework +
    ', test-modules=' + result.detection.testModules.length
  )
  for (const diagnostic of result.detection.diagnostics) {
    console.log('[UNKNOWN] ' + diagnostic)
  }
}

async function runDoctor(args) {
  const parsed = parseArguments(args, { booleans: ['--json'] })
  assertPositionalCount(parsed.positionals, 0, 1, 'bth doctor [path] [--json]')
  const result = await doctorProject(parsed.positionals[0] ?? '.')
  printResult(result, parsed.flags.has('--json'), () => {
    console.log('Backend Team Harness doctor: ' + result.root)
    for (const check of result.checks) {
      console.log('[' + check.status.toUpperCase() + '] ' + check.id + ' — ' + check.message)
    }
  })
  if (!result.healthy) {
    process.exitCode = 1
  }
}

async function runIntelligence(args) {
  const [subcommand, ...rest] = args
  if (subcommand === 'warm-cache') {
    const parsed = parseArguments(rest, { booleans: ['--json'] })
    assertPositionalCount(parsed.positionals, 0, 1, 'bth intelligence warm-cache [path] [--json]')
    const result = await warmProjectIntelligenceCache(parsed.positionals[0] ?? '.')
    printResult(result, parsed.flags.has('--json'), () => {
      if (result.written) {
        console.log('Warmed JVM intelligence cache for ' + result.sourceFingerprint + '.')
        console.log('Cache: ' + result.path + ' (' + result.metrics.files + ' files, ' + result.bytes + ' bytes)')
      } else {
        console.log('JVM intelligence cache was not written: ' + result.diagnostic)
      }
    })
    if (!result.written) {
      process.exitCode = 1
    }
    return
  }
  if (subcommand !== 'inspect') {
    throw new Error('Usage: bth intelligence <inspect|warm-cache> ...')
  }
  const parsed = parseArguments(rest, { booleans: ['--json', '--no-cache'] })
  assertPositionalCount(parsed.positionals, 0, 1, 'bth intelligence inspect [path] [--no-cache] [--json]')
  const result = await inspectProjectIntelligence(parsed.positionals[0] ?? '.', {
    useCache: !parsed.flags.has('--no-cache')
  })
  printResult(result, parsed.flags.has('--json'), () => {
    const intelligence = result.intelligence
    console.log('Project intelligence: ' + intelligence.overallStatus.toUpperCase())
    console.log('Source: ' + intelligence.sourceFingerprint)
    console.log('Harness contract: ' + result.verification.status.toUpperCase() + (result.verification.inferredFromSource ? ' (read-only inference only)' : ''))
    console.log('JVM cache: ' + intelligence.code.cache.status.toUpperCase())
    console.log('Facts: ' + intelligence.facts.length + ' (' + intelligence.projectFacts.count + ' project-owned), rules: ' + intelligence.rules.count)
    for (const rule of intelligence.evaluation.results) {
      console.log('[' + rule.status.toUpperCase() + '] ' + rule.id + ' — ' + rule.description)
    }
    for (const diagnostic of intelligence.rules.diagnostics) {
      console.log('[UNKNOWN] ' + diagnostic)
    }
    for (const diagnostic of intelligence.projectFacts.diagnostics) {
      console.log('[UNKNOWN] ' + diagnostic)
    }
    for (const diagnostic of result.verification.diagnostics) {
      console.log('[UNKNOWN] ' + diagnostic)
    }
  })
  if (result.intelligence.evaluation.blocking) {
    process.exitCode = 1
  }
}

async function runTask(args) {
  const [subcommand, ...rest] = args
  if (!subcommand) {
    throw new Error('Usage: bth task <create|context|plan|status|handoff|export-plan|advance> ...')
  }

  if (subcommand === 'create') {
    const parsed = parseArguments(rest, {
      booleans: ['--json'],
      values: ['--title', '--context', '--by']
    })
    assertPositionalCount(parsed.positionals, 1, 2, 'bth task create <id> [path] [--title <text>] [--context <text>] [--by <actor>] [--json]')
    const [id, path = '.'] = parsed.positionals
    const result = await withProjectVerificationLock(path, undefined, () => createTask(path, {
      id,
      title: parsed.options.get('--title'),
      context: parsed.options.get('--context'),
      actor: parsed.options.get('--by')
    }))
    printResult(result, parsed.flags.has('--json'), () => {
      console.log('Created task ' + id + ' in state ' + result.record.state + '.')
      console.log('Shared task record: ' + result.taskPath)
    })
    return
  }

  if (subcommand === 'status') {
    const parsed = parseArguments(rest, { booleans: ['--json'] })
    assertPositionalCount(parsed.positionals, 1, 2, 'bth task status <id> [path] [--json]')
    const [id, path = '.'] = parsed.positionals
    const result = await loadTask(path, id)
    printResult(result, parsed.flags.has('--json'), () => {
      console.log('Task ' + id + ': ' + result.record.state + ' (revision ' + result.record.revision + ')')
      console.log('Active writer: ' + (result.record.writerLease?.actor ?? 'unclaimed'))
      console.log('Last evidence: ' + (result.record.lastEvidenceId ?? 'none'))
    })
    return
  }

  if (subcommand === 'handoff') {
    const parsed = parseArguments(rest, {
      booleans: ['--json'],
      values: ['--from', '--to', '--reason']
    })
    assertPositionalCount(
      parsed.positionals,
      1,
      2,
      'bth task handoff <id> [path] --from <actor> --to <actor> --reason <text> [--json]'
    )
    const fromActor = parsed.options.get('--from')
    const toActor = parsed.options.get('--to')
    const reason = parsed.options.get('--reason')
    if (!fromActor || !toActor || !reason) {
      throw new Error('Task writer handoff requires --from, --to, and --reason.')
    }
    const [id, path = '.'] = parsed.positionals
    const result = await withProjectVerificationLock(path, undefined, () => handoffTaskWriter(path, id, {
      fromActor,
      toActor,
      reason
    }))
    printResult(result, parsed.flags.has('--json'), () => {
      console.log('Task ' + id + ' writer handed off from ' + fromActor + ' to ' + toActor + '.')
      console.log('Writer epoch: ' + result.record.writerLease.epoch)
    })
    return
  }

  if (subcommand === 'export-plan') {
    const parsed = parseArguments(rest, { booleans: ['--json'], values: ['--context-budget'] })
    assertPositionalCount(parsed.positionals, 1, 2, 'bth task export-plan <id> [path] [--context-budget <characters>] [--json]')
    const [id, path = '.'] = parsed.positionals
    const budgetText = parsed.options.get('--context-budget')
    const contextBudget = budgetText === undefined ? 4000 : Number(budgetText)
    if (!Number.isSafeInteger(contextBudget) || (contextBudget !== 0 && (contextBudget < 64 || contextBudget > 100_000))) {
      throw new Error('--context-budget must be 0 or an integer between 64 and 100000.')
    }
    const result = await exportApprovedPlan(path, id, { contextBudget })
    printResult(result, parsed.flags.has('--json'), () => {
      console.log('Exported approved plan ' + result.planDigest + ' for task ' + id + '.')
      console.log('Authority: read-only plan; no write or completion verdict authority.')
      console.log(
        result.codeContext.status === 'available'
          ? 'Code context: ' + result.codeContext.entries.length + ' advisory paths (' + result.codeContext.budget.usedCharacters + '/' + result.codeContext.budget.limitCharacters + ' characters).'
          : 'Code context: unavailable (' + result.codeContext.reason + ').'
      )
    })
    return
  }

  if (subcommand === 'context' || subcommand === 'plan') {
    const parsed = parseArguments(rest, {
      booleans: ['--json'],
      values: ['--text', '--by', '--reason']
    })
    assertPositionalCount(
      parsed.positionals,
      1,
      2,
      'bth task ' + subcommand + ' <id> [path] --text <text> --by <actor> [--reason <text>] [--json]'
    )
    const text = parsed.options.get('--text')
    const actor = parsed.options.get('--by')
    if (!text || !actor) {
      throw new Error('Task ' + subcommand + ' requires both --text and --by.')
    }
    const [id, path = '.'] = parsed.positionals
    const update = subcommand === 'context' ? updateTaskContext : updateTaskPlan
    const result = await withProjectVerificationLock(path, undefined, () => update(path, id, text, {
      actor,
      reason: parsed.options.get('--reason')
    }))
    printResult(result, parsed.flags.has('--json'), () => {
      console.log('Updated task ' + id + ' ' + subcommand + ' at revision ' + result.record.revision + '.')
      if (result.event.audit.approvalInvalidated) {
        console.log('Previous approval was invalidated; task returned to ' + result.record.state + '.')
      }
    })
    return
  }

  if (subcommand === 'advance') {
    const parsed = parseArguments(rest, {
      booleans: ['--approve', '--json'],
      values: ['--by', '--reason']
    })
    assertPositionalCount(
      parsed.positionals,
      2,
      3,
      'bth task advance <id> <state> [path] --by <actor> [--approve] [--reason <text>] [--json]'
    )
    const actor = parsed.options.get('--by')
    if (!actor) {
      throw new Error('Task transitions require --by <actor>.')
    }
    const [id, state, path = '.'] = parsed.positionals
    const targetState = state.toUpperCase()
    if (targetState === 'VERIFYING') {
      throw new Error('VERIFYING is owned by `bth verify`; generic task advance cannot start or bypass executable verification.')
    }
    const result = await withProjectVerificationLock(path, undefined, async () => {
      const currentTask = await loadTask(path, id)
      const currentSource = ['PLAN_APPROVED', 'DONE'].includes(targetState)
        ? await captureConfiguredSourceBinding(path)
        : null
      const currentSourceFingerprint = currentSource?.fingerprint
      const compatibleSourceFingerprints = currentSource?.legacyFingerprint
        ? [currentSource.legacyFingerprint]
        : []
      const transitionOptions = targetState === 'DONE'
        ? { currentSourceFingerprint, compatibleSourceFingerprints }
        : {}
      const currentPlanArtifactSha256 = targetState === 'PLAN_APPROVED'
        ? currentTask.record.planArtifactSha256
        : undefined
      if (currentPlanArtifactSha256) {
        const interview = await interviewStatus(path, id)
        if (interview.record.artifactDigests?.plan !== currentPlanArtifactSha256) {
          throw new Error('Canonical plan artifact stale or inconsistent with the task record.')
        }
      }
      return advanceTask(path, id, targetState, {
        actor,
        reason: parsed.options.get('--reason'),
        implementationMode: targetState === 'IMPLEMENTING'
          ? (currentTask.record.implementationMode === 'isolated' ? 'isolated' : 'manual')
          : undefined,
        approved: parsed.flags.has('--approve'),
        currentSourceFingerprint,
        compatibleSourceFingerprints,
        currentPlanArtifactSha256
      }, transitionOptions)
    })
    printResult(result, parsed.flags.has('--json'), () => {
      console.log(
        result.applied
          ? 'Task ' + id + ' advanced to ' + result.record.state + '.'
          : 'Task ' + id + ' stayed at ' + result.record.state + ': ' + result.audit.reason
      )
    })
    if (!result.applied) {
      process.exitCode = 1
    }
    return
  }

  throw new Error('Unknown task command: ' + subcommand)
}

async function runDiagnose(args) {
  const parsed = parseArguments(args, { booleans: ['--json'] })
  assertPositionalCount(parsed.positionals, 1, 2, 'bth diagnose <id> [path] [--json]')
  const [id, path = '.'] = parsed.positionals
  const result = await diagnoseTaskFailure(path, id)
  printResult(result, parsed.flags.has('--json'), () => {
    console.log('Diagnosis for ' + id + ' (' + result.taskState + '):')
    for (const gate of result.failedGates) {
      console.log('- Gate ' + gate.id + ': ' + (gate.reason ?? gate.outcome))
    }
    for (const action of result.nextActions) {
      console.log('- ' + action)
    }
  })
}

async function runPack(args) {
  const [subcommand, ...rest] = args
  if (subcommand === 'list') {
    const parsed = parseArguments(rest, { booleans: ['--json'] })
    assertPositionalCount(parsed.positionals, 0, 0, 'bth pack list [--json]')
    const packs = listPacks()
    printResult(packs, parsed.flags.has('--json'), () => {
      for (const pack of packs) {
        console.log(pack.id + ' [' + pack.evidenceTier + '] — ' + pack.purpose)
      }
    })
    return
  }
  if (subcommand === 'install') {
    const parsed = parseArguments(rest, { booleans: ['--json'] })
    assertPositionalCount(parsed.positionals, 1, 2, 'bth pack install <id> [path] [--json]')
    const [id, path = '.'] = parsed.positionals
    const result = await installPack(path, id)
    printResult(result, parsed.flags.has('--json'), () => {
      console.log('Installed Pack ' + result.pack.id + ' at ' + result.path + '.')
      console.log('Added verification gate: ' + result.gate.id + ' [' + result.pack.evidenceTier + ']')
      console.log('Previous verification config backup: ' + result.backup)
    })
    return
  }
  throw new Error('Usage: bth pack <list|install> ...')
}

async function runBaseline(args) {
  const [subcommand, ...rest] = args
  if (subcommand !== 'update') {
    throw new Error('Usage: bth baseline update [path] [--json]')
  }
  const parsed = parseArguments(rest, { booleans: ['--json'] })
  assertPositionalCount(parsed.positionals, 0, 1, 'bth baseline update [path] [--json]')
  const result = await updateTestBaseline(parsed.positionals[0] ?? '.')
  printResult(result, parsed.flags.has('--json'), () => {
    if (!result.changed) {
      console.log('Test baseline already covers the latest passed run.')
      return
    }
    for (const change of result.changes) {
      console.log('Raised ' + change.gateId + ' executed-test minimum: ' + change.previous + ' → ' + change.next)
    }
    console.log('Previous verification config backup: ' + result.backup)
  })
}

async function runVerify(args) {
  const parsed = parseArguments(args, { booleans: ['--json', '--acknowledge-network-risk', '--allow-network'] })
  assertPositionalCount(parsed.positionals, 1, 2, 'bth verify <id> [path] [--acknowledge-network-risk] [--json]')
  const [id, path = '.'] = parsed.positionals
  const result = await verifyTask(path, id, { allowNetwork: acknowledgedNetworkRisk(parsed) })
  printResult(result, parsed.flags.has('--json'), () => {
    console.log('Verification ' + (result.confirmed ? 'confirmed' : 'failed') + ' for task ' + id + '.')
    console.log('Task state: ' + result.task.state)
    console.log('Evidence: ' + result.evidence.path)
    console.log('Shared run record: ' + result.run.path)
    if (result.evidence.record.result?.tests) {
      const tests = result.evidence.record.result.tests
      console.log('Tests: ' + tests.tests + ', executed: ' + tests.executed + ', failures: ' + tests.failures + ', errors: ' + tests.errors + ', skipped: ' + tests.skipped)
    }
    if (result.evidence.record.error) {
      console.log('Failure: ' + result.evidence.record.error.message)
    }
    if (!result.confirmed) {
      printFailureTail(result.execution)
    }
  })
  if (!result.confirmed) {
    process.exitCode = 1
  }
}

async function runCheck(args) {
  const parsed = parseArguments(args, { booleans: ['--json', '--acknowledge-network-risk', '--allow-network'] })
  assertPositionalCount(parsed.positionals, 0, 1, 'bth check [path] [--acknowledge-network-risk] [--json]')
  const result = await checkProject(parsed.positionals[0] ?? '.', { allowNetwork: acknowledgedNetworkRisk(parsed) })
  printResult(result, parsed.flags.has('--json'), () => {
    console.log('Project verification ' + (result.confirmed ? 'passed.' : 'failed.'))
    console.log('Source: ' + result.sourceBinding.fingerprint)
    console.log('Local run record: ' + result.run.path)
    if (result.result?.tests) {
      const tests = result.result.tests
      console.log('Tests: ' + tests.tests + ', executed: ' + tests.executed + ', failures: ' + tests.failures + ', errors: ' + tests.errors + ', skipped: ' + tests.skipped)
    }
    if (result.failure) {
      console.log('Failure: ' + result.failure.message)
    }
    if (!result.confirmed) {
      printFailureTail(result.result)
    }
  })
  if (!result.confirmed) {
    process.exitCode = 1
  }
}

async function runWorkCommand(args) {
  const parsed = parseArguments(args, {
    booleans: ['--approve', '--run', '--allow-write', '--json', '--acknowledge-network-risk', '--allow-network'],
    values: ['--id', '--by', '--decisions']
  })
  assertPositionalCount(
    parsed.positionals,
    1,
    2,
    'bth work <requirement> [path] [--id <id>] [--by <actor>] [--decisions <json>] [--approve] [--run --allow-write] [--acknowledge-network-risk] [--json]'
  )
  const [requirement, path = '.'] = parsed.positionals
  const actor = parsed.options.get('--by') ?? process.env.USER ?? process.env.USERNAME ?? 'developer'
  const result = await runWork(path, {
    requirement,
    taskId: parsed.options.get('--id'),
    actor,
    decisions: parseJsonObjectOption(parsed.options.get('--decisions'), '--decisions')
  }, {
    approve: parsed.flags.has('--approve'),
    run: parsed.flags.has('--run'),
    allowWrite: parsed.flags.has('--allow-write'),
    allowNetwork: acknowledgedNetworkRisk(parsed)
  })
  printResult(result, parsed.flags.has('--json'), () => {
    console.log('Work ' + result.taskId + ': ' + result.status + '.')
    if (result.status === 'needs-decisions') {
      console.log('Only these decisions remain:')
      for (const question of result.questions) {
        console.log('- ' + question.id + ': ' + question.prompt + (question.choices ? ' [' + question.choices.join('|') + ']' : ''))
      }
    } else if (result.status === 'blocked') {
      console.log('Blocking project rules: ' + result.blockers.map((blocker) => blocker.id + '=' + blocker.status).join(', '))
    } else {
      console.log('Plan: ' + result.planPath)
      console.log('Task state: ' + result.task.state)
    }
    console.log('Next: ' + result.nextAction)
  })
  if (result.status === 'blocked' || result.status === 'implementation-failed') process.exitCode = 1
}

async function run() {
  const [, , command, ...args] = process.argv
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp()
    return
  }
  if (command === 'version' || command === '--version' || command === '-v') {
    console.log(VERSION)
    return
  }
  if (command === 'init') {
    await runInit(args)
    return
  }
  if (command === 'doctor') {
    await runDoctor(args)
    return
  }
  if (command === 'intelligence') {
    await runIntelligence(args)
    return
  }
  if (command === 'check') {
    await runCheck(args)
    return
  }
  if (command === 'work') {
    await runWorkCommand(args)
    return
  }
  if (command === 'task') {
    await runTask(args)
    return
  }
  if (command === 'interview') {
    await runInterviewCommand(args)
    return
  }
  if (command === 'pack') {
    await runPack(args)
    return
  }
  if (command === 'baseline') {
    await runBaseline(args)
    return
  }
  if (command === 'verify') {
    await runVerify(args)
    return
  }
  if (command === 'diagnose') {
    await runDiagnose(args)
    return
  }
  if (command === 'implement') {
    await runImplementCommand(args)
    return
  }
  if (command === 'config') {
    await runConfigCommand(args)
    return
  }
  throw new Error('Unknown command: ' + command)
}

run().catch((error) => {
  const command = process.argv[2]?.replace(/[^a-z0-9_-]/gi, '_').toLowerCase() || 'cli'
  const failure = asBthError(error, command + '_failed')
  if (process.argv.slice(2).includes('--json')) {
    console.error(JSON.stringify({
      error: {
        code: failure.code,
        message: failure.message,
        details: failure.details
      }
    }))
  } else {
    console.error(failure.message)
  }
  process.exitCode = 1
})
