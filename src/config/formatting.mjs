import { isAbsolute, posix } from 'node:path'
import { bthError } from '../core/errors.mjs'

function invalid(message) { throw bthError('formatting_config_invalid', message) }
function path(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096 || /[\0\r\n]/.test(value)) invalid('formatting path must be a bounded project-relative file.')
  const normalized = value.replaceAll('\\', '/')
  if (isAbsolute(normalized) || /^[A-Za-z]:/.test(normalized) || normalized.split('/').some(part => !part || part === '..')) invalid('formatting paths must stay inside the project.')
  const result = posix.normalize(normalized)
  if (result === '.') invalid('formatting paths must name files, not the project root.')
  return result
}

export function parseFormatting(value, schemaVersion) {
  if (schemaVersion !== 2) invalid('formatting requires schemaVersion 2.')
  if (value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('formatting must be an object or null.')
  for (const key of Object.keys(value)) if (!['command', 'inputs', 'network', 'timeoutMs'].includes(key)) invalid('Unknown formatting key: ' + key)
  if (!Array.isArray(value.command) || value.command.length < 1 || value.command.length > 64) invalid('formatting.command must contain 1-64 argv entries.')
  const command = value.command.map((item, index) => {
    if (typeof item !== 'string' || !item || item.length > 4096 || /[\0\r\n]/.test(item)) invalid('formatting.command contains an invalid argument.')
    return index === 0 ? './' + path(item) : item
  })
  if (typeof value.network !== 'boolean') invalid('formatting.network must explicitly be boolean; it is a declaration, not egress isolation.')
  if (!Array.isArray(value.inputs) || value.inputs.length > 64) invalid('formatting.inputs must declare up to 64 project-owned config files.')
  const inputs = [...new Set(value.inputs.map(path))].sort()
  const timeoutMs = value.timeoutMs ?? 60000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600000) invalid('formatting.timeoutMs must be between 1000 and 600000.')
  return { command, inputs, network: value.network, timeoutMs }
}
