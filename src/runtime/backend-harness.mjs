import { createVerificationTool } from '../adapters/verification-tool.mjs'
import { assertToolAllowed } from '../policy/tool-gate.mjs'
import { createToolRegistry } from '../core/tool-registry.mjs'
import { captureSourceBinding } from '../core/source-binding.mjs'
import { recordProjectRun } from '../core/run-record-store.mjs'
import { verifyTask as verifyWithRegistry } from '../core/verify-task.mjs'

export function createBackendToolRegistry(options = {}) {
  return createToolRegistry({
    tools: [createVerificationTool(options)],
    beforeExecute: assertToolAllowed
  })
}

export async function verifyTask(inputPath, taskId, options = {}) {
  const sourceBinder = options.captureSourceBinding ?? (() => captureSourceBinding(inputPath))
  const registry = options.registry ?? createBackendToolRegistry({ ...options, captureSourceBinding: sourceBinder })
  return verifyWithRegistry(inputPath, taskId, {
    ...options,
    registry,
    captureSourceBinding: sourceBinder
  })
}

export async function checkProject(inputPath, options = {}) {
  const sourceBinder = options.captureSourceBinding ?? (() => captureSourceBinding(inputPath))
  const sourceBinding = options.sourceBinding ?? await sourceBinder()
  const registry = options.registry ?? createBackendToolRegistry({ ...options, captureSourceBinding: sourceBinder })
  let result = null
  let failure = null
  try {
    result = await registry.execute('verification.run', {}, {
      root: inputPath,
      task: { id: null, state: 'VERIFYING' },
      sourceBinding,
      approval: { network: false, write: false }
    })
  } catch (error) {
    failure = {
      code: error?.code ?? null,
      message: error instanceof Error ? error.message : String(error)
    }
  }
  const confirmed = failure === null && result?.passed === true && result.tests?.tests > 0
  const run = await recordProjectRun(inputPath, {
    confirmed,
    sourceBinding,
    result,
    failure
  })
  return { root: inputPath, confirmed, sourceBinding, result, failure, run }
}
