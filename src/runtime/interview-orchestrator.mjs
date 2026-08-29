import { createHash } from 'node:crypto'
import { inspectProjectContext } from '../adapters/project-context.mjs'
import { canonicalJson } from '../core/canonical-json.mjs'
import {
  createInterview,
  finalizeInterview,
  loadInterview,
  recordInterviewAnswer
} from '../core/interview-store.mjs'
import { withProjectVerificationLock } from '../core/project-lock.mjs'
import {
  advanceTask,
  createTask,
  loadTask,
  updateTaskContext,
  updateTaskPlan
} from '../core/task-store.mjs'
import { captureConfiguredSourceBinding } from './backend-harness.mjs'

function sha256(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function answerById(record, id) {
  return record.answers.find((answer) => answer.questionId === id)?.text ?? ''
}

function makeArtifacts(interview, contextSnapshot) {
  const requirement = {
    schemaVersion: 1,
    taskId: interview.taskId,
    sourceFingerprint: interview.sourceFingerprint,
    initialRequirement: interview.requirement,
    acceptanceCriteria: answerById(interview, 'acceptance')
  }
  const context = {
    schemaVersion: 1,
    taskId: interview.taskId,
    sourceFingerprint: interview.sourceFingerprint,
    snapshotSha256: interview.contextSnapshotSha256,
    project: contextSnapshot
  }
  const impact = {
    schemaVersion: 1,
    taskId: interview.taskId,
    sourceFingerprint: interview.sourceFingerprint,
    allowedScope: answerById(interview, 'scope'),
    databaseAndData: answerById(interview, 'data'),
    constraintsAndExclusions: answerById(interview, 'constraints'),
    provenance: {
      requirementSha256: interview.requirementSha256,
      contextSnapshotSha256: interview.contextSnapshotSha256
    }
  }
  const requiredGates = contextSnapshot.verification.gates
    .filter((gate) => gate.required)
    .map((gate) => gate.id)
  const plan = {
    schemaVersion: 1,
    taskId: interview.taskId,
    sourceFingerprint: interview.sourceFingerprint,
    objective: interview.requirement,
    acceptanceCriteria: answerById(interview, 'acceptance'),
    allowedScope: answerById(interview, 'scope'),
    databaseAndData: answerById(interview, 'data'),
    requestedVerification: answerById(interview, 'verification'),
    constraintsAndExclusions: answerById(interview, 'constraints'),
    declaredRequiredGates: requiredGates,
    steps: [
      {
        id: 'confirm-context',
        action: 'Re-check the source-bound requirement, project facts, policies, and unresolved conflicts before editing.',
        proof: 'The source fingerprint and context snapshot match the approved plan.'
      },
      {
        id: 'trace-impact',
        action: 'Trace callers, contracts, persistence, and tests inside the explicitly allowed scope.',
        proof: 'Every proposed edit maps to an acceptance criterion or declared data impact.'
      },
      {
        id: 'implement',
        action: 'Implement the smallest change that satisfies the acceptance criteria without crossing excluded boundaries.',
        proof: 'The diff stays inside the approved scope or records a new approval.'
      },
      {
        id: 'database',
        action: 'Apply the declared DB/data decision, including migration and compatibility checks when applicable.',
        proof: 'The DB impact statement is explicitly demonstrated or explicitly states no impact.'
      },
      {
        id: 'verify',
        action: 'Run the project-declared BTH verification contract plus the task-specific failure scenarios.',
        proof: 'Fresh structured evidence is bound to the final Git source.'
      },
      {
        id: 'review',
        action: 'Review residual risks, exclusions, and source drift before declaring completion.',
        proof: 'A human approves this exact plan before implementation; DONE uses unchanged verified source.'
      }
    ],
    provenance: {
      requirementSha256: interview.requirementSha256,
      contextSnapshotSha256: interview.contextSnapshotSha256,
      answeredQuestionCount: interview.answers.length
    }
  }
  return { requirement, context, impact, plan }
}

function planMarkdown(artifacts, contextSnapshot) {
  const gates = artifacts.plan.declaredRequiredGates.length
    ? artifacts.plan.declaredRequiredGates.map((id) => '- `' + id + '`').join('\n')
    : '- _No required Gate was detected._'
  const facts = contextSnapshot.facts
    .map((entry) => '- [' + entry.status.toUpperCase() + '] `' + entry.id + '` — ' + entry.summary)
    .join('\n')
  const steps = artifacts.plan.steps
    .map((step, index) => (index + 1) + '. **' + step.id + '** — ' + step.action + '\n   - Proof: ' + step.proof)
    .join('\n')
  return [
    '# Execution plan — ' + artifacts.plan.taskId,
    '',
    '> This plan is bound to Git source `' + artifacts.plan.sourceFingerprint + '`. Human approval is still required.',
    '',
    '## Requirement',
    '',
    artifacts.plan.objective,
    '',
    '## Acceptance criteria',
    '',
    artifacts.plan.acceptanceCriteria,
    '',
    '## Allowed scope',
    '',
    artifacts.plan.allowedScope,
    '',
    '## Database and data impact',
    '',
    artifacts.plan.databaseAndData,
    '',
    '## Task-specific verification',
    '',
    artifacts.plan.requestedVerification,
    '',
    '## Constraints and exclusions',
    '',
    artifacts.plan.constraintsAndExclusions,
    '',
    '## Detected project facts',
    '',
    facts,
    '',
    '## Required project Gates',
    '',
    gates,
    '',
    '## Execution steps',
    '',
    steps,
    '',
    '## Approval boundary',
    '',
    'Approve this exact plan with `bth task advance ' + artifacts.plan.taskId + ' PLAN_APPROVED --by <reviewer> --approve`.',
    'Changing task context or plan invalidates approval. Verification and DONE remain source-bound.',
    ''
  ].join('\n')
}

function taskContextText(artifacts, contextSnapshot) {
  const conflicts = contextSnapshot.facts.filter((entry) => entry.status !== 'confirmed')
  return [
    'Requirement: ' + artifacts.requirement.initialRequirement,
    '',
    'Acceptance criteria: ' + artifacts.requirement.acceptanceCriteria,
    '',
    'Allowed scope: ' + artifacts.impact.allowedScope,
    '',
    'Database/data impact: ' + artifacts.impact.databaseAndData,
    '',
    'Constraints/exclusions: ' + artifacts.impact.constraintsAndExclusions,
    '',
    'Source fingerprint: ' + artifacts.context.sourceFingerprint,
    'Project facts needing attention: ' + (conflicts.length
      ? conflicts.map((entry) => entry.id + '=' + entry.status).join(', ')
      : 'none')
  ].join('\n')
}

function shellArgument(value) {
  return "'" + String(value).replaceAll("'", "'\\''") + "'"
}

function nextCommand(taskId, question, root) {
  const target = root ? ' ' + shellArgument(root) : ''
  return question
    ? 'bth interview answer ' + taskId + target + ' --question ' + question.id + ' --text "<answer>" --by "<actor>"'
    : 'bth interview finalize ' + taskId + target + ' --by "<actor>"'
}

async function recoverableTask(root, taskId, requirement) {
  try {
    const task = await loadTask(root, taskId)
    if (task.record.revision === 0 && task.record.state === 'CONTEXT_MISSING' && task.record.context === requirement) {
      return task
    }
    throw new Error('Task already exists and is not an incomplete interview start: ' + taskId)
  } catch (error) {
    if (/Task does not exist/.test(error instanceof Error ? error.message : String(error))) {
      return null
    }
    throw error
  }
}

export async function startInterview(inputPath, input, options = {}) {
  return withProjectVerificationLock(inputPath, options.projectLock, async () => {
    const contextSnapshot = await inspectProjectContext(inputPath, options)
    const existing = await recoverableTask(inputPath, input.taskId, input.requirement?.trim())
    if (!existing) {
      await createTask(inputPath, {
        id: input.taskId,
        title: input.title,
        context: input.requirement
      }, options)
    }
    const created = await createInterview(inputPath, {
      taskId: input.taskId,
      requirement: input.requirement,
      actor: input.actor,
      sourceBinding: contextSnapshot.sourceBinding,
      contextSnapshot
    }, options)
    return {
      ...created,
      nextCommand: nextCommand(input.taskId, created.progress.currentQuestion, created.root)
    }
  })
}

export async function answerInterview(inputPath, taskId, input, options = {}) {
  return withProjectVerificationLock(inputPath, options.projectLock, async () => {
    const answered = await recordInterviewAnswer(inputPath, taskId, input, options)
    return {
      ...answered,
      nextCommand: nextCommand(taskId, answered.progress.currentQuestion, answered.root)
    }
  })
}

export async function interviewStatus(inputPath, taskId) {
  const loaded = await loadInterview(inputPath, taskId)
  return {
    ...loaded,
    nextCommand: loaded.record.status === 'FINALIZED'
      ? 'bth task advance ' + taskId + ' PLAN_APPROVED ' + shellArgument(loaded.root) + ' --by "<reviewer>" --approve'
      : nextCommand(taskId, loaded.progress.currentQuestion, loaded.root)
  }
}

async function syncFinalizedPlanToTask(root, taskId, artifacts, markdown, actor) {
  let task = await loadTask(root, taskId)
  const contextText = taskContextText(artifacts, artifacts.context.project)
  if (task.record.state === 'PLAN_PROPOSED') {
    if (task.record.context !== contextText || task.record.plan !== markdown.trim()) {
      throw new Error('Task plan differs from the finalized interview artifacts: ' + taskId)
    }
    return task
  }
  if (!['CONTEXT_MISSING', 'CONTEXT_READY'].includes(task.record.state)) {
    throw new Error('Finalized interview cannot replace task state ' + task.record.state + '.')
  }
  if (task.record.context !== contextText) {
    await updateTaskContext(root, taskId, contextText, {
      actor,
      reason: 'Materialize source-bound native interview context.'
    })
  }
  task = await loadTask(root, taskId)
  if (task.record.state === 'CONTEXT_MISSING') {
    await advanceTask(root, taskId, 'CONTEXT_READY', {
      actor,
      reason: 'Native interview supplied complete context.'
    })
  }
  task = await loadTask(root, taskId)
  const planText = markdown.trim()
  if (task.record.plan !== planText) {
    await updateTaskPlan(root, taskId, planText, {
      actor,
      reason: 'Materialize source-bound native interview execution plan.',
      sourceFingerprint: artifacts.plan.sourceFingerprint
    })
  }
  task = await loadTask(root, taskId)
  if (task.record.state === 'CONTEXT_READY') {
    await advanceTask(root, taskId, 'PLAN_PROPOSED', {
      actor,
      reason: 'Native interview produced a reviewable execution plan.'
    })
  }
  return loadTask(root, taskId)
}

export async function completeInterview(inputPath, taskId, input, options = {}) {
  return withProjectVerificationLock(inputPath, options.projectLock, async () => {
    const loaded = await loadInterview(inputPath, taskId)
    const artifacts = makeArtifacts(loaded.record, loaded.contextSnapshot)
    const markdown = planMarkdown(artifacts, loaded.contextSnapshot)
    let finalized = loaded
    if (loaded.record.status !== 'FINALIZED') {
      const currentSource = options.sourceBinding ?? await captureConfiguredSourceBinding(inputPath)
      finalized = await finalizeInterview(inputPath, taskId, {
        actor: input.actor,
        currentSourceFingerprint: currentSource.fingerprint,
        artifacts,
        markdown
      }, options)
    } else {
      const expectedDigests = Object.fromEntries(
        Object.entries(artifacts).map(([name, value]) => [name, sha256(value)])
      )
      if (canonicalJson(expectedDigests) !== canonicalJson(loaded.record.artifactDigests)) {
        throw new Error('Finalized interview artifact digests do not match regenerated artifacts.')
      }
    }
    const task = await syncFinalizedPlanToTask(finalized.root, taskId, artifacts, markdown, input.actor)
    return {
      ...finalized,
      artifacts,
      task: task.record,
      planPath: finalized.path + '/plan.md',
      nextCommand: 'bth task advance ' + taskId + ' PLAN_APPROVED ' + shellArgument(finalized.root) + ' --by "<reviewer>" --approve'
    }
  })
}
