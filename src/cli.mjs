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
import {
  answerInterview,
  completeInterview,
  interviewStatus,
  rebindInterview,
  resolveInterviewContradiction,
  reviseInterview,
  startInterview
} from './runtime/interview-orchestrator.mjs'
import { exportApprovedPlan } from './runtime/plan-export.mjs'
import { diagnoseTaskFailure } from './runtime/failure-diagnosis.mjs'
import { inspectProjectIntelligence, warmProjectIntelligenceCache } from './adapters/project-intelligence.mjs'
import { cleanupImplementation, implementationStatus, resetImplementation, runImplementation } from './runtime/implementation-orchestrator.mjs'
import { configureImplementationProvider } from './config/implementation-setup.mjs'
import { probeImplementationProvider, PROVIDER_IDS } from './providers/model-cli.mjs'

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

function printHelp() {
  console.log([
    'Backend Team Harness',
    '',
    'Usage:',
    '  bth init [path] [--force] [--allow-unversioned]',
    '  bth doctor [path] [--json]',
    '  bth intelligence inspect [path] [--no-cache] [--json]',
    '  bth intelligence warm-cache [path] [--json]',
    '  bth check [path] [--acknowledge-network-risk] [--json]',
    '  bth pack list [--json]',
    '  bth pack install <id> [path] [--json]',
    '  bth baseline update [path] [--json]',
    '  bth task create <id> [path] [--title <text>] [--context <text>] [--by <actor>] [--json]',
    '  bth task context <id> [path] --text <text> --by <actor> [--json]',
    '  bth task plan <id> [path] --text <text> --by <actor> [--json]',
    '  bth task status <id> [path] [--json]',
    '  bth task handoff <id> [path] --from <actor> --to <actor> --reason <text> [--json]',
    '  bth task export-plan <id> [path] [--context-budget <characters>] [--json]',
    '  bth task advance <id> <state> [path] --by <actor> [--approve] [--reason <text>] [--json]',
    '  bth interview start <id> [path] --requirement <text> --by <actor> [--title <text>] [--json]',
    '  bth interview answer <id> [path] --question <id> --text <text> --by <actor> [--status <answered|unknown|conflict>] [--claims <json>] [--json]',
    '  bth interview revise <id> [path] --question <id> --text <text> --by <actor> [--status <answered|unknown|conflict>] [--claims <json>] [--json]',
    '  bth interview resolve <id> [path] --candidate <id> --reason <text> --by <actor> [--json]',
    '  bth interview rebind <id> [path] --by <actor> [--json]',
    '  bth interview status <id> [path] [--json]',
    '  bth interview finalize <id> [path] --by <actor> [--json]',
    '  bth implement configure <codex|claude> [path] [--mode <auto|fast|balanced|deep>] [--allowed-prefixes <json>] [--force] [--json]',
    '  bth implement providers [path] [--json]',
    '  bth implement run <id> [path] --by <actor> --allow-write [--acknowledge-network-risk] [--json]',
    '  bth implement status <id> [path] [--json]',
    '  bth implement reset <id> [path] --by <actor> --discard-workspace [--json]',
    '  bth implement cleanup <id> [path] --by <actor> --discard-workspace [--json]',
    '  bth verify <id> [path] [--acknowledge-network-risk] [--json]',
    '  bth diagnose <id> [path] [--json]',
    '  bth version',
    '',
    'Safety:',
    '  init never creates the project directory, rejects symlink paths, and backs up every --force overwrite.',
    '  verify runs only project-contained executables declared in verification.json after an approved task state.',
    '  interview binds requirements, deterministic project facts, and a reviewable plan to one Git source fingerprint.',
    '  implement runs a configured adapter only inside a detached task worktree and never applies its diff automatically.',
    '  acknowledge-network-risk permits a declared network-capable command; it does not enforce operating-system egress isolation.',
    '  VERIFIED requires fresh structured test reports with at least one executed test.'
  ].join('\n'))
}

function acknowledgedNetworkRisk(parsed) {
  if (parsed.flags.has('--allow-network')) {
    console.error('Warning: --allow-network is deprecated because BTH does not isolate egress. Use --acknowledge-network-risk.')
  }
  return parsed.flags.has('--acknowledge-network-risk') || parsed.flags.has('--allow-network')
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
  if (progress.contradictions?.candidates?.length) {
    console.log('')
    console.log('Contradiction candidates:')
    for (const candidate of progress.contradictions.candidates) {
      console.log('- [' + (candidate.resolved ? 'RESOLVED' : 'UNRESOLVED') + '] ' + candidate.id + ' — ' + candidate.summary)
    }
  }
  console.log('')
  console.log('Next: ' + result.nextCommand)
}

