#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { initProject } from './init-project.mjs'
import { doctorProject } from './doctor.mjs'
import {
  advanceTask,
  createTask,
  loadTask,
  updateTaskContext,
  updateTaskPlan
} from './core/task-store.mjs'
import { captureConfiguredSourceBinding, checkProject, verifyTask } from './runtime/backend-harness.mjs'
import { listPacks } from './packs/catalog.mjs'
import { installPack } from './packs/install.mjs'
import { updateTestBaseline } from './baseline.mjs'
import { withProjectVerificationLock } from './core/project-lock.mjs'
import {
  answerInterview,
  completeInterview,
  interviewStatus,
  rebindInterview,
  reviseInterview,
  startInterview
} from './runtime/interview-orchestrator.mjs'
import { exportApprovedPlan } from './runtime/plan-export.mjs'
import { diagnoseTaskFailure } from './runtime/failure-diagnosis.mjs'
import { inspectProjectIntelligence } from './adapters/project-intelligence.mjs'
import { cleanupImplementation, implementationStatus, resetImplementation, runImplementation } from './runtime/implementation-orchestrator.mjs'

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

function printHelp() {
  console.log([
    'Backend Team Harness',
    '',
    'Usage:',
    '  bth init [path] [--force] [--allow-unversioned]',
    '  bth doctor [path] [--json]',
    '  bth intelligence inspect [path] [--json]',
    '  bth check [path] [--allow-network] [--json]',
    '  bth pack list [--json]',
    '  bth pack install <id> [path] [--json]',
    '  bth baseline update [path] [--json]',
    '  bth task create <id> [path] [--title <text>] [--context <text>] [--json]',
    '  bth task context <id> [path] --text <text> --by <actor> [--json]',
    '  bth task plan <id> [path] --text <text> --by <actor> [--json]',
    '  bth task status <id> [path] [--json]',
    '  bth task export-plan <id> [path] [--context-budget <characters>] [--json]',
    '  bth task advance <id> <state> [path] --by <actor> [--approve] [--reason <text>] [--json]',
    '  bth interview start <id> [path] --requirement <text> --by <actor> [--title <text>] [--json]',
    '  bth interview answer <id> [path] --question <id> --text <text> --by <actor> [--status <answered|unknown|conflict>] [--json]',
    '  bth interview revise <id> [path] --question <id> --text <text> --by <actor> [--status <answered|unknown|conflict>] [--json]',
    '  bth interview rebind <id> [path] --by <actor> [--json]',
    '  bth interview status <id> [path] [--json]',
    '  bth interview finalize <id> [path] --by <actor> [--json]',
    '  bth implement run <id> [path] --by <actor> --allow-write [--allow-network] [--json]',
    '  bth implement status <id> [path] [--json]',
    '  bth implement reset <id> [path] --by <actor> --discard-workspace [--json]',
    '  bth implement cleanup <id> [path] --by <actor> --discard-workspace [--json]',
    '  bth verify <id> [path] [--allow-network] [--json]',
    '  bth diagnose <id> [path] [--json]',
    '  bth version',
    '',
    'Safety:',
    '  init never creates the project directory, rejects symlink paths, and backs up every --force overwrite.',
    '  verify runs only project-contained executables declared in verification.json after an approved task state.',
    '  interview binds requirements, deterministic project facts, and a reviewable plan to one Git source fingerprint.',
    '  implement runs a configured adapter only inside a detached task worktree and never applies its diff automatically.',
    '  VERIFIED requires fresh structured test reports with at least one executed test.'
  ].join('\n'))
}

function printInterviewProgress(result) {
  const progress = result.progress
  console.log('Interview ' + result.record.taskId + ': ' + progress.status + ' (' + progress.answered + '/' + progress.total + ' resolved)')
  console.log('Source: ' + result.record.sourceFingerprint)
  if (progress.questions.some((question) => question.answer)) {
    console.log('Decisions: ' + progress.questions
      .filter((question) => question.answer)
      .map((question) => question.id + '=' + question.answer.status)
      .join(', '))
  }
  if (progress.currentQuestion) {
    console.log('')
    console.log('[' + progress.currentQuestion.id + '] ' + progress.currentQuestion.title)
    console.log(progress.currentQuestion.prompt)
    console.log('Hint: ' + progress.currentQuestion.hint)
  }
  console.log('')
  console.log('Next: ' + result.nextCommand)
}

