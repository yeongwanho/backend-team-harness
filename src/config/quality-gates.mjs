import { readdir, readFile } from 'node:fs/promises'
import { basename, extname, resolve } from 'node:path'
import { resolveSafeProjectPath, statPath } from '../fs-safety.mjs'

const IDENTIFIER = /^[a-z][a-z0-9-]*$/
const TOP_LEVEL_KEYS = new Set(['name', 'required', 'checks'])

export function parseQualityGate(text, source = '<inline>') {
  const result = { name: null, required: null, checks: [] }
  const seen = new Set()
  let readingChecks = false

  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const lineNumber = index + 1
    if (!rawLine.trim() || rawLine.trimStart().startsWith('#')) {
      continue
    }
    if (rawLine.includes('\t')) {
      throw new Error(source + ':' + lineNumber + ': tabs are not allowed')
    }

    const item = rawLine.match(/^  - ([a-z][a-z0-9-]*)$/)
    if (item) {
      if (!readingChecks) {
        throw new Error(source + ':' + lineNumber + ': list item is only valid under checks')
      }
      if (result.checks.includes(item[1])) {
        throw new Error(source + ':' + lineNumber + ': duplicate check id ' + item[1])
      }
      result.checks.push(item[1])
      continue
    }

    const property = rawLine.match(/^([a-z][a-z0-9-]*):(?: (.*))?$/)
    if (!property) {
      throw new Error(source + ':' + lineNumber + ': unsupported YAML syntax')
    }
    const [, key, rawValue = ''] = property
    if (!TOP_LEVEL_KEYS.has(key)) {
      throw new Error(source + ':' + lineNumber + ': unknown key ' + key)
    }
    if (seen.has(key)) {
      throw new Error(source + ':' + lineNumber + ': duplicate key ' + key)
    }
    seen.add(key)
    readingChecks = key === 'checks'

    if (key === 'checks') {
      if (rawValue) {
        throw new Error(source + ':' + lineNumber + ': checks must be a block list')
      }
    } else if (key === 'name') {
      if (!IDENTIFIER.test(rawValue)) {
        throw new Error(source + ':' + lineNumber + ': invalid gate name')
      }
      result.name = rawValue
    } else if (key === 'required') {
      if (rawValue !== 'true' && rawValue !== 'false') {
        throw new Error(source + ':' + lineNumber + ': required must be true or false')
      }
      result.required = rawValue === 'true'
    }
  }

  for (const key of TOP_LEVEL_KEYS) {
    if (!seen.has(key)) {
      throw new Error(source + ': missing required key ' + key)
    }
  }
  if (result.checks.length === 0) {
    throw new Error(source + ': checks must contain at least one id')
  }
  return result
}

export async function loadQualityGates(inputPath) {
  const root = inputPath
  const gatesDir = await resolveSafeProjectPath(root, '.backend-harness/quality-gates')
  const directoryStat = await statPath(gatesDir)
  if (!directoryStat?.isDirectory() || directoryStat.isSymbolicLink()) {
    return { gates: [], diagnostics: ['Review-checklist directory is missing or is not a real directory.'] }
  }

  const entries = await readdir(gatesDir, { withFileTypes: true })
  const gateFiles = entries
    .filter((entry) => entry.isFile() && ['.yaml', '.yml'].includes(extname(entry.name)))
    .sort((left, right) => left.name.localeCompare(right.name))

  if (gateFiles.length === 0) {
    return { gates: [], diagnostics: ['No review-checklist YAML files were found.'] }
  }

  const gates = []
  const diagnostics = []
  const names = new Set()
  for (const entry of gateFiles) {
    const path = resolve(gatesDir, entry.name)
    try {
      const gate = parseQualityGate(await readFile(path, 'utf8'), entry.name)
      const expectedName = basename(entry.name, extname(entry.name))
      if (gate.name !== expectedName) {
        throw new Error(entry.name + ': gate name must match the filename (' + expectedName + ')')
      }
      if (names.has(gate.name)) {
        throw new Error(entry.name + ': duplicate gate name ' + gate.name)
      }
      names.add(gate.name)
      gates.push({ ...gate, file: entry.name })
    } catch (error) {
      diagnostics.push(error instanceof Error ? error.message : String(error))
    }
  }

  return { gates, diagnostics }
}
