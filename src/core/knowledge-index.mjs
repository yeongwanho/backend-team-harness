import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { resolveSafeProjectPath, statPath } from '../fs-safety.mjs'

const MAX_DOCUMENT_BYTES = 256 * 1024
const MAX_TOTAL_BYTES = 2 * 1024 * 1024
const MAX_DOCUMENTS = 64
const MAX_HEADINGS = 64
const REQUIRED_DOCUMENTS = [
  '.backend-harness/project.md',
  '.backend-harness/architecture.md',
  '.backend-harness/glossary.md'
]

function portable(path) {
  return path.split(sep).join('/')
}
async function candidatePaths(root) {
  const result = ['AGENTS.md', ...REQUIRED_DOCUMENTS]
  const policies = await resolveSafeProjectPath(root, '.backend-harness/policies')
  const metadata = await statPath(policies)
  if (metadata?.isDirectory() && !metadata.isSymbolicLink()) {
    const entries = await readdir(policies, { withFileTypes: true })
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith('.md')) {
        result.push(portable(relative(root, resolve(policies, entry.name))))
      }
    }
  }
  return [...new Set(result)].slice(0, MAX_DOCUMENTS)
}

function headings(text) {
  const result = []
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const match = line.match(/^(#{1,6})\s+(.{1,256})\s*$/)
    if (match && result.length < MAX_HEADINGS) {
      result.push({ level: match[1].length, title: match[2], line: index + 1 })
    }
  }
  return result
}

export async function inspectKnowledgeDocuments(root) {
  const documents = []
  const missing = []
  let totalBytes = 0
  for (const relativePath of await candidatePaths(root)) {
    const path = await resolveSafeProjectPath(root, relativePath)
    const metadata = await statPath(path)
    if (!metadata) {
      if (REQUIRED_DOCUMENTS.includes(relativePath)) {
        missing.push(relativePath)
      }
      continue
    }
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error('Knowledge document must be a regular non-symbolic link file: ' + relativePath)
    }
    if (metadata.size > MAX_DOCUMENT_BYTES) {
      throw new Error('Knowledge document exceeds the ' + MAX_DOCUMENT_BYTES + '-byte limit: ' + relativePath)
    }
    const content = await readFile(path)
    totalBytes += content.length
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error('Knowledge documents exceed the ' + MAX_TOTAL_BYTES + '-byte aggregate limit.')
    }
    const text = content.toString('utf8')
    documents.push({
      path: relativePath,
      bytes: content.length,
      sha256: createHash('sha256').update(content).digest('hex'),
      headings: headings(text),
      nonEmptyLines: text.split(/\r?\n/).filter((line) => line.trim()).length
    })
  }
  return {
    schemaVersion: 1,
    documents,
    required: [...REQUIRED_DOCUMENTS],
    missing,
    complete: missing.length === 0,
    totalBytes
  }
}
