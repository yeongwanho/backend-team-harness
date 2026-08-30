import { constants } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { isAbsolute, posix, relative } from 'node:path'
import { resolveSafeProjectPath, statPath } from '../fs-safety.mjs'

const CONFIG_KEYS = new Set(['schemaVersion', 'adapter', 'writePolicy', 'recovery'])
const ADAPTER_KEYS = new Set(['id', 'command', 'network', 'timeoutMs'])
const RECOVERY_KEYS = new Set(['maxAttempts'])
const WRITE_POLICY_KEYS = new Set(['allowedPrefixes', 'maxChangedFiles', 'maxDiffBytes'])

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
  if (parsed.schemaVersion !== 1) throw new Error(source + ': schemaVersion must be 1.')
  if (parsed.adapter === null) return { schemaVersion: 1, adapter: null, recovery: { maxAttempts: 2 } }
  plainObject(parsed.adapter, source + ': adapter')
  onlyKeys(parsed.adapter, ADAPTER_KEYS, source + ': adapter')
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
  const timeoutMs = parsed.adapter.timeoutMs ?? 30 * 60 * 1000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60 * 60 * 1000) {
    throw new Error(source + ': adapter.timeoutMs must be between 1000 and 3600000.')
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
    schemaVersion: 1,
    adapter: { id: parsed.adapter.id, command, network: parsed.adapter.network, timeoutMs },
    writePolicy: { allowedPrefixes, maxChangedFiles, maxDiffBytes },
    recovery: { maxAttempts }
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
