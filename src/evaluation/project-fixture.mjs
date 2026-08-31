// Evaluation-only baseline preparation. Never a production-code patch engine.
import { constants } from 'node:fs'
import { access, link, mkdir, open, rename, unlink, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { parseImplementationConfig } from '../config/implementation.mjs'
import { resolveSafeProjectPath, statPath } from '../fs-safety.mjs'
import { parseProjectFixture } from './project-fixture-config.mjs'

const hash = value => createHash('sha256').update(value).digest('hex')
const serialized = value => Buffer.from(JSON.stringify(value, null, 2) + '\n')
const MAX_BYTES = 256 * 1024

async function read(root, path) {
  const target = await resolveSafeProjectPath(root, path)
  const metadata = await statPath(target)
  if (!metadata) return null
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_BYTES) throw new Error('Project fixture must be a bounded regular file.')
  const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const before = await handle.stat()
    if (!before.isFile() || before.size > MAX_BYTES) throw new Error('Project fixture exceeds its bounded file budget.')
    const bytes = Buffer.alloc(before.size + 1)
    let length = 0
    while (length < bytes.length) {
      const part = await handle.read(bytes, length, bytes.length - length, length)
      if (!part.bytesRead) break
      length += part.bytesRead
    }
    const after = await handle.stat()
    if (length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error('Project fixture changed while being read.')
    const data = bytes.subarray(0, length)
    try { new TextDecoder('utf-8', { fatal: true }).decode(data) } catch { throw new Error('Project fixture must contain valid UTF-8.') }
    return { data, sha256: hash(data), mode: before.mode & 0o777 }
  } finally { await handle.close() }
}

async function implementationDocument(root) {
  const before = await read(root, '.backend-harness/implementation.json')
  if (!before) throw new Error('Initialize the disposable project before applying its fixture.')
  let document
  try { document = JSON.parse(before.data); parseImplementationConfig(JSON.stringify(document)) }
  catch { throw new Error('The existing project implementation contract is invalid.') }
  return { before, document }
}

export async function inspectProjectFixture(root, input) {
  const fixture = parseProjectFixture(input)
  if (!fixture) return { valid: true, mismatchedPaths: [] }
  const mismatchedPaths = []
  const expected = [...fixture.files, { path: '.backend-harness/verification.json', sha256: hash(serialized(fixture.verification)) }]
  for (const file of expected) {
    try {
      const current = await read(root, file.path)
      if (current?.sha256 !== file.sha256) mismatchedPaths.push(file.path)
      else if (file.executable && process.platform !== 'win32') await access(await resolveSafeProjectPath(root, file.path), constants.X_OK)
    } catch { mismatchedPaths.push(file.path) }
  }
  try {
    const { document } = await implementationDocument(root)
    const actual = parseImplementationConfig(JSON.stringify(document)).workspacePreparation ?? null
    if (JSON.stringify(actual) !== JSON.stringify(fixture.workspacePreparation)) mismatchedPaths.push('.backend-harness/implementation.json')
  } catch { mismatchedPaths.push('.backend-harness/implementation.json') }
  return { valid: mismatchedPaths.length === 0, mismatchedPaths: [...new Set(mismatchedPaths)] }
}

export async function applyProjectFixture(root, fixtureRoot, input, options = {}) {
  const fixture = parseProjectFixture(input)
  if (!fixture) return { changedPaths: [], files: [] }
  const writes = []
  let totalBytes = 0
  // Check every fixture and preimage before changing any target content.
  for (const file of fixture.files) {
    const source = await read(fixtureRoot, file.fixture)
    if (source?.sha256 !== file.sha256) throw new Error('Project fixture source hash mismatch.')
    totalBytes += source.data.length
    if (totalBytes > 1024 * 1024) throw new Error('Project fixture exceeds its total byte budget.')
    const before = await read(root, file.path)
    if ((before?.sha256 ?? null) !== file.expectedSha256 && before?.sha256 !== file.sha256) throw new Error('Project fixture preimage hash mismatch.')
    writes.push({ path: file.path, before, data: source.data, sha256: file.sha256, mode: file.executable ? 0o755 : before?.mode ?? 0o644 })
  }
  const { before, document } = await implementationDocument(root)
  document.workspacePreparation = fixture.workspacePreparation
  const config = serialized(document)
  writes.push({ path: '.backend-harness/implementation.json', before, data: config, sha256: hash(config), mode: before.mode })
  const verification = serialized(fixture.verification)
  writes.push({ path: '.backend-harness/verification.json', before: await read(root, '.backend-harness/verification.json'), data: verification, sha256: hash(verification), mode: 0o644 })
  const changed = writes.filter(write => write.before?.sha256 !== write.sha256)
  const committed = [], staged = []
  try {
    // Stage complete files first; publish each new file exclusively. Replacements
    // use same-directory rename and recheck their captured preimage immediately.
    for (const write of changed) {
      const target = await resolveSafeProjectPath(root, write.path)
      await mkdir(dirname(target), { recursive: true })
      await resolveSafeProjectPath(root, write.path)
      const temporary = join(dirname(target), '.bth-fixture-' + randomUUID() + '.tmp')
      await writeFile(temporary, write.data, { flag: 'wx', mode: write.mode })
      staged.push({ ...write, target, temporary })
    }
    for (const [index, write] of staged.entries()) {
      await options.beforeCommit?.(index)
      if (((await read(root, write.path))?.sha256 ?? null) !== (write.before?.sha256 ?? null)) throw new Error('Project fixture preimage changed before commit.')
      if (write.before) await rename(write.temporary, write.target)
      else await link(write.temporary, write.target)
      committed.push(write)
    }
    const integrity = await inspectProjectFixture(root, fixture)
    if (!integrity.valid) throw new Error('Project fixture failed its post-write integrity check.')
    return { changedPaths: changed.map(write => write.path), files: writes.map(write => ({ path: write.path,
      beforeSha256: write.before?.sha256 ?? null, sha256: write.sha256 })) }
  } catch (error) {
    for (const write of committed.reverse()) {
      // Never overwrite a concurrent edit while rolling this transaction back.
      if ((await read(root, write.path))?.sha256 !== write.sha256) throw new Error('Project fixture rollback refused a concurrent change.')
      if (!write.before) await unlink(write.target)
      else {
        const rollback = join(dirname(write.target), '.bth-fixture-' + randomUUID() + '.tmp')
        await writeFile(rollback, write.before.data, { flag: 'wx', mode: write.before.mode })
        staged.push({ temporary: rollback })
        await rename(rollback, write.target)
      }
    }
    throw error
  } finally {
    for (const { temporary } of staged) await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error })
  }
}
