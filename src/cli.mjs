#!/usr/bin/env node

import { initProject } from './init-project.mjs'
import { doctorProject } from './doctor.mjs'
import {
  advanceTask,
  createTask,
  loadTask,
  updateTaskContext,
  updateTaskPlan
} from './core/task-store.mjs'
import { verifyTask } from './runtime/backend-harness.mjs'

const VERSION = '0.2.0'

function printHelp() {
  console.log([
    'Backend Team Harness',
    '',
    'Usage:',
    '  bth init [path] [--force] [--allow-unversioned]',
    '  bth doctor [path] [--json]',
    '  bth task create <id> [path] [--title <text>] [--context <text>] [--json]',
    '  bth task context <id> [path] --text <text> --by <actor> [--json]',
    '  bth task plan <id> [path] --text <text> --by <actor> [--json]',
    '  bth task status <id> [path] [--json]',
    '  bth task advance <id> <state> [path] --by <actor> [--approve] [--reason <text>] [--json]',
    '  bth verify <id> [path] [--json]',
    '  bth version',
    '',
    'Safety:',
    '  init never creates the project directory, rejects symlink paths, and backs up every --force overwrite.',
    '  verify runs only the project Gradle/Maven wrapper, in offline mode, after an approved task state.',
    '  build output is hashed, not copied into evidence.'
  ].join('\n'))
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
    console.log(JSON.stringify(value, null, 2))
  } else {
    fallback()
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

async function runTask(args) {
  const [subcommand, ...rest] = args
  if (!subcommand) {
    throw new Error('Usage: bth task <create|context|plan|status|advance> ...')
  }

  if (subcommand === 'create') {
    const parsed = parseArguments(rest, {
      booleans: ['--json'],
      values: ['--title', '--context']
    })
    assertPositionalCount(parsed.positionals, 1, 2, 'bth task create <id> [path] [--title <text>] [--context <text>] [--json]')
    const [id, path = '.'] = parsed.positionals
    const result = await createTask(path, {
      id,
      title: parsed.options.get('--title'),
      context: parsed.options.get('--context')
    })
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
    const result = await update(path, id, text, {
      actor,
      reason: parsed.options.get('--reason')
    })
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
    const result = await advanceTask(path, id, state.toUpperCase(), {
      actor,
      reason: parsed.options.get('--reason'),
      approved: parsed.flags.has('--approve')
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

async function runVerify(args) {
  const parsed = parseArguments(args, { booleans: ['--json'] })
  assertPositionalCount(parsed.positionals, 1, 2, 'bth verify <id> [path] [--json]')
  const [id, path = '.'] = parsed.positionals
  const result = await verifyTask(path, id)
  printResult(result, parsed.flags.has('--json'), () => {
    console.log('Verification ' + (result.confirmed ? 'confirmed' : 'failed') + ' for task ' + id + '.')
    console.log('Task state: ' + result.task.state)
    console.log('Evidence: ' + result.evidence.path)
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
  if (command === 'task') {
    await runTask(args)
    return
  }
  if (command === 'verify') {
    await runVerify(args)
    return
  }
  throw new Error('Unknown command: ' + command)
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
