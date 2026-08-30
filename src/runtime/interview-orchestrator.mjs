import { createHash } from 'node:crypto'
import { inspectProjectIntelligence } from '../adapters/project-intelligence.mjs'
import { canonicalJson } from '../core/canonical-json.mjs'
import { evaluateProjectRules } from '../core/constraint-engine.mjs'
import { interviewContradictions } from '../core/interview-state.mjs'
import {
  createInterview,
  finalizeInterview,
  loadInterview,
  rebindInterviewContext,
  recordInterviewAnswer,
  recordInterviewContradictionResolution,
  reviseInterviewAnswer
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

function claimsById(record, id) {
  return record.answers.find((answer) => answer.questionId === id)?.claims ?? {}
}

function hasDeclaredDatabaseImpact(interview, contextSnapshot) {
  const claims = claimsById(interview, 'data')
  if (typeof claims.changesDatabase === 'boolean' || typeof claims.requiresMigration === 'boolean') {
    return claims.changesDatabase === true || claims.requiresMigration === true
  }
  const answer = answerById(interview, 'data').toLowerCase()
  const explicitlyNone = /^(no |none|없음|변경 없음|영향 없음)/.test(answer)
  const migrations = contextSnapshot.facts
    ?.find((entry) => entry.id === 'database.flyway')
    ?.evidence?.files ?? []
  return !explicitlyNone || migrations.length > 0
}

function executionSteps(interview, contextSnapshot, requiredGates) {
  const steps = [
    {
      id: 'confirm-context',
      action: 'Re-check the source-bound requirement, observed project facts, policies, and unresolved conflicts before editing.',
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
      proof: 'The diff stays inside the approved scope or returns for new approval.'
    }
  ]
  if (hasDeclaredDatabaseImpact(interview, contextSnapshot)) {
    steps.push({
      id: 'database',
      action: 'Apply the declared DB/data decision for ' + (contextSnapshot.verification?.context?.databaseDialect ?? 'the detected database') + ', including migration and compatibility checks.',
      proof: 'Migration ordering, schema compatibility, and data behavior are demonstrated by the declared Gate.'
    })
  }
  steps.push({
    id: 'verify',
    action: 'Run ' + (requiredGates.length ? requiredGates.join(', ') : 'the project-declared BTH verification contract') + ' plus the task-specific failure scenarios.',
    proof: 'Fresh structured evidence is bound to the final Git source.'
  })
  steps.push({
    id: 'review',
    action: 'Review residual risks, exclusions, and source drift before declaring completion.',
    proof: 'A human approves this exact plan artifact before implementation; DONE uses unchanged verified source.'
  })
  return steps
}

function makeArtifacts(interview, contextSnapshot) {
  const structuredDecisions = Object.fromEntries(interview.answers
    .filter((answer) => Object.keys(answer.claims ?? {}).length > 0)
    .map((answer) => [answer.questionId, answer.claims]))
  const contradictions = interviewContradictions(interview, contextSnapshot)
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
    structuredDecisions,
    provenance: {
      requirementSha256: interview.requirementSha256,
      contextSnapshotSha256: interview.contextSnapshotSha256
    }
  }
  const requiredGates = contextSnapshot.verification.gates
    .filter((gate) => gate.required)
    .map((gate) => gate.id)
  const requiredReviewChecklists = (contextSnapshot.policyGates ?? [])
    .filter((gate) => gate.required)
    .map((gate) => ({ name: gate.name, checks: [...gate.checks] }))
  const projectRuleEvaluation = contextSnapshot.intelligence?.evaluation ?? {
    schemaVersion: 1,
    status: 'unknown',
    blocking: false,
    counts: { confirmed: 0, unknown: 0, conflict: 0 },
    results: []
  }
  const plan = {
    schemaVersion: 4,
    taskId: interview.taskId,
    sourceFingerprint: interview.sourceFingerprint,
    objective: interview.requirement,
    acceptanceCriteria: answerById(interview, 'acceptance'),
    allowedScope: answerById(interview, 'scope'),
    databaseAndData: answerById(interview, 'data'),
    requestedVerification: answerById(interview, 'verification'),
    constraintsAndExclusions: answerById(interview, 'constraints'),
    structuredDecisions,
    contradictionResolutions: contradictions.candidates
      .filter((candidate) => candidate.resolved)
      .map((candidate) => candidate.resolution),
    declaredRequiredGates: requiredGates,
    declaredRequiredReviewChecklists: requiredReviewChecklists,
    projectRuleEvaluation,
    steps: executionSteps(interview, contextSnapshot, requiredGates),
    provenance: {
      requirementSha256: interview.requirementSha256,
      contextSnapshotSha256: interview.contextSnapshotSha256,
      answeredQuestionCount: interview.answers.length
    }
  }
  return { requirement, context, impact, plan }
}

