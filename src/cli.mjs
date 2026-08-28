#!/usr/bin/env node

import { initProject } from './init-project.mjs'
import { doctorProject } from './doctor.mjs'

const VERSION = '0.1.0'

function printHelp() {
  console.log([
    'Backend Team Harness',
    '',
    'Usage:',
    '  bth init [path] [--force]',
    '  bth doctor [path] [--json]',
    '  bth version',
    '',
    'Commands:',
    '  init      Create the shared .backend-harness contract safely.',
    '  doctor    Inspect build and harness foundations without modifying the project.',
    '  version   Print the CLI version.'
  ].join('\n'))
}

function positional(args) {
  return args.find((value) => !value.startsWith('-')) ?? '.'
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
    const result = await initProject(positional(args), { force: args.includes('--force') })
    console.log('Initialized backend harness contract at ' + result.root)
    console.log('Created: ' + result.created.length + ', preserved: ' + result.skipped.length)
    return
  }

  if (command === 'doctor') {
    const result = await doctorProject(positional(args))
    if (args.includes('--json')) {
      console.log(JSON.stringify(result, null, 2))
    } else {
      console.log('Backend Team Harness doctor: ' + result.root)
      for (const check of result.checks) {
        console.log('[' + check.status.toUpperCase() + '] ' + check.id + ' — ' + check.message)
      }
    }
    if (!result.healthy) {
      process.exitCode = 1
    }
    return
  }

  console.error('Unknown command: ' + command)
  printHelp()
  process.exitCode = 1
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

