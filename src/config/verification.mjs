import { constants } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { isAbsolute, posix, relative } from 'node:path'
import { resolveSafeProjectPath, statPath } from '../fs-safety.mjs'

const GATE_ID = /^[a-z][a-z0-9-]{0,63}$/
const CONFIG_KEYS = new Set(['schemaVersion', 'gates'])
const GATE_KEYS = new Set(['id', 'required', 'command', 'timeoutMs', 'result'])
const RESULT_KEYS = new Set(['type', 'reports', 'minimumTests'])

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(label + ' must be an object.')
  }
}

function assertOnlyKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(label + ' contains unknown key: ' + key)
    }
  }
}

function normalizeProjectRelativePath(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
    throw new Error(label + ' must be a non-empty project-relative path.')
  }
  const normalized = value.replaceAll('\\', '/')
  if (isAbsolute(normalized) || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error(label + ' must not be absolute.')
  }
  const withoutDot = normalized.startsWith('./') ? normalized.slice(2) : normalized
  if (!withoutDot || withoutDot.split('/').some((part) => part === '..' || part === '')) {
    throw new Error(label + ' cannot traverse or contain empty path segments.')
  }
  return posix.normalize(withoutDot)
}

function validateCommand(command, label) {
  if (!Array.isArray(command) || command.length === 0 || command.length > 64) {
    throw new Error(label + ' must contain 1-64 argv entries.')
  }
  const normalized = command.map((entry, index) => {
    if (typeof entry !== 'string' || !entry || entry.includes('\0') || entry.length > 4096) {
      throw new Error(label + '[' + index + '] must be a non-empty bounded string.')
    }
    return entry
  })
  normalizeProjectRelativePath(normalized[0], label + '[0]')
  return normalized
}

function validateResult(result, label) {
  assertPlainObject(result, label)
  assertOnlyKeys(result, RESULT_KEYS, label)
  if (result.type !== 'junit' && result.type !== 'exit-code') {
    throw new Error(label + '.type must be junit or exit-code.')
  }
  if (result.type === 'exit-code') {
    if (result.reports !== undefined || result.minimumTests !== undefined) {
      throw new Error(label + ' cannot define reports or minimumTests for exit-code results.')
    }
    return { type: 'exit-code' }
  }
  if (!Array.isArray(result.reports) || result.reports.length === 0 || result.reports.length > 32) {
    throw new Error(label + '.reports must contain 1-32 project-relative glob patterns.')
  }
  const reports = result.reports.map((pattern, index) =>
    normalizeProjectRelativePath(pattern, label + '.reports[' + index + ']')
  )
  const minimumTests = result.minimumTests ?? 1
  if (!Number.isSafeInteger(minimumTests) || minimumTests < 1 || minimumTests > 1_000_000) {
    throw new Error(label + '.minimumTests must be an integer between 1 and 1000000.')
  }
  return { type: 'junit', reports, minimumTests }
}

export function parseVerificationConfig(text, source = '<inline>') {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error(source + ': invalid JSON: ' + error.message)
  }
  assertPlainObject(parsed, source)
  assertOnlyKeys(parsed, CONFIG_KEYS, source)
  if (parsed.schemaVersion !== 1) {
    throw new Error(source + ': schemaVersion must be 1.')
  }
  if (!Array.isArray(parsed.gates) || parsed.gates.length === 0 || parsed.gates.length > 32) {
    throw new Error(source + ': gates must contain 1-32 entries.')
  }

  const ids = new Set()
  const gates = parsed.gates.map((gate, index) => {
    const label = source + ': gates[' + index + ']'
    assertPlainObject(gate, label)
    assertOnlyKeys(gate, GATE_KEYS, label)
    if (typeof gate.id !== 'string' || !GATE_ID.test(gate.id)) {
      throw new Error(label + '.id is invalid.')
    }
    if (ids.has(gate.id)) {
      throw new Error(source + ': duplicate gate id ' + gate.id + '.')
    }
    ids.add(gate.id)
    if (typeof gate.required !== 'boolean') {
      throw new Error(label + '.required must be boolean.')
    }
    const timeoutMs = gate.timeoutMs ?? 10 * 60 * 1000
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60 * 60 * 1000) {
      throw new Error(label + '.timeoutMs must be between 1000 and 3600000.')
    }
    return {
      id: gate.id,
      required: gate.required,
      command: validateCommand(gate.command, label + '.command'),
      timeoutMs,
      result: validateResult(gate.result, label + '.result')
    }
  })

  if (!gates.some((gate) => gate.required && gate.result.type === 'junit')) {
    throw new Error(source + ': at least one required junit gate is necessary to prevent untested success.')
  }
  return { schemaVersion: 1, gates }
}

async function regularFile(root, path) {
  const target = await resolveSafeProjectPath(root, path)
  const stat = await statPath(target)
  return Boolean(stat?.isFile() && !stat.isSymbolicLink())
}

export async function defaultVerificationConfig(root) {
  const windows = process.platform === 'win32'
  if (await regularFile(root, 'build.gradle') || await regularFile(root, 'build.gradle.kts')) {
    return {
      schemaVersion: 1,
      gates: [{
        id: 'tests',
        required: true,
        command: [windows ? './gradlew.bat' : './gradlew', 'test', '--offline', '--no-daemon', '--console=plain', '--rerun-tasks'],
        timeoutMs: 600000,
        result: {
          type: 'junit',
          reports: ['build/test-results/**/*.xml'],
          minimumTests: 1
        }
      }]
    }
  }
  if (await regularFile(root, 'pom.xml')) {
    return {
      schemaVersion: 1,
      gates: [{
        id: 'tests',
        required: true,
        command: [windows ? './mvnw.cmd' : './mvnw', '-o', '-B', 'verify'],
        timeoutMs: 600000,
        result: {
          type: 'junit',
          reports: ['target/surefire-reports/*.xml', 'target/failsafe-reports/*.xml'],
          minimumTests: 1
        }
      }]
    }
  }
  return null
}

export async function loadVerificationConfig(root, options = {}) {
  const path = await resolveSafeProjectPath(root, '.backend-harness/verification.json')
  const stat = await statPath(path)
  if (stat) {
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error('Verification config must be a regular non-symlink file.')
    }
    return {
      config: parseVerificationConfig(await readFile(path, 'utf8'), '.backend-harness/verification.json'),
      source: '.backend-harness/verification.json'
    }
  }
  if (options.allowInferred === false) {
    throw new Error('Verification config is missing. Run `bth init <path>` or create .backend-harness/verification.json.')
  }
  const inferred = await defaultVerificationConfig(root)
  if (!inferred) {
    throw new Error('Verification config is missing and no Gradle/Maven project default can be inferred.')
  }
  return { config: inferred, source: 'inferred-jvm-default' }
}

export async function resolveGateExecutable(root, command) {
  const relativePath = normalizeProjectRelativePath(command[0], 'gate command')
  const path = await resolveSafeProjectPath(root, relativePath)
  const stat = await statPath(path)
  if (!stat?.isFile() || stat.isSymbolicLink()) {
    throw new Error('Gate executable is missing or unsafe: ' + command[0])
  }
  if (process.platform !== 'win32') {
    try {
      await access(path, constants.X_OK)
    } catch {
      throw new Error('Gate executable is not executable: ' + command[0])
    }
  }
  return { path, displayPath: './' + relative(root, path).split('\\').join('/') }
}