function planningFacts(contextSnapshot) {
  const projectOwned = (contextSnapshot.intelligence?.facts ?? []).filter((entry) => entry.id.startsWith('project.'))
  return [...new Map([...(contextSnapshot.facts ?? []), ...projectOwned].map((entry) => [entry.id, entry])).values()]
}

function planMarkdown(artifacts, contextSnapshot) {
  const gates = artifacts.plan.declaredRequiredGates.length
    ? artifacts.plan.declaredRequiredGates.map((id) => '- `' + id + '`').join('\n')
    : '- _No required Gate was detected._'
  const reviewChecklists = artifacts.plan.declaredRequiredReviewChecklists.length
    ? artifacts.plan.declaredRequiredReviewChecklists
      .map((checklist) => '- **' + checklist.name + '** — ' + checklist.checks.join(', '))
      .join('\n')
    : '- _No required human review checklist was detected._'
  const facts = planningFacts(contextSnapshot)
    .map((entry) => '- [' + entry.status.toUpperCase() + '] `' + entry.id + '` — ' + entry.summary)
    .join('\n')
  const steps = artifacts.plan.steps
    .map((step, index) => (index + 1) + '. **' + step.id + '** — ' + step.action + '\n   - Proof: ' + step.proof)
    .join('\n')
  const projectRules = artifacts.plan.projectRuleEvaluation.results.length
    ? artifacts.plan.projectRuleEvaluation.results
      .map((rule) => '- [' + rule.status.toUpperCase() + '] `' + rule.id + '` — ' + rule.description + ' (source: `' + rule.source.path + '`, ' + rule.source.section + ')')
      .join('\n')
    : '- _No machine-readable project rules were configured._'
  const structuredDecisions = Object.keys(artifacts.plan.structuredDecisions).length
    ? Object.entries(artifacts.plan.structuredDecisions)
      .map(([question, claims]) => '- `' + question + '` — `' + JSON.stringify(claims) + '`')
      .join('\n')
    : '- _No structured claims were declared._'
  const contradictionResolutions = artifacts.plan.contradictionResolutions.length
    ? artifacts.plan.contradictionResolutions
      .map((resolution) => '- `' + resolution.candidateId + '` — ' + resolution.reason + ' (resolved by ' + resolution.actor + ')')
      .join('\n')
    : '- _No contradiction candidate required an explicit resolution._'
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
    '## Structured decisions',
    '',
    structuredDecisions,
    '',
    '## Resolved contradiction candidates',
    '',
    contradictionResolutions,
    '',
    '## Detected project facts',
    '',
    facts,
    '',
    '## Required project Gates',
    '',
    gates,
    '',
    '## Required human review checklists (not executable)',
    '',
    reviewChecklists,
    '',
    '## Deterministic project-rule evaluation',
    '',
    'Status: **' + artifacts.plan.projectRuleEvaluation.status.toUpperCase() + '**. These rules guide planning but do not create PASS evidence.',
    '',
    projectRules,
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
  const conflicts = planningFacts(contextSnapshot).filter((entry) => entry.status !== 'confirmed')
  const ruleIssues = (contextSnapshot.intelligence?.evaluation?.results ?? [])
    .filter((entry) => entry.status !== 'confirmed')
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
      : 'none'),
    'Project rules needing attention: ' + (ruleIssues.length
      ? ruleIssues.map((entry) => entry.id + '=' + entry.status).join(', ')
      : 'none')
  ].join('\n')
}

