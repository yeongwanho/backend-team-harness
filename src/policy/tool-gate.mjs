export class ToolPermissionError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ToolPermissionError'
    this.code = code
  }
}

export function assertToolAllowed({ tool, task, operation, approval = {} }) {
  const execution = task && typeof task.state === 'string'
    ? task
    : operation && typeof operation.state === 'string'
      ? operation
      : null
  if (!execution) {
    throw new ToolPermissionError('execution_state_missing', 'A persisted task or explicit operation state is required before tool execution.')
  }
  if (!tool.allowedStates.includes(execution.state)) {
    throw new ToolPermissionError(
      'execution_state_denied',
      'Tool ' + tool.id + ' is not allowed while ' + execution.id + ' is ' + execution.state + '.'
    )
  }
  if (tool.network === true && approval.network !== true) {
    throw new ToolPermissionError('network_approval_required', 'Network-capable tools require explicit approval.')
  }
  if (tool.mutatesSource === true && approval.write !== true) {
    throw new ToolPermissionError('write_approval_required', 'Source-writing tools require explicit approval.')
  }
}
