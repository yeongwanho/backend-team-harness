import { constants } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { isAbsolute, posix, relative } from 'node:path'
import { resolveSafeProjectPath, statPath } from '../fs-safety.mjs'
import { projectExecutableForPlatform } from '../core/platform.mjs'
import { reportGlobBase, reportPatternsMayOverlap } from '../core/report-glob.mjs'
import { inspectJvmBuild } from '../core/jvm-build-discovery.mjs'
import { scanProjectManifest } from '../core/project-manifest.mjs'
import { inspectPortableTestBuild, portableVerificationConfig } from '../core/portable-test-discovery.mjs'

const GATE_ID = /^[a-z][a-z0-9-]{0,63}$/
const CONFIG_KEYS = new Set(['schemaVersion', 'context', 'scheduling', 'gates'])
const CONTEXT_KEYS = new Set(['profile', 'databaseDialect'])
const SCHEDULING_KEYS = new Set(['strategy', 'minimumObservations', 'priorFailures', 'priorPasses', 'maxParallel'])
const GATE_KEYS = new Set(['id', 'required', 'reorderable', 'dependsOn', 'parallelSafe', 'resourceClass', 'network', 'feedback', 'pathPrefixes', 'command', 'inputs', 'timeoutMs', 'result'])
const RESULT_KEYS = new Set(['type', 'reports', 'minimumTests', 'blockingSeverities'])
const FINDING_SEVERITIES = new Set(['info', 'warning', 'error', 'low', 'medium', 'high', 'critical'])

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
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || value.length > 4096) {
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

function validateInputs(inputs, label) {
  if (inputs === undefined) {
    return []
  }
  if (!Array.isArray(inputs) || inputs.length > 64) {
    throw new Error(label + ' must contain at most 64 project-relative files.')
  }
  return [...new Set(inputs.map((entry, index) => normalizeProjectRelativePath(entry, label + '[' + index + ']')))]
}

function validateDependencies(dependencies, label) {
  if (dependencies === undefined) return []
  if (!Array.isArray(dependencies) || dependencies.length > 31) {
    throw new Error(label + ' must contain at most 31 gate ids.')
  }
  const normalized = []
  for (const [index, dependency] of dependencies.entries()) {
    if (typeof dependency !== 'string' || !GATE_ID.test(dependency)) {
      throw new Error(label + '[' + index + '] is invalid.')
    }
    if (normalized.includes(dependency)) {
      throw new Error(label + ' contains duplicate gate id ' + dependency + '.')
    }
    normalized.push(dependency)
  }
  return normalized
}

function validateContext(context, label) {
  if (context === undefined) {
    return { profile: null, databaseDialect: null }
  }
  assertPlainObject(context, label)
  assertOnlyKeys(context, CONTEXT_KEYS, label)
  const normalized = {}
  for (const key of CONTEXT_KEYS) {
    const value = context[key]
    if (value === undefined || value === null) {
      normalized[key] = null
      continue
    }
    if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) {
      throw new Error(label + '.' + key + ' must be a bounded identifier.')
    }
    normalized[key] = value
  }
  return normalized
}

function boundedPositiveInteger(value, fallback, label, maximum) {
  const normalized = value ?? fallback
  if (!Number.isSafeInteger(normalized) || normalized < 1 || normalized > maximum) {
    throw new Error(label + ' must be an integer between 1 and ' + maximum + '.')
  }
  return normalized
}

function validateScheduling(scheduling, label) {
  if (scheduling === undefined) {
    return {
      strategy: 'configured',
      minimumObservations: 5,
      priorFailures: 1,
      priorPasses: 1,
      maxParallel: 1
    }
  }
  assertPlainObject(scheduling, label)
  assertOnlyKeys(scheduling, SCHEDULING_KEYS, label)
  const strategy = scheduling.strategy ?? 'configured'
  if (!['configured', 'adaptive-failure-first'].includes(strategy)) {
    throw new Error(label + '.strategy must be configured or adaptive-failure-first.')
  }
  return {
    strategy,
    minimumObservations: boundedPositiveInteger(scheduling.minimumObservations, 5, label + '.minimumObservations', 10_000),
    priorFailures: boundedPositiveInteger(scheduling.priorFailures, 1, label + '.priorFailures', 10_000),
    priorPasses: boundedPositiveInteger(scheduling.priorPasses, 1, label + '.priorPasses', 10_000),
    maxParallel: boundedPositiveInteger(scheduling.maxParallel, 1, label + '.maxParallel', 8)
  }
}