function shellArgument(value) {
  return "'" + String(value).replaceAll("'", "'\\''") + "'"
}

function nextCommand(taskId, progress, root) {
  const target = root ? ' ' + shellArgument(root) : ''
  if (progress.currentQuestion) {
    return 'bth interview answer ' + taskId + target + ' --question ' + progress.currentQuestion.id + ' --text "<answer>" --by "<actor>"'
  }
  const contradiction = progress.contradictions?.unresolved?.[0]
  return contradiction
    ? 'bth interview resolve ' + taskId + target + ' --candidate ' + contradiction.id + ' --reason "<human resolution>" --by "<actor>"'
    : 'bth interview finalize ' + taskId + target + ' --by "<actor>"'
}

const SNAPSHOT_ARRAY_LIMIT = 256
const SNAPSHOT_ARRAY_BYTES = 512 * 1024

function boundedSnapshotArray(values) {
  const retained = []
  let bytes = 2
  for (const value of values) {
    if (retained.length >= SNAPSHOT_ARRAY_LIMIT) break
    const serialized = JSON.stringify(value) ?? 'null'
    const nextBytes = Buffer.byteLength(serialized) + (retained.length ? 1 : 0)
    if (bytes + nextBytes > SNAPSHOT_ARRAY_BYTES) break
    retained.push(value)
    bytes += nextBytes
  }
  return { retained, omitted: values.length - retained.length }
}

function projectedFact(fact) {
  if (!Array.isArray(fact.value)) return fact
  const projection = boundedSnapshotArray(fact.value)
  if (projection.omitted === 0) return fact
  return {
    ...fact,
    status: 'unknown',
    value: projection.retained,
    evidence: {
      ...fact.evidence,
      snapshotTruncated: true,
      originalEntryCount: fact.value.length,
      retainedEntryCount: projection.retained.length
    }
  }
}

function interviewContextSnapshot(contextSnapshot) {
  const code = contextSnapshot.intelligence?.code
  if (!code) return contextSnapshot
  const gitChanges = contextSnapshot.intelligence.gitChanges
  const tables = boundedSnapshotArray(code.tables)
  const packages = boundedSnapshotArray(code.packages)
  const changes = boundedSnapshotArray(gitChanges.changes)
  const facts = contextSnapshot.intelligence.facts.map(projectedFact)
  const ruleDefinitions = contextSnapshot.intelligence.rules?.definitions ?? []
  return {
    ...contextSnapshot,
    intelligence: {
      ...contextSnapshot.intelligence,
      facts,
      evaluation: {
        ...evaluateProjectRules(facts, ruleDefinitions),
        basis: 'durable-projected-facts'
      },
      code: {
        ...code,
        files: [],
        tables: tables.retained,
        packages: packages.retained,
        snapshotProjection: {
          filesOmitted: code.files.length,
          tablesOmitted: tables.omitted,
          packagesOmitted: packages.omitted,
          reason: 'Detailed JVM entries are available from `bth intelligence inspect`; durable interview snapshots keep bounded summaries.'
        }
      },
      gitChanges: {
        ...gitChanges,
        changes: changes.retained,
        snapshotProjection: {
          changesOmitted: changes.omitted
        }
      }
    }
  }
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
    const inspected = options.projectIntelligence ?? await inspectProjectIntelligence(inputPath, options)
    const contextSnapshot = interviewContextSnapshot(inspected)
    const existing = await recoverableTask(inputPath, input.taskId, input.requirement?.trim())
    if (!existing) {
      await createTask(inputPath, {
        id: input.taskId,
        title: input.title,
        context: input.requirement,
        actor: input.actor
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
      nextCommand: nextCommand(input.taskId, created.progress, created.root)
    }
  })
}

