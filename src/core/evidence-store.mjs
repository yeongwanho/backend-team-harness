import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { assertNoSymlinkSegments } from '../fs-safety.mjs'
import { taskDirectory } from './task-store.mjs'

function evidenceId(date, suffix) {
  const timestamp = date.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
  return 'verify-' + timestamp + '-' + suffix
}

export async function recordEvidence(inputPath, taskId, input, options = {}) {
  const paths = await taskDirectory(inputPath, taskId)
  const evidenceDir = resolve(paths.taskDir, 'evidence')
  await assertNoSymlinkSegments(paths.taskDir, evidenceDir)
  await mkdir(evidenceDir, { recursive: true })
  await assertNoSymlinkSegments(paths.taskDir, evidenceDir)

  const now = options.at ?? new Date()
  const id = options.id ?? evidenceId(now, randomUUID().slice(0, 8))
  if (!/^verify-[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error('Evidence id contains unsafe characters.')
  }

  const base = {
    ...input,
    schemaVersion: 1,
    id,
    taskId: paths.id,
    recordedAt: now.toISOString()
  }
  const canonical = JSON.stringify(base)
  const record = {
    ...base,
    recordSha256: createHash('sha256').update(canonical).digest('hex')
  }
  const target = resolve(evidenceDir, id + '.json')
  await writeFile(target, JSON.stringify(record, null, 2) + '\n', {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600
  })
  return { record, path: relative(paths.root, target) }
}