async function runInterview(args) {
  const [subcommand, ...rest] = args
  if (!subcommand) {
    throw new Error('Usage: bth interview <start|answer|revise|rebind|status|finalize> ...')
  }

  if (subcommand === 'start') {
    const parsed = parseArguments(rest, {
      booleans: ['--json'],
      values: ['--requirement', '--by', '--title']
    })
    assertPositionalCount(
      parsed.positionals,
      1,
      2,
      'bth interview start <id> [path] --requirement <text> --by <actor> [--title <text>] [--json]'
    )
    const requirement = parsed.options.get('--requirement')
    const actor = parsed.options.get('--by')
    if (!requirement || !actor) {
      throw new Error('Interview start requires both --requirement and --by.')
    }
    const [id, path = '.'] = parsed.positionals
    const result = await startInterview(path, {
      taskId: id,
      requirement,
      actor,
      title: parsed.options.get('--title')
    })
    printResult(result, parsed.flags.has('--json'), () => printInterviewProgress(result))
    return
  }

  if (subcommand === 'answer') {
    const parsed = parseArguments(rest, {
      booleans: ['--json'],
      values: ['--question', '--text', '--by', '--status']
    })
    assertPositionalCount(
      parsed.positionals,
      1,
      2,
      'bth interview answer <id> [path] --question <id> --text <text> --by <actor> [--status <answered|unknown|conflict>] [--json]'
    )
    const questionId = parsed.options.get('--question')
    const text = parsed.options.get('--text')
    const actor = parsed.options.get('--by')
    if (!questionId || !text || !actor) {
      throw new Error('Interview answer requires --question, --text, and --by.')
    }
    const [id, path = '.'] = parsed.positionals
    const result = await answerInterview(path, id, {
      questionId,
      text,
      actor,
      status: parsed.options.get('--status')
    })
    printResult(result, parsed.flags.has('--json'), () => printInterviewProgress(result))
    return
  }

  if (subcommand === 'revise') {
    const parsed = parseArguments(rest, {
      booleans: ['--json'],
      values: ['--question', '--text', '--by', '--status']
    })
    assertPositionalCount(
      parsed.positionals,
      1,
      2,
      'bth interview revise <id> [path] --question <id> --text <text> --by <actor> [--status <answered|unknown|conflict>] [--json]'
    )
    const questionId = parsed.options.get('--question')
    const text = parsed.options.get('--text')
    const actor = parsed.options.get('--by')
    if (!questionId || !text || !actor) {
      throw new Error('Interview revise requires --question, --text, and --by.')
    }
    const [id, path = '.'] = parsed.positionals
    const result = await reviseInterview(path, id, {
      questionId,
      text,
      actor,
      status: parsed.options.get('--status')
    })
    printResult(result, parsed.flags.has('--json'), () => printInterviewProgress(result))
    return
  }

  if (subcommand === 'rebind') {
    const parsed = parseArguments(rest, { booleans: ['--json'], values: ['--by'] })
    assertPositionalCount(parsed.positionals, 1, 2, 'bth interview rebind <id> [path] --by <actor> [--json]')
    const actor = parsed.options.get('--by')
    if (!actor) {
      throw new Error('Interview rebind requires --by <actor>.')
    }
    const [id, path = '.'] = parsed.positionals
    const result = await rebindInterview(path, id, { actor })
    printResult(result, parsed.flags.has('--json'), () => printInterviewProgress(result))
    return
  }

  if (subcommand === 'status') {
    const parsed = parseArguments(rest, { booleans: ['--json'] })
    assertPositionalCount(parsed.positionals, 1, 2, 'bth interview status <id> [path] [--json]')
    const [id, path = '.'] = parsed.positionals
    const result = await interviewStatus(path, id)
    printResult(result, parsed.flags.has('--json'), () => printInterviewProgress(result))
    return
  }

  if (subcommand === 'finalize') {
    const parsed = parseArguments(rest, { booleans: ['--json'], values: ['--by'] })
    assertPositionalCount(parsed.positionals, 1, 2, 'bth interview finalize <id> [path] --by <actor> [--json]')
    const actor = parsed.options.get('--by')
    if (!actor) {
      throw new Error('Interview finalization requires --by <actor>.')
    }
    const [id, path = '.'] = parsed.positionals
    const result = await completeInterview(path, id, { actor })
    printResult(result, parsed.flags.has('--json'), () => {
      console.log('Finalized source-bound execution plan for ' + id + '.')
      console.log('Task state: ' + result.task.state)
      console.log('Plan: ' + result.planPath)
      console.log('Human approval is still required.')
      console.log('Next: ' + result.nextCommand)
    })
    return
  }

  throw new Error('Unknown interview command: ' + subcommand)
}