export async function answerInterview(inputPath, taskId, input, options = {}) {
  return withProjectVerificationLock(inputPath, options.projectLock, async () => {
    const answered = await recordInterviewAnswer(inputPath, taskId, input, options)
    return {
      ...answered,
      nextCommand: nextCommand(taskId, answered.progress, answered.root)
    }
  })
}

export async function reviseInterview(inputPath, taskId, input, options = {}) {
  return withProjectVerificationLock(inputPath, options.projectLock, async () => {
    const revised = await reviseInterviewAnswer(inputPath, taskId, input, options)
    return {
      ...revised,
      nextCommand: nextCommand(taskId, revised.progress, revised.root)
    }
  })
}

export async function resolveInterviewContradiction(inputPath, taskId, input, options = {}) {
  return withProjectVerificationLock(inputPath, options.projectLock, async () => {
    const resolved = await recordInterviewContradictionResolution(inputPath, taskId, input, options)
    return {
      ...resolved,
      nextCommand: nextCommand(taskId, resolved.progress, resolved.root)
    }
  })
}

export async function rebindInterview(inputPath, taskId, input, options = {}) {
  return withProjectVerificationLock(inputPath, options.projectLock, async () => {
    const contextSnapshot = interviewContextSnapshot(await inspectProjectIntelligence(inputPath, options))
    const rebound = await rebindInterviewContext(inputPath, taskId, {
      actor: input.actor,
      sourceBinding: contextSnapshot.sourceBinding,
      contextSnapshot
    }, options)
    return {
      ...rebound,
      nextCommand: nextCommand(taskId, rebound.progress, rebound.root)
    }
  })
}

export async function interviewStatus(inputPath, taskId) {
  const loaded = await loadInterview(inputPath, taskId)
  return {
    ...loaded,
    nextCommand: loaded.record.status === 'FINALIZED'
      ? 'bth task advance ' + taskId + ' PLAN_APPROVED ' + shellArgument(loaded.root) + ' --by "<reviewer>" --approve'
      : nextCommand(taskId, loaded.progress, loaded.root)
  }
}

async function syncFinalizedPlanToTask(root, taskId, artifacts, artifactDigests, markdown, actor) {
  let task = await loadTask(root, taskId)
  const contextText = taskContextText(artifacts, artifacts.context.project)
  if (task.record.state === 'PLAN_PROPOSED') {
    if (
      task.record.context !== contextText ||
      task.record.plan !== markdown.trim() ||
      task.record.planArtifactSha256 !== artifactDigests.plan
    ) {
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
      sourceFingerprint: artifacts.plan.sourceFingerprint,
      artifactSha256: artifactDigests.plan
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
    const blockingRules = (loaded.contextSnapshot.intelligence?.evaluation?.results ?? [])
      .filter((rule) => rule.severity === 'blocker' && rule.status !== 'confirmed' && rule.outcome !== 'not-applicable')
    if (blockingRules.length > 0) {
      throw new Error(
        'Project rule conflicts or unknown blockers must be resolved and rebound before finalization: ' +
        blockingRules.map((rule) => rule.id + '=' + rule.status).join(', ')
      )
    }
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
    const task = await syncFinalizedPlanToTask(
      finalized.root,
      taskId,
      artifacts,
      finalized.record.artifactDigests,
      markdown,
      input.actor
    )
    return {
      ...finalized,
      artifacts,
      task: task.record,
      planPath: finalized.path + '/plan.md',
      nextCommand: 'bth task advance ' + taskId + ' PLAN_APPROVED ' + shellArgument(finalized.root) + ' --by "<reviewer>" --approve'
    }
  })
}
