export class ToolPermissionError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ToolPermissionError'
    this.code = code
  }
}

export function assertToolAllowed({ tool, task, approval = {} }) {
  if (!task || typeof task.state !== 'string') {
    throw new ToolPermissionError('task_state_missing', 'A persisted task state is required before tool execution.')
  }
  if (!tool.allowedStates.includes(task.state)) {
    throw new ToolPermissionError(
      'task_state_denied',
      'Tool ' + tool.id + ' is not allowed while task ' + task.id + ' is ' + task.state + '.'
    )
  }
  if (tool.network === true && approval.network !== true) {
    throw new ToolPermissionError('network_approval_required', 'Network-capable tools require explicit approval.')
  }
  if (tool.mutatesSource === true && approval.write !== true) {
    throw new ToolPermissionError('write_approval_required', 'Source-writing tools require explicit approval.')
  }
}
