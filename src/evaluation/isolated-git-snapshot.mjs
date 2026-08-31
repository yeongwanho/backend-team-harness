import { execFile } from 'node:child_process'
import { lstat, mkdir, realpath, rm } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative } from 'node:path'
import { promisify } from 'node:util'
import { buildSafeEnvironment } from '../core/process-runner.mjs'

const execute = promisify(execFile)
async function git(root, args) {
  return (await execute('git', args, { cwd: root, encoding: 'utf8', timeout: 60000,
    maxBuffer: 16 * 1024 * 1024, env: buildSafeEnvironment() })).stdout.trim()
}

// Depth-one local fetch preserves the original SHA but transfers only its tree.
// No hardlinks/alternates or full-history copies into disposable evaluator clones.
export async function createIsolatedGitSnapshot(source, ref, destination) {
  if (typeof source !== 'string' || !isAbsolute(source) || !/^[a-f0-9]{40}$/.test(ref ?? '') ||
    typeof destination !== 'string' || !isAbsolute(destination)) throw new Error('A local absolute source/destination and full pinned SHA are required.')
  const original = await realpath(source), target = join(await realpath(dirname(destination)), basename(destination))
  const contained = relative(original, target)
  if (!(isAbsolute(contained) || contained === '..' || contained.startsWith('../') || contained.startsWith('..\\'))) throw new Error('Snapshot destination must be outside its source.')
  if (await lstat(target).catch(error => { if (error.code === 'ENOENT') return null; throw error })) throw new Error('Snapshot destination already exists.')
  const entries = (await git(original, ['ls-tree', '-rlz', ref])).split('\0').filter(Boolean)
  let bytes = 0
  for (const entry of entries) {
    const match = entry.match(/^100(?:644|755) blob [a-f0-9]{40}\s+(\d+)\t/)
    if (!match) throw new Error('Oracle snapshots cannot contain symlinks, submodules or unsupported entries.')
    bytes += Number(match[1])
    if (+match[1] > 16 * 1024 * 1024 || bytes > 128 * 1024 * 1024 || entries.length > 20000) throw new Error('Oracle snapshot exceeds the bounded source budget.')
  }
  await mkdir(target)
  try {
    await git(target, ['init', '--quiet'])
    await git(target, ['-c', 'protocol.allow=never', '-c', 'protocol.file.allow=always',
      'fetch', '--quiet', '--no-tags', '--no-recurse-submodules', '--depth=1', '--', original, ref])
    await git(target, ['checkout', '--quiet', '--detach', ref])
    if (await git(target, ['rev-parse', 'HEAD']) !== ref || await git(target, ['rev-list', '--count', 'HEAD']) !== '1' ||
      await git(target, ['remote'])) throw new Error('Snapshot identity or history isolation failed.')
  } catch (error) {
    await rm(target, { recursive: true, force: true }) // allocated above; never the caller's source
    throw error
  }
}