function validateResult(result, label) {
  assertPlainObject(result, label)
  assertOnlyKeys(result, RESULT_KEYS, label)
  if (!['junit', 'exit-code', 'findings', 'observation'].includes(result.type)) {
    throw new Error(label + '.type must be junit, exit-code, findings, or observation.')
  }
  if (result.type === 'exit-code') {
    if (result.reports !== undefined || result.minimumTests !== undefined || result.blockingSeverities !== undefined) {
      throw new Error(label + ' cannot define reports, minimumTests, or blockingSeverities for exit-code results.')
    }
    return { type: 'exit-code' }
  }
  if (!Array.isArray(result.reports) || result.reports.length === 0 || result.reports.length > 32) {
    throw new Error(label + '.reports must contain 1-32 project-relative glob patterns.')
  }
  const reports = result.reports.map((pattern, index) =>
    normalizeProjectRelativePath(pattern, label + '.reports[' + index + ']')
  )
  if (result.type === 'junit') {
    if (result.blockingSeverities !== undefined) {
      throw new Error(label + ' cannot define blockingSeverities for junit results.')
    }
    const minimumTests = result.minimumTests ?? 1
    if (!Number.isSafeInteger(minimumTests) || minimumTests < 1 || minimumTests > 1_000_000) {
      throw new Error(label + '.minimumTests must be an integer between 1 and 1000000.')
    }
    return { type: 'junit', reports, minimumTests }
  }
  if (result.minimumTests !== undefined) {
    throw new Error(label + ' cannot define minimumTests for ' + result.type + ' results.')
  }
  const blockingSeverities = result.type === 'observation' ? [] : (result.blockingSeverities ?? ['error', 'high', 'critical'])
  if (!Array.isArray(blockingSeverities) || blockingSeverities.some((entry) => !FINDING_SEVERITIES.has(entry))) {
    throw new Error(label + '.blockingSeverities contains an invalid severity.')
  }
  return { type: result.type, reports, blockingSeverities: [...new Set(blockingSeverities)] }
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
    if (gate.reorderable !== undefined && typeof gate.reorderable !== 'boolean') {
      throw new Error(label + '.reorderable must be boolean when provided.')
    }
    if (gate.reorderable === true && gate.required !== true) {
      throw new Error(label + ': only required gates may be reorderable.')
    }
    if (gate.parallelSafe !== undefined && typeof gate.parallelSafe !== 'boolean') {
      throw new Error(label + '.parallelSafe must be boolean when provided.')
    }
    if (gate.parallelSafe === true && gate.reorderable !== true) {
      throw new Error(label + ': parallelSafe gates must also be required and reorderable.')
    }
    if (gate.resourceClass !== undefined && (typeof gate.resourceClass !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(gate.resourceClass))) {
      throw new Error(label + '.resourceClass must be a bounded identifier.')
    }
    if (gate.parallelSafe === true && !gate.resourceClass) {
      throw new Error(label + ': parallelSafe gates require an explicit resourceClass.')
    }
    if (gate.network !== undefined && typeof gate.network !== 'boolean') {
      throw new Error(label + '.network must be boolean when provided.')
    }
    if (gate.feedback !== undefined && typeof gate.feedback !== 'boolean') {
      throw new Error(label + '.feedback must be boolean when provided.')
    }
    if (Array.isArray(gate.pathPrefixes) && gate.pathPrefixes.length > 0 && gate.feedback !== true) {
      throw new Error(label + '.pathPrefixes requires feedback: true.')
    }
    if (gate.required && gate.result?.type === 'observation') {
      throw new Error(label + '.required must be false for observation results.')
    }
    const timeoutMs = gate.timeoutMs ?? 10 * 60 * 1000
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60 * 60 * 1000) {
      throw new Error(label + '.timeoutMs must be between 1000 and 3600000.')
    }
    return {
      id: gate.id,
      required: gate.required,
      reorderable: gate.reorderable ?? false,
      dependsOn: validateDependencies(gate.dependsOn, label + '.dependsOn'),
      parallelSafe: gate.parallelSafe ?? false,
      resourceClass: gate.resourceClass ?? 'project-build',
      network: gate.network ?? false,
      feedback: gate.feedback ?? false,
      pathPrefixes: validateInputs(gate.pathPrefixes, label + '.pathPrefixes'),
      command: validateCommand(gate.command, label + '.command'),
      inputs: validateInputs(gate.inputs, label + '.inputs'),
      timeoutMs,
      result: validateResult(gate.result, label + '.result')
    }
  })

  const gateIndex = new Map(gates.map((gate, index) => [gate.id, index]))
  for (const [index, gate] of gates.entries()) {
    for (const dependency of gate.dependsOn) {
      const dependencyIndex = gateIndex.get(dependency)
      if (dependencyIndex === undefined) {
        throw new Error(source + ': gate ' + gate.id + ' depends on unknown gate ' + dependency + '.')
      }
      if (dependency === gate.id) {
        throw new Error(source + ': gate ' + gate.id + ' cannot depend on itself.')
      }
      if (dependencyIndex > index) {
        throw new Error(source + ': gate ' + gate.id + ' must declare dependency ' + dependency + ' before itself.')
      }
      if (gate.required && !gates[dependencyIndex].required) {
        throw new Error(source + ': required gate ' + gate.id + ' cannot depend on optional gate ' + dependency + '.')
      }
    }
  }

  const reportOwners = []
  for (const gate of gates) {
    for (const report of gate.result.reports ?? []) {
      if (reportGlobBase(report) === '.') {
        throw new Error(source + ': report pattern ' + report + ' must use a dedicated project-relative directory.')
      }
      const previous = reportOwners.find((entry) => entry.gateId !== gate.id && reportPatternsMayOverlap(entry.report, report))
      if (previous) {
        if (previous.report === report) {
          throw new Error(source + ': report pattern ' + report + ' is owned by both ' + previous.gateId + ' and ' + gate.id + '.')
        }
        throw new Error(source + ': report patterns ' + previous.report + ' (' + previous.gateId + ') and ' + report + ' (' + gate.id + ') may overlap; use gate-owned report directories.')
      }
      reportOwners.push({ report, gateId: gate.id })
    }
  }

  if (!gates.some((gate) => gate.required && gate.result.type === 'junit')) {
    throw new Error(source + ': at least one required junit gate is necessary to prevent untested success.')
  }
  return {
    schemaVersion: 1,
    context: validateContext(parsed.context, source + ': context'),
    scheduling: validateScheduling(parsed.scheduling, source + ': scheduling'),
    gates
  }
}

