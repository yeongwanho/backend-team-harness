import { readFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { resolveSafeProjectPath, statPath } from '../fs-safety.mjs'

const MAX_RULE_FILE_BYTES = 1024 * 1024
const MAX_RULE_SOURCE_BYTES = 1024 * 1024
const MAX_RULES = 256
const MAX_CONDITION_DEPTH = 8
const MAX_CONDITION_NODES = 1024
const IDENTIFIER = /^[a-z][a-z0-9.-]{0,127}$/
const RULE_KEYS = new Set(['id', 'description', 'severity', 'when', 'assert', 'source'])
const SOURCE_KEYS = new Set(['path', 'section'])
const CONDITION_OPERATORS = new Set(['equals', 'not-equals', 'present', 'includes'])
const SCALAR_TYPES = new Set(['string', 'number', 'boolean'])

function plainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype)
}

function boundedString(value, label, maximum = 2048) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum || value.includes('\0')) {
    throw new Error(label + ' must be a non-empty string of at most ' + maximum + ' characters.')
  }
  return value
}

function rejectUnknownKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(label + ': unknown key ' + key)
    }
  }
}

function validateComparable(value, label) {
  if (value === null || !SCALAR_TYPES.has(typeof value) || (typeof value === 'number' && !Number.isFinite(value))) {
    throw new Error(label + ' must be a finite string, number, or boolean.')
  }
}

function validateCondition(condition, state, depth = 0, label = 'condition') {
  if (depth > MAX_CONDITION_DEPTH) {
    throw new Error(label + ': condition nesting exceeds ' + MAX_CONDITION_DEPTH + '.')
  }
  state.nodes += 1
  if (state.nodes > MAX_CONDITION_NODES) {
    throw new Error(label + ': condition node count exceeds ' + MAX_CONDITION_NODES + '.')
  }
  if (!plainObject(condition)) {
    throw new Error(label + ' must be an object.')
  }

  const variants = ['fact', 'all', 'any', 'not'].filter((key) => Object.hasOwn(condition, key))
  if (variants.length !== 1) {
    throw new Error(label + ' must contain exactly one of fact, all, any, or not.')
  }
  const variant = variants[0]
  if (variant === 'fact') {
    rejectUnknownKeys(condition, new Set(['fact', 'operator', 'value']), label)
    if (typeof condition.fact !== 'string' || !IDENTIFIER.test(condition.fact)) {
      throw new Error(label + ': invalid fact id.')
    }
    if (!CONDITION_OPERATORS.has(condition.operator)) {
      throw new Error(label + ': unsupported operator ' + condition.operator + '.')
    }
    if (condition.operator === 'present') {
      if (Object.hasOwn(condition, 'value')) {
        throw new Error(label + ': present must not include a value.')
      }
    } else {
      if (!Object.hasOwn(condition, 'value')) {
        throw new Error(label + ': ' + condition.operator + ' requires a value.')
      }
      validateComparable(condition.value, label + '.value')
    }
    return
  }
  if (variant === 'not') {
    rejectUnknownKeys(condition, new Set(['not']), label)
    validateCondition(condition.not, state, depth + 1, label + '.not')
    return
  }

  rejectUnknownKeys(condition, new Set([variant]), label)
  const children = condition[variant]
  if (!Array.isArray(children) || children.length < 2 || children.length > 32) {
    throw new Error(label + '.' + variant + ' must contain between 2 and 32 conditions.')
  }
  children.forEach((child, index) => validateCondition(child, state, depth + 1, label + '.' + variant + '[' + index + ']'))
}

function validateSource(source, label) {
  if (!plainObject(source)) {
    throw new Error(label + ' must be an object.')
  }
  rejectUnknownKeys(source, SOURCE_KEYS, label)
  boundedString(source.path, label + '.path', 512)
  if (isAbsolute(source.path) || source.path.split(/[\\/]/).includes('..')) {
    throw new Error(label + '.path must stay project-relative.')
  }
  if (!source.path.toLowerCase().endsWith('.md')) {
    throw new Error(label + '.path must reference a Markdown policy document.')
  }
  boundedString(source.section, label + '.section', 512)
}

