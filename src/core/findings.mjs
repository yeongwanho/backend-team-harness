import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, posix, relative, sep } from 'node:path'
import { findReportFiles } from './junit.mjs'
import { assertReportFileBytes, createReportBudget } from './report-limits.mjs'

const SEVERITIES = new Set(['info', 'warning', 'error', 'low', 'medium', 'high', 'critical'])

function safePath(value, label) {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value !== 'string' || !value || value.includes('\0')) {
    throw new Error(label + ' must be a project-relative path.')
  }
  const normalized = value.replaceAll('\\', '/')
  if (isAbsolute(normalized) || /^[A-Za-z]:\//.test(normalized) || normalized.split('/').some((part) => part === '..')) {
    throw new Error(label + ' must stay inside the project.')
  }
  return posix.normalize(normalized.replace(/^\.\//, ''))
}

function parseFinding(entry, index, source) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(source + ': findings[' + index + '] must be an object.')
  }
  if (typeof entry.ruleId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(entry.ruleId)) {
    throw new Error(source + ': findings[' + index + '].ruleId is invalid.')
  }
  if (!SEVERITIES.has(entry.severity)) {
    throw new Error(source + ': findings[' + index + '].severity is invalid.')
  }
  if (typeof entry.message !== 'string' || !entry.message.trim() || entry.message.length > 2000) {
    throw new Error(source + ': findings[' + index + '].message is invalid.')
  }
  const location = entry.location ?? null
  if (location !== null && (!location || typeof location !== 'object' || Array.isArray(location))) {
    throw new Error(source + ': findings[' + index + '].location must be an object or null.')
  }
  const line = location?.line ?? null
  if (line !== null && (!Number.isSafeInteger(line) || line < 1 || line > 100_000_000)) {
    throw new Error(source + ': findings[' + index + '].location.line is invalid.')
  }
  return {
    ruleId: entry.ruleId,
    severity: entry.severity,
    message: entry.message.trim(),
    location: location ? { path: safePath(location.path, source + ': finding path'), line } : null,
    fingerprint: typeof entry.fingerprint === 'string' && /^[a-f0-9]{64}$/i.test(entry.fingerprint)
      ? entry.fingerprint.toLowerCase()
      : null
  }
}

function parseReport(text, source) {
  if (Buffer.byteLength(text, 'utf8') > 16 * 1024 * 1024) {
    throw new Error(source + ': findings report exceeds 16 MiB.')
  }
  let report
  try {
    report = JSON.parse(text)
  } catch (error) {
    throw new Error(source + ': invalid findings JSON: ' + error.message)
  }
  if (!report || typeof report !== 'object' || Array.isArray(report) || report.schemaVersion !== 1) {
    throw new Error(source + ': findings report schemaVersion must be 1.')
  }
  if (!report.tool || typeof report.tool.id !== 'string' || typeof report.tool.version !== 'string') {
    throw new Error(source + ': findings report requires tool.id and tool.version.')
  }
  if (!Array.isArray(report.findings) || report.findings.length > 100_000) {
    throw new Error(source + ': findings must be an array with at most 100000 entries.')
  }
  const metrics = {}
  if (report.metrics !== undefined) {
    if (!report.metrics || typeof report.metrics !== 'object' || Array.isArray(report.metrics) || Object.keys(report.metrics).length > 32) {
      throw new Error(source + ': metrics must be a bounded numeric object.')
    }
    for (const [key, value] of Object.entries(report.metrics)) {
      if (!/^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(key) || typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(source + ': metrics contains an invalid entry.')
      }
      metrics[key] = value
    }
  }
  return {
    tool: { id: report.tool.id.slice(0, 128), version: report.tool.version.slice(0, 128) },
    findings: report.findings.map((entry, index) => parseFinding(entry, index, source)),
    metrics
  }
}

export async function collectFindingsResults(root, patterns, before, options = {}) {
  const matched = await findReportFiles(root, patterns)
  const budget = createReportBudget(options)
  const blockingSeverities = new Set(options.blockingSeverities ?? [])
  const result = {
    type: options.type ?? 'findings',
    evidenceTier: 'REPORTED',
    findings: [],
    counts: {},
    blockingCount: 0,
    reportFiles: [],
    reportDigests: [],
    staleReportCount: 0,
    tools: [],
    metrics: {}
  }
  let freshReportCount = 0
  let staleReportCount = 0
  for (const path of matched) {
    const metadata = await stat(path)
    const source = relative(root, path).split(sep).join('/')
    assertReportFileBytes(metadata.size, source)
    const contentBuffer = await readFile(path)
    budget.consume(contentBuffer.length, source)
    const content = contentBuffer.toString('utf8')
    const previous = before.get(path)
    const contentSha256 = createHash('sha256').update(content).digest('hex')
    const changed = !previous ||
      previous.contentSha256 !== contentSha256 ||
      previous.size !== contentBuffer.length ||
      previous.mtimeMs !== metadata.mtimeMs ||
      previous.ctimeMs !== metadata.ctimeMs
    if (changed) {
      freshReportCount += 1
      const parsed = parseReport(content, source)
      result.tools.push(parsed.tool)
      result.reportFiles.push(source)
      result.reportDigests.push({ path: source, sha256: contentSha256, bytes: contentBuffer.length })
      for (const [key, value] of Object.entries(parsed.metrics)) {
        result.metrics[key] = (result.metrics[key] ?? 0) + value
      }
      for (const finding of parsed.findings) {
        result.counts[finding.severity] = (result.counts[finding.severity] ?? 0) + 1
        if (blockingSeverities.has(finding.severity)) {
          result.blockingCount += 1
        }
        if (result.findings.length < 100) {
          result.findings.push(finding)
        }
      }
    } else {
      staleReportCount += 1
    }
  }
  result.staleReportCount = staleReportCount
  let reason = null
  if (freshReportCount === 0) {
    reason = matched.length === 0 ? 'findings_reports_missing' : 'findings_reports_stale'
  } else if (staleReportCount > 0) {
    reason = 'findings_reports_mixed_freshness'
  } else if (result.blockingCount > 0) {
    reason = 'blocking_findings_detected'
  }
  return { ...result, passed: reason === null, reason }
}
