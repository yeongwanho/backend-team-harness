import { constants } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { isAbsolute, posix, relative } from 'node:path'
import { resolveSafeProjectPath, statPath } from '../fs-safety.mjs'

const CONFIG_KEYS = new Set(['schemaVersion', 'adapter', 'writePolicy', 'recovery', 'workspacePreparation'])
const COMMAND_ADAPTER_KEYS = new Set(['kind', 'id', 'command', 'network', 'timeoutMs'])
const PROVIDER_ADAPTER_KEYS = new Set(['kind', 'provider', 'network', 'timeoutMs', 'model', 'mode', 'contextBudgetCharacters', 'maxBudgetUsd'])
const RECOVERY_KEYS = new Set(['maxAttempts'])
const WRITE_POLICY_KEYS = new Set(['allowedPrefixes', 'maxChangedFiles', 'maxDiffBytes'])
const PROVIDERS = new Set(['codex', 'claude'])
const MODES = new Set(['auto', 'fast', 'balanced', 'deep'])

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(label + ' must be an object.')
}

function onlyKeys(value, allowed, label) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(label + ' contains unknown key: ' + key)
}

function safePath(value, label) {
  if (typeof value !== 'string' || !value || value.length > 4096 || value.includes('\0')) throw new Error(label + ' is invalid.')
  const normalized = value.replaceAll('\\', '/')
  if (isAbsolute(normalized) || /^[A-Za-z]:\//.test(normalized) || normalized.split('/').some((part) => !part || part === '..')) {
    throw new Error(label + ' must stay inside the project.')
  }
  return posix.normalize(normalized.replace(/^\.\//, ''))
}

export function parseImplementationConfig(text, source = '<inline>') {
  let parsed
  try { parsed = JSON.parse(text) } catch (error) { throw new Error(source + ': invalid JSON: ' + error.message) }
  plainObject(parsed, source)
  onlyKeys(parsed, CONFIG_KEYS, source)
  if (parsed.schemaVersion !== 1 && parsed.schemaVersion !== 2) throw new Error(source + ': schemaVersion must be 1 or 2.')
  const preparation = {}
  if (parsed.workspacePreparation !== undefined) {
    if (parsed.schemaVersion !== 2) throw new Error(source + ': workspacePreparation requires schemaVersion 2.')
    if (parsed.workspacePreparation === null) preparation.workspacePreparation = null
    else {
      const value = parsed.workspacePreparation
      plainObject(value, source + ': workspacePreparation')
      onlyKeys(value, new Set(['kind', 'projectPath', 'timeoutMs']), source + ': workspacePreparation')
      if (value.kind !== 'npm-ci-offline') throw new Error(source + ': workspacePreparation.kind must be npm-ci-offline.')
      const projectPath = safePath(value.projectPath, source + ': workspacePreparation.projectPath')
      const timeoutMs = value.timeoutMs ?? 180000
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600000) throw new Error(source + ': workspacePreparation.timeoutMs must be between 1000 and 600000.')
      preparation.workspacePreparation = { kind: value.kind, projectPath, timeoutMs }
    }
  }
  if (parsed.adapter === null) return { schemaVersion: parsed.schemaVersion, adapter: null, recovery: { maxAttempts: 2 }, ...preparation }
  plainObject(parsed.adapter, source + ': adapter')
  const kind = parsed.schemaVersion === 1 ? 'command' : parsed.adapter.kind
  if (kind !== 'command' && kind !== 'provider') throw new Error(source + ': adapter.kind must be command or provider.')
  onlyKeys(parsed.adapter, kind === 'command' ? COMMAND_ADAPTER_KEYS : PROVIDER_ADAPTER_KEYS, source + ': adapter')
  const timeoutMs = parsed.adapter.timeoutMs ?? 30 * 60 * 1000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60 * 60 * 1000) {
    throw new Error(source + ': adapter.timeoutMs must be between 1000 and 3600000.')
  }
  let adapter
  if (kind === 'command') {
    if (typeof parsed.adapter.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(parsed.adapter.id)) {
      throw new Error(source + ': adapter.id is invalid.')
    }
    if (!Array.isArray(parsed.adapter.command) || parsed.adapter.command.length < 1 || parsed.adapter.command.length > 64) {
      throw new Error(source + ': adapter.command must contain 1-64 argv entries.')
    }
    const command = parsed.adapter.command.map((entry, index) => {
      if (typeof entry !== 'string' || !entry || entry.length > 4096 || entry.includes('\0')) {
        throw new Error(source + ': adapter.command[' + index + '] is invalid.')
      }
      return index === 0 ? './' + safePath(entry, source + ': adapter.command[0]') : entry
    })
    if (parsed.adapter.network !== true && parsed.adapter.network !== false) throw new Error(source + ': adapter.network must be boolean.')
    adapter = { kind: 'command', id: parsed.adapter.id, command, network: parsed.adapter.network, timeoutMs }
  } else {
    if (!PROVIDERS.has(parsed.adapter.provider)) throw new Error(source + ': adapter.provider must be codex or claude.')
    if (parsed.adapter.network !== true) throw new Error(source + ': provider adapters must declare network: true.')
    const model = parsed.adapter.model ?? null
    if (model !== null && (typeof model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(model))) {
      throw new Error(source + ': adapter.model is invalid.')
    }
    const mode = parsed.adapter.mode ?? 'auto'
    if (!MODES.has(mode)) throw new Error(source + ': adapter.mode must be auto, fast, balanced, or deep.')
    const contextBudgetCharacters = parsed.adapter.contextBudgetCharacters ?? null
    if (contextBudgetCharacters !== null && (!Number.isSafeInteger(contextBudgetCharacters) || contextBudgetCharacters < 64 || contextBudgetCharacters > 32_768)) {
      throw new Error(source + ': adapter.contextBudgetCharacters must be between 64 and 32768.')
    }
    const maxBudgetUsd = parsed.adapter.maxBudgetUsd ?? null
    if (maxBudgetUsd !== null && (parsed.adapter.provider !== 'claude' || typeof maxBudgetUsd !== 'number' || !Number.isFinite(maxBudgetUsd) || maxBudgetUsd < 0.01 || maxBudgetUsd > 100)) {
      throw new Error(source + ': adapter.maxBudgetUsd is supported only for Claude and must be between 0.01 and 100.')
    }
    adapter = {
      kind: 'provider', id: parsed.adapter.provider, provider: parsed.adapter.provider, network: true,
      timeoutMs, model, mode, contextBudgetCharacters, maxBudgetUsd
    }
  }
  const recovery = parsed.recovery ?? {}
  plainObject(recovery, source + ': recovery')
  onlyKeys(recovery, RECOVERY_KEYS, source + ': recovery')
  const maxAttempts = recovery.maxAttempts ?? 2
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
    throw new Error(source + ': recovery.maxAttempts must be between 1 and 5.')
  }
  plainObject(parsed.writePolicy, source + ': writePolicy')
  onlyKeys(parsed.writePolicy, WRITE_POLICY_KEYS, source + ': writePolicy')
  if (!Array.isArray(parsed.writePolicy.allowedPrefixes) || parsed.writePolicy.allowedPrefixes.length < 1 || parsed.writePolicy.allowedPrefixes.length > 64) {
    throw new Error(source + ': writePolicy.allowedPrefixes must contain 1-64 project-relative prefixes.')
  }
  const allowedPrefixes = [...new Set(parsed.writePolicy.allowedPrefixes.map((entry, index) => {
    const directoryPrefix = typeof entry === 'string' && entry.endsWith('/')
    const normalized = safePath(directoryPrefix ? entry.slice(0, -1) : entry, source + ': writePolicy.allowedPrefixes[' + index + ']')
    return directoryPrefix ? normalized + '/' : normalized
  }))]
  const maxChangedFiles = parsed.writePolicy.maxChangedFiles ?? 100
  if (!Number.isSafeInteger(maxChangedFiles) || maxChangedFiles < 1 || maxChangedFiles > 10_000) {
    throw new Error(source + ': writePolicy.maxChangedFiles must be between 1 and 10000.')
  }
  const maxDiffBytes = parsed.writePolicy.maxDiffBytes ?? 2 * 1024 * 1024
  if (!Number.isSafeInteger(maxDiffBytes) || maxDiffBytes < 1 || maxDiffBytes > 8 * 1024 * 1024) {
    throw new Error(source + ': writePolicy.maxDiffBytes must be between 1 and 8388608.')
  }
  return {
    schemaVersion: parsed.schemaVersion,
    adapter,
    writePolicy: { allowedPrefixes, maxChangedFiles, maxDiffBytes },
    recovery: { maxAttempts },
    ...preparation
  }
}

export async function loadImplementationConfig(root) {
  const path = await resolveSafeProjectPath(root, '.backend-harness/implementation.json')
  const metadata = await statPath(path)
  if (!metadata?.isFile() || metadata.isSymbolicLink() || metadata.size > 1024 * 1024) {
    throw new Error('Implementation config is missing, unsafe, or exceeds 1 MiB.')
  }
  return { path, source: '.backend-harness/implementation.json', config: parseImplementationConfig(await readFile(path, 'utf8'), '.backend-harness/implementation.json') }
}

export async function resolveImplementationExecutable(root, command) {
  const relativePath = safePath(command[0], 'adapter command')
  const path = await resolveSafeProjectPath(root, relativePath)
  const metadata = await statPath(path)
  if (!metadata?.isFile() || metadata.isSymbolicLink()) throw new Error('Implementation adapter executable is missing or unsafe: ' + command[0])
  if (process.platform !== 'win32') {
    try { await access(path, constants.X_OK) } catch { throw new Error('Implementation adapter is not executable: ' + command[0]) }
  }
  return { path, displayPath: './' + relative(root, path).replaceAll('\\', '/') }
}
