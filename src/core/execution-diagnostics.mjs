import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripVTControlCharacters } from 'node:util'
import { resolveSafeProjectPath, statPath } from '../fs-safety.mjs'
import { redactString } from './redaction.mjs'

const MAX_TAIL_BYTES = 65536
const MAX_CANDIDATES = 64
const MAX_ENTRIES = 16
const AUTHORITY = 'untrusted-execution-diagnostics'
const positive = value => Number.isSafeInteger(value) && value > 0 && value <= 10_000_000

function safeRelativePath(value) {
  if (typeof value !== 'string' || value.length > 384 || !value || /[\x00-\x1f\x7f<>:"'|?*=]/.test(value)) return null
  const path = value.replaceAll('\\', '/').replace(/^\.\//, '')
  if (path.startsWith('/') || path.split('/').some(part => !part || part === '..' || part === '.') ||
      /(?:^|\/)\.env(?:\.|$)/.test(path) || redactString(path).count > 0 || !/\.(?:[cm]?[jt]sx?|java|kt)$/.test(path)) return null
  return path
}

function entry(value) {
  if (!value || typeof value !== 'object' || typeof value.code !== 'string') return null
  const formatter = value.language === 'java' && value.code === 'JAVA_FORMAT_VIOLATION'
  if (formatter ? value.line !== null || value.column !== null : !positive(value.line) || (value.column !== null && !positive(value.column))) return null
  const path = safeRelativePath(value.path)
  const validCode = value.language === 'typescript' ? /^TS\d{3,6}$/.test(value.code) && /\.[cm]?[jt]sx?$/.test(path ?? '')
    : value.language === 'java' ? (formatter || value.code === 'JAVA_COMPILE_ERROR') && path?.endsWith('.java')
      : value.language === 'kotlin' && value.code === 'KOTLIN_COMPILE_ERROR' && path?.endsWith('.kt')
  return path && validCode ? { language: value.language, code: value.code, path, line: value.line, column: value.column } : null
}

// Revalidate at every record/projection boundary. No free-form diagnostic body
// is ever part of the shared record or the provider recovery contract.
export function compactExecutionDiagnostics(value) {
  if (value?.schemaVersion !== 1 || !Array.isArray(value.entries)) return null
  const entries = [], seen = new Set()
  let truncated = value.truncated === true || value.entries.length > MAX_CANDIDATES
  for (const candidate of value.entries.slice(0, MAX_CANDIDATES)) {
    const accepted = entry(candidate)
    if (!accepted) continue
    const key = JSON.stringify(accepted)
    if (seen.has(key)) continue
    seen.add(key)
    if (entries.length === MAX_ENTRIES) { truncated = true; break }
    entries.push(accepted)
  }
  return entries.length ? { schemaVersion: 1, authority: AUTHORITY, entries, truncated } : null
}

function parseLine(line) {
  let match = line.match(/^(.+\.[cm]?[jt]sx?)(?::(\d+):(\d+)|\((\d+),(\d+)\))\s*:?\s*(?:-\s*)?error\s+(TS\d{3,6}):/)
  if (match) return { language: 'typescript', code: match[6], path: match[1], line: Number(match[2] ?? match[4]), column: Number(match[3] ?? match[5]) }
  match = line.match(/^\[ERROR\]\s+(.+\.java):\[(\d+),(\d+)\]/)
  if (match) return { language: 'java', code: 'JAVA_COMPILE_ERROR', path: match[1], line: Number(match[2]), column: Number(match[3]) }
  match = line.match(/^(.+\.java):(\d+):(?:\s*(\d+):)?\s*error:/)
  if (match) return { language: 'java', code: 'JAVA_COMPILE_ERROR', path: match[1], line: Number(match[2]), column: match[3] ? Number(match[3]) : null }
  match = line.match(/^e:\s+(.+\.kt):(\d+):(\d+)\b/)
  return match ? { language: 'kotlin', code: 'KOTLIN_COMPILE_ERROR', path: match[1], line: Number(match[2]), column: Number(match[3]) } : null
}

export async function extractExecutionDiagnostics(processResult, projectRoot) {
  let roots
  try { roots = [...new Set([resolve(projectRoot), await realpath(projectRoot)])] } catch { return null }
  const entries = [], checked = new Map()
  let candidates = 0, truncated = false
  for (const stream of [processResult?.stderr, processResult?.stdout]) {
    if (typeof stream?.tail !== 'string') continue
    const tail = stream.tail
    // Slice before encoding: a fabricated huge input cannot cause an unbounded
    // allocation. No source read, command execution or repository walk occurs.
    const limited = Buffer.from(tail.slice(-MAX_TAIL_BYTES)).subarray(-MAX_TAIL_BYTES).toString('utf8')
    truncated ||= limited.length < tail.length || stream.bytes > Buffer.byteLength(tail)
    let formatterList = false
    for (const line of stripVTControlCharacters(limited).split(/\r?\n/)) {
      const trimmed = line.trim()
      if (/^\[ERROR\] Failed to execute goal io\.spring\.javaformat:spring-javaformat-maven-plugin:[\w.-]+:validate \([^\r\n]*\) on project [^\r\n]+: Formatting violations found in the following files:$/.test(trimmed)) {
        formatterList = true
        continue
      }
      const formattedFile = formatterList ? trimmed.match(/^\[ERROR\]\s+\*\s+(.+\.java)$/) : null
      formatterList = Boolean(formattedFile)
      const parsed = formattedFile
        ? { language: 'java', code: 'JAVA_FORMAT_VIOLATION', path: formattedFile[1], line: null, column: null }
        : parseLine(trimmed)
      if (!parsed) continue
      if (++candidates > MAX_CANDIDATES) { truncated = true; break }
      let path = parsed.path
      try {
        if (path.startsWith('file:')) path = fileURLToPath(path)
        if (isAbsolute(path)) {
          path = roots.map(root => relative(root, path).replaceAll('\\', '/')).find(candidate => safeRelativePath(candidate))
        }
        parsed.path = path
        const accepted = entry(parsed)
        if (!accepted) continue
        if (!checked.has(accepted.path)) {
          const absolute = await resolveSafeProjectPath(roots[0], accepted.path)
          const metadata = await statPath(absolute)
          checked.set(accepted.path, metadata?.isFile() === true && !metadata.isSymbolicLink())
        }
        if (checked.get(accepted.path)) entries.push(accepted)
      } catch { /* Unsafe/unavailable source locations are not forwarded. */ }
    }
    if (candidates > MAX_CANDIDATES) break
  }
  return compactExecutionDiagnostics({ schemaVersion: 1, entries, truncated })
}
