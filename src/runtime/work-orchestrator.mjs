import { createHash } from 'node:crypto'
import { inspectProjectIntelligence } from '../adapters/project-intelligence.mjs'
import { deriveWorkDraft } from '../core/work-draft.mjs'
import { loadTask, advanceTask } from '../core/task-store.mjs'
import { withProjectVerificationLock } from '../core/project-lock.mjs'
import {
  answerInterview,
  completeInterview,
  interviewStatus,
  startInterview
} from './interview-orchestrator.mjs'
import { captureConfiguredSourceBinding } from './backend-harness.mjs'
import { runImplementation } from './implementation-orchestrator.mjs'
import { bthError } from '../core/errors.mjs'

function taskIdFor(requirement) {
  return 'WORK-' + createHash('sha256').update(requirement.trim()).digest('hex').slice(0, 12).toUpperCase()
}

function taskMissing(error) {
  return /Task does not exist/.test(error instanceof Error ? error.message : String(error))
}

function impactText(draft) {
  if (draft.databaseImpact === 'none') return 'No database read, write, schema, or migration impact is approved.'
  if (draft.databaseImpact === 'read') return 'Existing database state may be read; no stored-data or schema change and no migration are approved.'
  if (draft.databaseImpact === 'write') return 'Existing database records may change inside the approved behavior; no schema change or migration is approved.'
  if (draft.schemaStrategy === 'bootstrap-only') return 'Only bootstrap scripts for new empty databases may change. Upgrading existing databases is excluded and unverified. Existing released migrations remain immutable; this decision cannot waive project rules.'
  return 'A schema change and a new append-only migration are approved; existing released migrations remain immutable.'
}

function apiText(draft) {
  if (draft.apiImpact === 'none') return 'No public API contract change is approved.'
  if (draft.apiImpact === 'compatible') return 'A backward-compatible public API addition or change is approved; existing clients must keep working.'
  return 'A breaking public API change is explicitly approved and must be called out in review evidence.'
}

function generatedAnswers(draft) {
  const moduleText = draft.modules.map((module) => '`' + module + '`').join(', ')
  const exclusions = draft.excludedModules.length
    ? ' Excluded modules: ' + draft.excludedModules.map((module) => '`' + module + '`').join(', ') + '.'
    : ''
  return [
    {
      questionId: 'acceptance',
      text: draft.acceptanceCriteria,
      claims: {}
    },
    {
      questionId: 'scope',
      text: 'Only the inferred and human-approved modules may change: ' + moduleText + '.' + exclusions + ' ' + apiText(draft),
      claims: {
        changesPublicApi: draft.changesPublicApi,
        modules: draft.modules,
        excludedModules: draft.excludedModules
      }
    },
    {
      questionId: 'data',
      text: impactText(draft),
      claims: {
        changesDatabase: draft.changesDatabase,
        requiresMigration: draft.requiresMigration,
        ...(draft.schemaStrategy === 'bootstrap-only' ? { bootstrapOnly: true } : {})
      }
    },
    {
      questionId: 'verification',
      text: draft.requiredGates.length
        ? 'Every configured required Gate must pass: ' + draft.requiredGates.join(', ') + '.'
        : 'No executable required Gate was configured; implementation cannot claim verified completion until the project supplies one.',
      claims: { requiredGates: draft.requiredGates }
    },
    {
      questionId: 'constraints',
      text: draft.constraints + ' ' + apiText(draft),
      claims: { preservesCompatibility: draft.preservesCompatibility }
    }
  ]
}

async function existingTask(root, taskId) {
  try {
    return await loadTask(root, taskId)
  } catch (error) {
    if (taskMissing(error)) return null
    throw error
  }
}

