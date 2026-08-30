import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const mutations = [
  {
    file: 'src/core/task-state.mjs',
    from: "if (!ALLOWED_TRANSITIONS[record.state].includes(to)) {",
    to: "if (false && !ALLOWED_TRANSITIONS[record.state].includes(to)) {",
    test: 'test/task-state.test.mjs'
  },
  {
    file: 'src/adapters/verification-tool.mjs',
    from: 'return result.exitCode === 0 && result.signal === null',
    to: 'return result.exitCode !== 0 && result.signal === null',
    test: 'test/generic-verification.test.mjs'
  },
  {
    file: 'src/core/work-draft.mjs',
    from: "status: blockers.length ? 'blocked' : questions.length ? 'needs-decisions' : 'ready-for-plan-review',",
    to: "status: 'ready-for-plan-review',",
    test: 'test/work-draft.test.mjs'
  }
]

async function copyFixture(target) {
  await cp(join(root, 'src'), join(target, 'src'), { recursive: true })
  await cp(join(root, 'test'), join(target, 'test'), { recursive: true })
  await cp(join(root, 'package.json'), join(target, 'package.json'))
  await symlink(join(root, 'node_modules'), join(target, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
}

const workspace = await mkdtemp(join(tmpdir(), 'bth-mutation-'))
try {
  for (const [index, mutation] of mutations.entries()) {
    const target = join(workspace, String(index))
    await copyFixture(target)
    const sourcePath = join(target, mutation.file)
    const source = await readFile(sourcePath, 'utf8')
    const occurrences = source.split(mutation.from).length - 1
    if (occurrences !== 1) throw new Error('Mutation anchor must occur exactly once: ' + mutation.file)
    await writeFile(sourcePath, source.replace(mutation.from, mutation.to), 'utf8')
    const result = spawnSync(process.execPath, ['--test', mutation.test], {
      cwd: target,
      encoding: 'utf8',
      timeout: 120_000,
      windowsHide: true
    })
    if (result.error) throw result.error
    if (result.status === 0) {
      throw new Error('Mutation survived: ' + mutation.file + ' against ' + mutation.test)
    }
    console.log('KILLED ' + mutation.file + ' by ' + mutation.test)
  }
} finally {
  await rm(workspace, { recursive: true, force: true })
}
