import { createHash } from 'node:crypto'
import { lstat, readFile, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { prepareProjectOutputDirectory, writeFindingsReport } from './findings-report.mjs'

const output = resolve('.backend-harness/generated/packs/secrets-gitleaks/findings.json')
const raw = resolve('.backend-harness/generated/packs/secrets-gitleaks/gitleaks-redacted.json')
await prepareProjectOutputDirectory(output)
await rm(raw, { force: true })

const versionResult = spawnSync('gitleaks', ['version'], { encoding: 'utf8', shell: false })
if (versionResult.error || versionResult.status !== 0) {
  throw new Error('gitleaks is required on PATH before the secrets Pack can run.')
}
const version = (versionResult.stdout || versionResult.stderr).trim().split(/\s+/).at(-1).slice(0, 128)
const scan = spawnSync('gitleaks', [
  'dir', '.', '--no-banner', '--no-color', '--redact=100', '--exit-code', '0',
  '--report-format', 'json', '--report-path', raw
], { encoding: 'utf8', shell: false, timeout: 110000 })
if (scan.error || scan.status !== 0) {
  await rm(raw, { force: true })
  throw scan.error ?? new Error('gitleaks exited with code ' + scan.status + '.')
}

let source
try {
  const metadata = await lstat(raw)
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error('gitleaks report must be a regular non-symbolic-link file.')
  }
  if (metadata.size > 16 * 1024 * 1024) {
    throw new Error('gitleaks report exceeds the 16 MiB safety limit.')
  }
  source = JSON.parse(await readFile(raw, 'utf8'))
} finally {
  await rm(raw, { force: true })
}
if (!Array.isArray(source)) {
  throw new Error('gitleaks did not produce a JSON findings array.')
}
if (source.length > 100_000) {
  throw new Error('gitleaks produced more than 100000 findings.')
}
const findings = source.map((entry) => {
  const fingerprintInput = [entry.RuleID, entry.File, entry.StartLine, entry.Fingerprint].join('\0')
  return {
    ruleId: String(entry.RuleID || 'gitleaks.secret').replace(/[^A-Za-z0-9._:/-]/g, '-').slice(0, 128),
    severity: 'high',
    message: String(entry.Description || 'Potential secret detected.').slice(0, 2000),
    location: {
      path: String(entry.File || 'unknown').replace(/^\.\//, ''),
      line: Number.isSafeInteger(entry.StartLine) && entry.StartLine > 0 ? entry.StartLine : 1
    },
    fingerprint: createHash('sha256').update(fingerprintInput).digest('hex')
  }
})
await writeFindingsReport(output, {
  schemaVersion: 1,
  tool: { id: 'gitleaks', version },
  findings,
  metrics: { findings: findings.length }
})