function validateRule(rule, index) {
  const label = 'rules[' + index + ']'
  if (!plainObject(rule)) {
    throw new Error(label + ' must be an object.')
  }
  rejectUnknownKeys(rule, RULE_KEYS, label)
  if (typeof rule.id !== 'string' || !IDENTIFIER.test(rule.id)) {
    throw new Error(label + ': invalid rule id.')
  }
  boundedString(rule.description, label + '.description', 4096)
  if (!['blocker', 'warning', 'advisory'].includes(rule.severity)) {
    throw new Error(label + '.severity must be blocker, warning, or advisory.')
  }
  const state = { nodes: 0 }
  if (rule.when !== undefined) {
    validateCondition(rule.when, state, 0, label + '.when')
  }
  validateCondition(rule.assert, state, 0, label + '.assert')
  validateSource(rule.source, label + '.source')
}

export function parseProjectRules(text, source = '<inline>') {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_RULE_FILE_BYTES) {
    throw new Error(source + ': project-rule contract exceeds the ' + MAX_RULE_FILE_BYTES + '-byte limit.')
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error(source + ': invalid JSON: ' + (error instanceof Error ? error.message : String(error)))
  }
  if (!plainObject(parsed)) {
    throw new Error(source + ': project-rule contract must be an object.')
  }
  rejectUnknownKeys(parsed, new Set(['schemaVersion', 'rules']), source)
  if (parsed.schemaVersion !== 1) {
    throw new Error(source + ': schemaVersion must be 1.')
  }
  if (!Array.isArray(parsed.rules) || parsed.rules.length > MAX_RULES) {
    throw new Error(source + ': rules must be an array with at most ' + MAX_RULES + ' entries.')
  }
  const ids = new Set()
  parsed.rules.forEach((rule, index) => {
    validateRule(rule, index)
    if (ids.has(rule.id)) {
      throw new Error(source + ': duplicate rule id ' + rule.id + '.')
    }
    ids.add(rule.id)
  })
  return parsed
}

export async function loadProjectRules(root) {
  const relativePath = '.backend-harness/project-rules.json'
  const path = await resolveSafeProjectPath(root, relativePath)
  const metadata = await statPath(path)
  if (!metadata) {
    return {
      schemaVersion: 1,
      source: null,
      rules: [],
      diagnostics: ['Project rules are not configured at ' + relativePath + '.']
    }
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error('Project-rule contract must be a regular non-symbolic link file.')
  }
  if (metadata.size > MAX_RULE_FILE_BYTES) {
    throw new Error('Project-rule contract exceeds the ' + MAX_RULE_FILE_BYTES + '-byte limit.')
  }
  const parsed = parseProjectRules(await readFile(path, 'utf8'), relativePath)
  const sources = new Map()
  for (const rule of parsed.rules) {
    let headings = sources.get(rule.source.path)
    if (!headings) {
      const sourcePath = await resolveSafeProjectPath(root, rule.source.path)
      const sourceMetadata = await statPath(sourcePath)
      if (!sourceMetadata?.isFile() || sourceMetadata.isSymbolicLink()) {
        throw new Error('Project rule ' + rule.id + ' source must be a regular non-symbolic link file: ' + rule.source.path)
      }
      if (sourceMetadata.size > MAX_RULE_SOURCE_BYTES) {
        throw new Error('Project rule ' + rule.id + ' source exceeds the ' + MAX_RULE_SOURCE_BYTES + '-byte limit: ' + rule.source.path)
      }
      const text = await readFile(sourcePath, 'utf8')
      headings = new Set(text.split(/\r?\n/).flatMap((line) => {
        const match = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)
        return match ? [match[1].trim()] : []
      }))
      sources.set(rule.source.path, headings)
    }
    if (!headings.has(rule.source.section)) {
      throw new Error('Project rule ' + rule.id + ' source section was not found: ' + rule.source.path + ' # ' + rule.source.section)
    }
  }
  return { ...parsed, source: relativePath, diagnostics: [] }
}
