function validateTool(tool) {
  if (!tool || typeof tool.id !== 'string' || !tool.id.trim()) {
    throw new Error('Tool definition requires a non-empty id.')
  }
  if (!Array.isArray(tool.allowedStates) || tool.allowedStates.length === 0) {
    throw new Error('Tool ' + tool.id + ' requires at least one allowed task state.')
  }
  if (typeof tool.execute !== 'function') {
    throw new Error('Tool ' + tool.id + ' requires an execute function.')
  }
}

export function createToolRegistry({ tools = [], beforeExecute } = {}) {
  const definitions = new Map()
  for (const tool of tools) {
    validateTool(tool)
    if (definitions.has(tool.id)) {
      throw new Error('Duplicate tool id: ' + tool.id)
    }
    definitions.set(tool.id, Object.freeze({
      network: false,
      mutatesSource: false,
      ...tool,
      allowedStates: Object.freeze([...tool.allowedStates])
    }))
  }

  return Object.freeze({
    list() {
      return [...definitions.values()].map(({ execute: _execute, ...definition }) => definition)
    },
    get(toolId) {
      return definitions.get(toolId) ?? null
    },
    async execute(toolId, invocation, context) {
      const tool = definitions.get(toolId)
      if (!tool) {
        throw new Error('Unregistered tool: ' + toolId)
      }
      if (beforeExecute) {
        await beforeExecute({ tool, invocation, ...context })
      }
      return tool.execute(invocation, context)
    }
  })
}
