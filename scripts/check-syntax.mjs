import { readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

async function collect(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      continue
    }
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...await collect(path))
    } else if (entry.isFile() && entry.name.endsWith('.mjs')) {
      files.push(path)
    }
  }
  return files
}

const roots = ['src', 'test', 'test-support', 'packs', 'scripts']
for (const file of (await Promise.all(roots.map((root) => collect(resolve(root))))).flat().sort()) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}
