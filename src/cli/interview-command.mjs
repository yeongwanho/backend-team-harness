import {
  answerInterview,
  completeInterview,
  interviewStatus,
  rebindInterview,
  resolveInterviewContradiction,
  reviseInterview,
  startInterview
} from '../runtime/interview-orchestrator.mjs'
import { assertPositionalCount, parseArguments, parseJsonObjectOption, printResult } from './options.mjs'

function printProgress(result) {
  const progress = result.progress
  console.log('Interview ' + result.record.taskId + ': ' + progress.status + ' (' + progress.answered + '/' + progress.total + ' resolved)')
  console.log('Source: ' + result.record.sourceFingerprint)
  if (progress.questions.some((question) => question.answer)) {
    console.log('Decisions: ' + progress.questions.filter((question) => question.answer).map((question) => question.id + '=' + question.answer.status).join(', '))
  }
  if (progress.currentQuestion) {
    console.log('\n[' + progress.currentQuestion.id + '] ' + progress.currentQuestion.title)
    console.log(progress.currentQuestion.prompt)
    console.log('Hint: ' + progress.currentQuestion.hint)
  }
  if (progress.contradictions?.candidates?.length) {
    console.log('\nContradiction candidates:')
    for (const candidate of progress.contradictions.candidates) {
      console.log('- [' + (candidate.resolved ? 'RESOLVED' : 'UNRESOLVED') + '] ' + candidate.id + ' — ' + candidate.summary)
    }
  }
  console.log('\nNext: ' + result.nextCommand)
}

function requiredOptions(parsed, names, message) {
  const values = names.map((name) => parsed.options.get(name))
  if (values.some((value) => !value)) throw new Error(message)
  return values
}

export async function runInterviewCommand(args) {
  const [subcommand, ...rest] = args
  if (!subcommand) throw new Error('Usage: bth interview <start|answer|revise|resolve|rebind|status|finalize> ...')
  if (subcommand === 'start') {
    const parsed = parseArguments(rest, { booleans: ['--json'], values: ['--requirement', '--by', '--title'] })
    assertPositionalCount(parsed.positionals, 1, 2, 'bth interview start <id> [path] --requirement <text> --by <actor> [--title <text>] [--json]')
    const [requirement, actor] = requiredOptions(parsed, ['--requirement', '--by'], 'Interview start requires both --requirement and --by.')
    const [id, path = '.'] = parsed.positionals
    const result = await startInterview(path, { taskId: id, requirement, actor, title: parsed.options.get('--title') })
    printResult(result, parsed.flags.has('--json'), () => printProgress(result))
    return
  }
  if (subcommand === 'answer' || subcommand === 'revise') {
    const parsed = parseArguments(rest, { booleans: ['--json'], values: ['--question', '--text', '--by', '--status', '--claims'] })
    assertPositionalCount(parsed.positionals, 1, 2, 'bth interview ' + subcommand + ' <id> [path] --question <id> --text <text> --by <actor> [--status <answered|unknown|conflict>] [--claims <json>] [--json]')
    const [questionId, text, actor] = requiredOptions(parsed, ['--question', '--text', '--by'], 'Interview ' + subcommand + ' requires --question, --text, and --by.')
    const [id, path = '.'] = parsed.positionals
    const operation = subcommand === 'answer' ? answerInterview : reviseInterview
    const result = await operation(path, id, { questionId, text, actor, status: parsed.options.get('--status'), claims: parseJsonObjectOption(parsed.options.get('--claims'), '--claims') })
    printResult(result, parsed.flags.has('--json'), () => printProgress(result))
    return
  }
  if (subcommand === 'resolve') {
    const parsed = parseArguments(rest, { booleans: ['--json'], values: ['--candidate', '--reason', '--by'] })
    assertPositionalCount(parsed.positionals, 1, 2, 'bth interview resolve <id> [path] --candidate <id> --reason <text> --by <actor> [--json]')
    const [candidateId, reason, actor] = requiredOptions(parsed, ['--candidate', '--reason', '--by'], 'Interview contradiction resolution requires --candidate, --reason, and --by.')
    const [id, path = '.'] = parsed.positionals
    const result = await resolveInterviewContradiction(path, id, { candidateId, reason, actor })
    printResult(result, parsed.flags.has('--json'), () => printProgress(result))
    return
  }
  if (subcommand === 'rebind') {
    const parsed = parseArguments(rest, { booleans: ['--json'], values: ['--by'] })
    assertPositionalCount(parsed.positionals, 1, 2, 'bth interview rebind <id> [path] --by <actor> [--json]')
    const [actor] = requiredOptions(parsed, ['--by'], 'Interview rebind requires --by <actor>.')
    const [id, path = '.'] = parsed.positionals
    const result = await rebindInterview(path, id, { actor })
    printResult(result, parsed.flags.has('--json'), () => printProgress(result))
    return
  }
  if (subcommand === 'status') {
    const parsed = parseArguments(rest, { booleans: ['--json'] })
    assertPositionalCount(parsed.positionals, 1, 2, 'bth interview status <id> [path] [--json]')
    const [id, path = '.'] = parsed.positionals
    const result = await interviewStatus(path, id)
    printResult(result, parsed.flags.has('--json'), () => printProgress(result))
    return
  }
  if (subcommand === 'finalize') {
    const parsed = parseArguments(rest, { booleans: ['--json'], values: ['--by'] })
    assertPositionalCount(parsed.positionals, 1, 2, 'bth interview finalize <id> [path] --by <actor> [--json]')
    const [actor] = requiredOptions(parsed, ['--by'], 'Interview finalization requires --by <actor>.')
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