async function approvePlan(root, taskId, actor) {
  return withProjectVerificationLock(root, undefined, async () => {
    const task = await loadTask(root, taskId)
    if (task.record.state === 'PLAN_APPROVED') return { applied: false, record: task.record, audit: { reason: 'already-approved' } }
    if (task.record.state === 'IMPLEMENTING' && task.record.approvalReceipt) return { applied: false, record: task.record, audit: { reason: 'already-implementing' } }
    if (task.record.state !== 'PLAN_PROPOSED') {
      throw new Error('Work plan approval requires PLAN_PROPOSED; current state is ' + task.record.state + '.')
    }
    const source = await captureConfiguredSourceBinding(root)
    const interview = await interviewStatus(root, taskId)
    if (interview.record.artifactDigests?.plan !== task.record.planArtifactSha256) {
      throw new Error('Canonical work plan artifact is stale or inconsistent with the task record.')
    }
    return advanceTask(root, taskId, 'PLAN_APPROVED', {
      actor,
      approved: true,
      currentSourceFingerprint: source.fingerprint,
      compatibleSourceFingerprints: source.legacyFingerprint ? [source.legacyFingerprint] : [],
      currentPlanArtifactSha256: task.record.planArtifactSha256
    })
  })
}

async function materializePlan(root, taskId, requirement, actor, draft, projectIntelligence) {
  await startInterview(root, {
    taskId,
    title: requirement.slice(0, 256),
    requirement,
    actor
  }, { projectIntelligence })
  for (const answer of generatedAnswers(draft)) {
    await answerInterview(root, taskId, { ...answer, actor })
  }
  return completeInterview(root, taskId, { actor })
}

export async function runWork(inputPath, input, options = {}) {
  const requirement = typeof input?.requirement === 'string' ? input.requirement.trim() : ''
  if (!requirement) throw bthError('work_requirement_required', 'bth work requires a non-empty requirement.')
  const actor = typeof input.actor === 'string' && input.actor.trim() ? input.actor.trim() : null
  if (!actor) throw bthError('work_actor_required', 'bth work requires an actor.')
  if (options.run === true && options.approve !== true) {
    throw bthError('work_approval_required', 'bth work --run requires --approve so the exact generated plan is reviewed before source writing.')
  }
  const projectIntelligence = await inspectProjectIntelligence(inputPath, options.intelligence)
  const draftResult = deriveWorkDraft({ requirement, context: projectIntelligence, decisions: input.decisions })
  const taskId = input.taskId ?? taskIdFor(requirement)
  const root = projectIntelligence.root ?? inputPath
  if (draftResult.status !== 'ready-for-plan-review') {
    return {
      root,
      taskId,
      ...draftResult,
      nextAction: draftResult.status === 'blocked'
        ? 'Resolve the reported project blocker rules and re-run bth work.'
        : 'Re-run bth work with --decisions JSON containing only the requested decision ids.'
    }
  }

  let task = await existingTask(root, taskId)
  let plan = null
  if (!task) {
    plan = await materializePlan(root, taskId, requirement, actor, draftResult.draft, projectIntelligence)
    task = await loadTask(root, taskId)
  } else {
    const interview = await interviewStatus(root, taskId)
    if (interview.record.requirement !== requirement) {
      throw bthError('work_requirement_mismatch', 'Existing work task ' + taskId + ' belongs to a different requirement.', { taskId })
    }
  }

  let approval = null
  if (options.approve === true) {
    approval = await approvePlan(root, taskId, actor)
    task = await loadTask(root, taskId)
  }
  let implementation = null
  if (options.run === true) {
    implementation = await runImplementation(root, taskId, {
      actor,
      allowWrite: options.allowWrite,
      allowNetwork: options.allowNetwork,
      providerProbe: options.providerProbe,
      providerRunner: options.providerRunner,
      preparationRunner: options.preparationRunner
    })
    task = await loadTask(root, taskId)
  }
  return {
    root,
    taskId,
    status: implementation
      ? implementation.record.status === 'passed'
        ? implementation.preservationReview && implementation.preservationReview.status !== 'not-required'
          ? 'implementation-needs-review' : 'implementation-passed'
        : 'implementation-failed'
      : task.record.state === 'IMPLEMENTING' ? 'implementation-in-progress' : task.record.state === 'PLAN_APPROVED' ? 'plan-approved' : 'plan-proposed',
    draft: draftResult,
    planPath: plan?.planPath ?? '.backend-harness/tasks/' + taskId + '/interview/plan.md',
    task: task.record,
    approval,
    implementation,
    nextAction: implementation
      ? implementation.nextAction
      : ['PLAN_APPROVED', 'IMPLEMENTING'].includes(task.record.state)
        ? 'Re-run with --approve --run --allow-write after confirming the implementation provider.'
        : 'Review the generated plan and re-run the same command with --approve.'
  }
}
