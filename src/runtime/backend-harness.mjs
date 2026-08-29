import { createVerificationTool } from '../adapters/verification-tool.mjs'
import { assertToolAllowed } from '../policy/tool-gate.mjs'
import { createToolRegistry } from '../core/tool-registry.mjs'
import { captureSourceBinding } from '../core/source-binding.mjs'
import { recordProjectRun } from '../core/run-record-store.mjs'
import { withProjectVerificationLock } from '../core/project-lock.mjs'
import { verifyTask as verifyWithRegistry } from '../core/verify-task.mjs'
import { loadVerificationConfig, verificationInputPaths } from '../config/verification.mjs'

async function configuredSourceBinder(inputPath, options) {
  if (options.captureSourceBinding) {
    return options.captureSourceBinding
  }
  const loaded = await loadVerificationConfig(inputPath)
  const explicitPaths = verificationInputPaths(loaded.config)
  const allowSymlinkPaths = loaded.config.gates.map((gate) => gate.command[0])
  return () => captureSourceBinding(inputPath, { explicitPaths, allowSymlinkPaths })
}

export async function captureConfiguredSourceBinding(inputPath) {
  const loaded = await loadVerificationConfig(inputPath)
  return captureSourceBinding(inputPath, {
    explicitPaths: verificationInputPaths(loaded.config),
    allowSymlinkPaths: loaded.config.gates.map((gate) => gate.command[0])
  })
}

export function createBackendToolRegistry(options = {}) {
  return createToolRegistry({
    tools: [createVerificationTool(options)],
    beforeExecute: assertToolAllowed
  })
}

export async function verifyTask(inputPath, taskId, options = {}) {
  return withProjectVerificationLock(inputPath, options.projectLock, async () => {
    const sourceBinder = await configuredSourceBinder(inputPath, options)
    const registry = options.registry ?? createBackendToolRegistry({ ...options, captureSourceBinding: sourceBinder })
    return verifyWithRegistry(inputPath, taskId, {
      ...options,
      registry,
      captureSourceBinding: sourceBinder
    })
  })
}

export async function checkProject(inputPath, options = {}) {
  return withProjectVerificationLock(inputPath, options.projectLock, async () => {
    const sourceBinder = await configuredSourceBinder(inputPath, options)
    const sourceBinding = options.sourceBinding ?? await sourceBinder()
    const registry = options.registry ?? createBackendToolRegistry({ ...options, captureSourceBinding: sourceBinder })
    let result = null
    let failure = null
    try {
      result = await registry.execute('verification.run', {}, {
        root: inputPath,
        operation: { id: 'project-check', state: 'CHECKING' },
        sourceBinding,
        approval: { network: options.allowNetwork === true, write: false }
      })
    } catch (error) {
      failure = {
        code: error?.code ?? null,
        message: error instanceof Error ? error.message : String(error)
      }
    }
    const confirmed = failure === null && result?.passed === true && result.tests?.executed > 0
    const run = await recordProjectRun(inputPath, {
      confirmed,
      sourceBinding,
      result,
      failure
    })
    return { root: inputPath, confirmed, sourceBinding, result, failure, run }
  })
}
