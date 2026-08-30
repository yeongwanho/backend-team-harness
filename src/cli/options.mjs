import { bthError } from '../core/errors.mjs'

export function parseArguments(args, schema = {}) {
  const booleans = new Set(schema.booleans ?? [])
  const values = new Set(schema.values ?? [])
  const positionals = []
  const flags = new Set()
  const options = new Map()
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]
    if (!token.startsWith('-')) {
      positionals.push(token)
    } else if (booleans.has(token)) {
      flags.add(token)
    } else if (values.has(token)) {
      const value = args[index + 1]
      if (!value || value.startsWith('-')) throw bthError('cli_option_value_required', 'Option requires a value: ' + token, { option: token })
      options.set(token, value)
      index += 1
    } else {
      throw bthError('cli_unknown_option', 'Unknown option: ' + token, { option: token })
    }
  }
  return { positionals, flags, options }
}

export function parseJsonObjectOption(value, optionName) {
  if (value === undefined) return undefined
  let parsed
  try { parsed = JSON.parse(value) } catch { throw bthError('cli_invalid_json', optionName + ' must be valid JSON.', { option: optionName }) }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw bthError('cli_invalid_json_object', optionName + ' must be a JSON object.', { option: optionName })
  return parsed
}

export function parseJsonArrayOption(value, optionName) {
  if (value === undefined) return undefined
  let parsed
  try { parsed = JSON.parse(value) } catch { throw bthError('cli_invalid_json', optionName + ' must be valid JSON.', { option: optionName }) }
  if (!Array.isArray(parsed)) throw bthError('cli_invalid_json_array', optionName + ' must be a JSON array.', { option: optionName })
  return parsed
}

export function parseNumericOption(value, optionName, kind = 'integer') {
  if (value === undefined) return undefined
  const parsed = kind === 'number' ? Number(value) : Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || (kind === 'integer' && (!Number.isSafeInteger(parsed) || String(parsed) !== value))) {
    throw bthError('cli_invalid_number', optionName + ' must be a valid ' + kind + '.', { option: optionName, kind })
  }
  return parsed
}

export function assertPositionalCount(values, minimum, maximum, usage) {
  if (values.length < minimum || values.length > maximum) throw bthError('cli_invalid_arguments', 'Usage: ' + usage, { usage })
}

function stripProcessTails(value) {
  if (Array.isArray(value)) return value.map(stripProcessTails)
  if (!value || typeof value !== 'object') return value
  const outputRecord = typeof value.sha256 === 'string' && Number.isSafeInteger(value.bytes)
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !(outputRecord && key === 'tail'))
    .map(([key, entry]) => [key, stripProcessTails(entry)]))
}

export function printResult(value, json, fallback) {
  if (json) console.log(JSON.stringify(stripProcessTails(value), null, 2))
  else fallback()
}

export function acknowledgedNetworkRisk(parsed) {
  if (parsed.flags.has('--allow-network')) {
    console.error('Warning: --allow-network is deprecated because BTH does not isolate egress. Use --acknowledge-network-risk.')
  }
  return parsed.flags.has('--acknowledge-network-risk') || parsed.flags.has('--allow-network')
}