function parseArguments(args, schema = {}) {
  const booleans = new Set(schema.booleans ?? [])
  const values = new Set(schema.values ?? [])
  const positionals = []
  const flags = new Set()
  const options = new Map()

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]
    if (!token.startsWith('-')) {
      positionals.push(token)
      continue
    }
    if (booleans.has(token)) {
      flags.add(token)
      continue
    }
    if (values.has(token)) {
      const value = args[index + 1]
      if (!value || value.startsWith('-')) {
        throw new Error('Option requires a value: ' + token)
      }
      options.set(token, value)
      index += 1
      continue
    }
    throw new Error('Unknown option: ' + token)
  }
  return { positionals, flags, options }
}

function assertPositionalCount(values, minimum, maximum, usage) {
  if (values.length < minimum || values.length > maximum) {
    throw new Error('Usage: ' + usage)
  }
}

function printResult(value, json, fallback) {
  if (json) {
    console.log(JSON.stringify(stripProcessTails(value), null, 2))
  } else {
    fallback()
  }
}

function stripProcessTails(value) {
  if (Array.isArray(value)) {
    return value.map(stripProcessTails)
  }
  if (!value || typeof value !== 'object') {
    return value
  }
  const outputRecord = typeof value.sha256 === 'string' && Number.isSafeInteger(value.bytes)
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !(outputRecord && key === 'tail'))
      .map(([key, entry]) => [key, stripProcessTails(entry)])
  )
}

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
  if (subcommand !== 'inspect') {
    throw new Error('Usage: bth intelligence inspect [path] [--json]')
  }
  const parsed = parseArguments(rest, { booleans: ['--json'] })
  assertPositionalCount(parsed.positionals, 0, 1, 'bth intelligence inspect [path] [--json]')
  const result = await inspectProjectIntelligence(parsed.positionals[0] ?? '.')
  printResult(result, parsed.flags.has('--json'), () => {
    const intelligence = result.intelligence
    console.log('Project intelligence: ' + intelligence.evaluation.status.toUpperCase())
    console.log('Source: ' + intelligence.sourceFingerprint)
    console.log('Facts: ' + intelligence.facts.length + ', rules: ' + intelligence.rules.count)
    for (const rule of intelligence.evaluation.results) {
      console.log('[' + rule.status.toUpperCase() + '] ' + rule.id + ' — ' + rule.description)
    }
    for (const diagnostic of intelligence.rules.diagnostics) {
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
    throw new Error('Usage: bth task <create|context|plan|status|export-plan|advance> ...')
  }

  if (subcommand === 'create') {
    const parsed = parseArguments(rest, {
      booleans: ['--json'],
      values: ['--title', '--context']
    })
    assertPositionalCount(parsed.positionals, 1, 2, 'bth task create <id> [path] [--title <text>] [--context <text>] [--json]')
    const [id, path = '.'] = parsed.positionals
    const result = await withProjectVerificationLock(path, undefined, () => createTask(path, {
      id,
      title: parsed.options.get('--title'),
      context: parsed.options.get('--context')
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
      console.log('Last evidence: ' + (result.record.lastEvidenceId ?? 'none'))
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

async function runImplement(args) {
  const [subcommand, ...rest] = args
  if (subcommand === 'status') {
    const parsed = parseArguments(rest, { booleans: ['--json'] })
    assertPositionalCount(parsed.positionals, 1, 2, 'bth implement status <id> [path] [--json]')
    const [id, path = '.'] = parsed.positionals
    const result = await implementationStatus(path, id)
    printResult(result, parsed.flags.has('--json'), () => {
      console.log('Implementation ' + id + ': ' + result.record.status + '.')
      console.log('Workspace: ' + result.record.workspace)
      console.log('Attempts: ' + result.record.attempts.length)
      console.log('Next: ' + result.record.nextAction)
    })
    return
  }
  if (subcommand === 'run') {
    const parsed = parseArguments(rest, {
      booleans: ['--json', '--allow-write', '--allow-network'],
      values: ['--by']
    })
    assertPositionalCount(parsed.positionals, 1, 2, 'bth implement run <id> [path] --by <actor> --allow-write [--allow-network] [--json]')
    const actor = parsed.options.get('--by')
    if (!actor) throw new Error('Implementation requires --by <actor>.')
    const [id, path = '.'] = parsed.positionals
    const result = await runImplementation(path, id, {
      actor,
      allowWrite: parsed.flags.has('--allow-write'),
      allowNetwork: parsed.flags.has('--allow-network')
    })
    printResult(result, parsed.flags.has('--json'), () => {
      console.log('Isolated implementation ' + result.record.status + ' for task ' + id + '.')
      console.log('Workspace: ' + result.record.workspace)
      console.log('Changed files: ' + result.record.changedFiles.changedEntryCount)
      console.log('Original bound source unchanged: ' + result.record.originalBoundSourceUnchanged)
      if (result.record.verification?.failure?.code) console.log('Failure code: ' + result.record.verification.failure.code)
      console.log('Next: ' + result.record.nextAction)
    })
    if (result.record.status !== 'passed') process.exitCode = 1
    return
  }
  if (subcommand === 'reset') {
    const parsed = parseArguments(rest, {
      booleans: ['--json', '--discard-workspace'],
      values: ['--by']
    })
    assertPositionalCount(parsed.positionals, 1, 2, 'bth implement reset <id> [path] --by <actor> --discard-workspace [--json]')
    const actor = parsed.options.get('--by')
    if (!actor) throw new Error('Implementation reset requires --by <actor>.')
    const [id, path = '.'] = parsed.positionals
    const result = await resetImplementation(path, id, {
      actor,
      discardWorkspace: parsed.flags.has('--discard-workspace')
    })
    printResult(result, parsed.flags.has('--json'), () => {
      console.log('Reset isolated implementation for task ' + id + '.')
      console.log('Archived record: ' + result.archivedRecord)
      console.log('Reset receipt: ' + result.resetReceipt)
      console.log('Workspace removed: ' + result.workspaceRemoved)
      console.log('Next: ' + result.nextAction)
    })
    return
  }
  if (subcommand === 'cleanup') {
    const parsed = parseArguments(rest, {
      booleans: ['--json', '--discard-workspace'],
      values: ['--by']
    })
    assertPositionalCount(parsed.positionals, 1, 2, 'bth implement cleanup <id> [path] --by <actor> --discard-workspace [--json]')
    const actor = parsed.options.get('--by')
    if (!actor) throw new Error('Implementation cleanup requires --by <actor>.')
    const [id, path = '.'] = parsed.positionals
    const result = await cleanupImplementation(path, id, {
      actor,
      discardWorkspace: parsed.flags.has('--discard-workspace')
    })
    printResult(result, parsed.flags.has('--json'), () => {
      console.log('Removed integrated implementation workspace for task ' + id + '.')
      console.log('Archived record: ' + result.archivedRecord)
    })
    return
  }
  throw new Error('Usage: bth implement <run|status|reset|cleanup> ...')
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
  const parsed = parseArguments(args, { booleans: ['--json', '--allow-network'] })
  assertPositionalCount(parsed.positionals, 1, 2, 'bth verify <id> [path] [--allow-network] [--json]')
  const [id, path = '.'] = parsed.positionals
  const result = await verifyTask(path, id, { allowNetwork: parsed.flags.has('--allow-network') })
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
  const parsed = parseArguments(args, { booleans: ['--json', '--allow-network'] })
  assertPositionalCount(parsed.positionals, 0, 1, 'bth check [path] [--allow-network] [--json]')
  const result = await checkProject(parsed.positionals[0] ?? '.', { allowNetwork: parsed.flags.has('--allow-network') })
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
  if (command === 'task') {
    await runTask(args)
    return
  }
  if (command === 'interview') {
    await runInterview(args)
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
    await runImplement(args)
    return
  }
  throw new Error('Unknown command: ' + command)
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