async function runInterview(args) {
  const [subcommand, ...rest] = args
  if (!subcommand) {
    throw new Error('Usage: bth interview <start|answer|revise|resolve|rebind|status|finalize> ...')
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
      values: ['--question', '--text', '--by', '--status', '--claims']
    })
    assertPositionalCount(
      parsed.positionals,
      1,
      2,
      'bth interview answer <id> [path] --question <id> --text <text> --by <actor> [--status <answered|unknown|conflict>] [--claims <json>] [--json]'
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
      status: parsed.options.get('--status'),
      claims: parseJsonObjectOption(parsed.options.get('--claims'), '--claims')
    })
    printResult(result, parsed.flags.has('--json'), () => printInterviewProgress(result))
    return
  }

  if (subcommand === 'revise') {
    const parsed = parseArguments(rest, {
      booleans: ['--json'],
      values: ['--question', '--text', '--by', '--status', '--claims']
    })
    assertPositionalCount(
      parsed.positionals,
      1,
      2,
      'bth interview revise <id> [path] --question <id> --text <text> --by <actor> [--status <answered|unknown|conflict>] [--claims <json>] [--json]'
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
      status: parsed.options.get('--status'),
      claims: parseJsonObjectOption(parsed.options.get('--claims'), '--claims')
    })
    printResult(result, parsed.flags.has('--json'), () => printInterviewProgress(result))
    return
  }

  if (subcommand === 'resolve') {
    const parsed = parseArguments(rest, {
      booleans: ['--json'],
      values: ['--candidate', '--reason', '--by']
    })
    assertPositionalCount(
      parsed.positionals,
      1,
      2,
      'bth interview resolve <id> [path] --candidate <id> --reason <text> --by <actor> [--json]'
    )
    const candidateId = parsed.options.get('--candidate')
    const reason = parsed.options.get('--reason')
    const actor = parsed.options.get('--by')
    if (!candidateId || !reason || !actor) {
      throw new Error('Interview contradiction resolution requires --candidate, --reason, and --by.')
    }
    const [id, path = '.'] = parsed.positionals
    const result = await resolveInterviewContradiction(path, id, { candidateId, reason, actor })
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

function parseJsonObjectOption(value, optionName) {
  if (value === undefined) return undefined
  let parsed
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error(optionName + ' must be valid JSON.')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(optionName + ' must be a JSON object.')
  }
  return parsed
}

function parseJsonArrayOption(value, optionName) {
  if (value === undefined) return undefined
  let parsed
  try { parsed = JSON.parse(value) } catch { throw new Error(optionName + ' must be valid JSON.') }
  if (!Array.isArray(parsed)) throw new Error(optionName + ' must be a JSON array.')
  return parsed
}

function parseNumericOption(value, optionName, kind = 'integer') {
  if (value === undefined) return undefined
  const parsed = kind === 'number' ? Number(value) : Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || (kind === 'integer' && (!Number.isSafeInteger(parsed) || String(parsed) !== value))) {
    throw new Error(optionName + ' must be a valid ' + kind + '.')
  }
  return parsed
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

async function runImplement(args) {
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
      force: parsed.flags.has('--force'),
      model: parsed.options.get('--model'),
      mode: parsed.options.get('--mode'),
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
    const cwd = parsed.positionals[0] ?? '.'
    const providers = []
    for (const provider of PROVIDER_IDS) {
      try {
        providers.push(await probeImplementationProvider(provider, { cwd }))
      } catch (error) {
        providers.push({ provider, available: false, version: null, diagnostic: error instanceof Error ? error.message : String(error) })
      }
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
      console.log('Next: ' + result.record.nextAction)
    })
    return
  }
  if (subcommand === 'run') {
    const parsed = parseArguments(rest, {
      booleans: ['--json', '--allow-write', '--acknowledge-network-risk', '--allow-network'],
      values: ['--by']
    })
    assertPositionalCount(parsed.positionals, 1, 2, 'bth implement run <id> [path] --by <actor> --allow-write [--acknowledge-network-risk] [--json]')
    const actor = parsed.options.get('--by')
    if (!actor) throw new Error('Implementation requires --by <actor>.')
    const [id, path = '.'] = parsed.positionals
    const result = await runImplementation(path, id, {
      actor,
      allowWrite: parsed.flags.has('--allow-write'),
      allowNetwork: acknowledgedNetworkRisk(parsed)
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