export function verificationExecutablePaths(config, options = {}) {
  const platform = options.platform ?? process.platform
  return [...new Set(config.gates.map((gate) => projectExecutableForPlatform(gate.command[0], platform)))].sort()
}

export function verificationInputPaths(config, options = {}) {
  const platform = options.platform ?? process.platform
  return [...new Set([
    '.backend-harness/verification.json',
    ...config.gates.flatMap((gate) => [projectExecutableForPlatform(gate.command[0], platform), ...gate.inputs])
  ])].sort()
}

export async function defaultVerificationConfig(root, options = {}) {
  const manifest = options.manifest ?? await scanProjectManifest(root, {
    maxDepth: 12,
    maxEntries: 100_000,
    onLimit: 'throw',
    onReadError: 'throw'
  })
  const detection = options.detection ?? await inspectJvmBuild(root, manifest, {
    inspectRuntime: false
  })
  if (detection.canGenerateVerification && detection.system === 'gradle') {
    return {
      schemaVersion: 1,
      context: { profile: 'test', databaseDialect: null },
      gates: [{
        id: 'tests',
        required: true,
        command: ['./gradlew', 'test', '--offline', '--no-daemon', '--console=plain', '--rerun-tasks'],
        inputs: detection.buildInputs,
        timeoutMs: 600000,
        result: {
          type: 'junit',
          reports: detection.reportPatterns,
          minimumTests: 1
        }
      }]
    }
  }
  if (detection.canGenerateVerification && detection.system === 'maven') {
    return {
      schemaVersion: 1,
      context: { profile: 'test', databaseDialect: null },
      gates: [{
        id: 'tests',
        required: true,
        command: ['./mvnw', '-o', '-B', 'verify'],
        inputs: detection.buildInputs,
        timeoutMs: 600000,
        result: {
          type: 'junit',
          reports: detection.reportPatterns,
          minimumTests: 1
        }
      }]
    }
  }
  const portable = options.portableDetection ?? await inspectPortableTestBuild(root, manifest)
  return portableVerificationConfig(portable)
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
    throw new Error('Verification config is missing and no unique Gradle, Maven, Jest, Vitest, or Pytest default can be inferred.')
  }
  return {
    config: parseVerificationConfig(JSON.stringify(inferred), 'inferred-jvm-default'),
    source: 'inferred-jvm-default'
  }
}

export async function resolveGateExecutable(root, command, options = {}) {
  const platform = options.platform ?? process.platform
  const executable = projectExecutableForPlatform(command[0], platform)
  const relativePath = normalizeProjectRelativePath(executable, 'gate command')
  const path = await resolveSafeProjectPath(root, relativePath)
  const stat = await statPath(path)
  if (!stat?.isFile() || stat.isSymbolicLink()) {
    throw new Error('Gate executable is missing or unsafe: ' + command[0])
  }
  if (platform !== 'win32') {
    try {
      await access(path, constants.X_OK)
    } catch {
      throw new Error('Gate executable is not executable: ' + command[0])
    }
  }
  return { path, displayPath: './' + relative(root, path).split('\\').join('/') }
}
