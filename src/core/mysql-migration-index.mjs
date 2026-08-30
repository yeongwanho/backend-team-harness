import { createHash } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const MAX_FILES = 2048
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_TOTAL_BYTES = 32 * 1024 * 1024

function normalizeIdentifier(value) {
  return value.trim().replaceAll('`', '').replace(/^.*\./, '').toLowerCase()
}

function columns(value) {
  return value.split(',').map((entry) => normalizeIdentifier(entry.trim().replace(/\([^)]*\)/g, '').split(/\s+/)[0])).filter(Boolean).slice(0, 32)
}

function indexesIn(path, content, sha256) {
  const indexes = []
  for (const match of content.matchAll(/\bCREATE\s+(UNIQUE\s+)?INDEX\s+`?[^`\s]+`?\s+ON\s+(`?[A-Za-z0-9_$.]+`?)\s*\(([^)]+)\)/gi)) {
    indexes.push({ table: normalizeIdentifier(match[2]), columns: columns(match[3]), kind: match[1] ? 'unique' : 'index', path, contentSha256: sha256 })
  }
  for (const tableMatch of content.matchAll(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(`?[A-Za-z0-9_$.]+`?)\s*\(([^;]+)\)\s*(?:ENGINE\b|;)/gis)) {
    const table = normalizeIdentifier(tableMatch[1])
    const body = tableMatch[2]
    for (const match of body.matchAll(/(?:^|,)\s*(PRIMARY\s+KEY|UNIQUE\s+(?:KEY|INDEX)|KEY|INDEX)\s*(?:`?[^`(,\s]+`?\s*)?\(([^)]+)\)/gi)) {
      const kind = /^PRIMARY/i.test(match[1]) ? 'primary' : /^UNIQUE/i.test(match[1]) ? 'unique' : 'index'
      indexes.push({ table, columns: columns(match[2]), kind, path, contentSha256: sha256 })
    }
  }
  return indexes
}

export async function inspectMysqlMigrationIndexes(root, manifest) {
  const paths = manifest.files.filter((path) => /(^|\/)db\/migration\/(?:[^/]+\/)*[VU][0-9]+(?:[._][0-9]+)*__[^/]+\.sql$/i.test(path))
  if (paths.length > MAX_FILES) throw new Error('MySQL migration index exceeded the ' + MAX_FILES + '-file safety limit.')
  let totalBytes = 0
  const indexes = []
  const skipped = []
  for (const path of paths) {
    const absolute = resolve(root, path)
    const metadata = await lstat(absolute)
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_FILE_BYTES) {
      skipped.push({ path, reason: metadata.size > MAX_FILE_BYTES ? 'oversized' : 'unsafe' })
      continue
    }
    totalBytes += metadata.size
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error('MySQL migration index exceeded the aggregate byte limit.')
    const buffer = await readFile(absolute)
    const sha256 = createHash('sha256').update(buffer).digest('hex')
    indexes.push(...indexesIn(path, buffer.toString('utf8'), sha256))
  }
  const deduplicated = [...new Map(indexes.map((entry) => [entry.table + '|' + entry.kind + '|' + entry.columns.join(','), entry])).values()]
    .sort((left, right) => left.table.localeCompare(right.table) || left.columns.join(',').localeCompare(right.columns.join(',')))
  return {
    schemaVersion: 1,
    status: paths.length ? skipped.length ? 'partial' : 'observed' : 'not-observed',
    dialect: 'mysql-compatible-ddl-patterns',
    migrationFiles: paths.length,
    parsedBytes: totalBytes,
    indexes: deduplicated.slice(0, 4096),
    omittedIndexCount: Math.max(0, deduplicated.length - 4096),
    skipped,
    authority: { sourcePatternObservationOnly: true, databaseMetadataInspected: false, queryPlanExecuted: false }
  }
}
