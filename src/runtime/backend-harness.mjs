import { createBuildTestTool } from '../adapters/build-test-tool.mjs'
import { assertToolAllowed } from '../policy/tool-gate.mjs'
import { createToolRegistry } from '../core/tool-registry.mjs'
import { verifyTask as verifyWithRegistry } from '../core/verify-task.mjs'

export function createBackendToolRegistry(options = {}) {
  return createToolRegistry({
    tools: [createBuildTestTool(options)],
    beforeExecute: assertToolAllowed
  })
}

export function verifyTask(inputPath, taskId, options = {}) {
  const registry = options.registry ?? createBackendToolRegistry(options)
  return verifyWithRegistry(inputPath, taskId, { ...options, registry })
}
