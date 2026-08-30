const MAX_QUERY_CHARACTERS = 64 * 1024

function boundedText(value) {
  return typeof value === 'string' ? value.slice(0, MAX_QUERY_CHARACTERS).trim() : ''
}

// Search is an advisory projection of the task, not its execution instructions.
// Boilerplate verification steps must not displace the user's requested change.
// Callers still deliver the complete approved context/plan through their normal
// payload and retain every rule, approval, source-binding and verification gate.
export function selectTaskRetrievalQuery(task, interviewRequirement) {
  if (!task || typeof task !== 'object' || Array.isArray(task)) return ''
  // Finalized interviews replace task.context with a multi-section summary.
  // Prefer the original requirement from the validated interview when present.
  const requirement = boundedText(interviewRequirement)
  if (requirement) return requirement
  const context = boundedText(task.context)
  if (context) return context
  const title = boundedText(task.title)
  if (title && title !== task.id) return title
  return boundedText(task.plan)
}
