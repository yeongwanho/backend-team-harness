import test from 'node:test'
import assert from 'node:assert/strict'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { chmod, mkdir, mkdtemp, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises'
import { initProject } from '../src/init-project.mjs'
import { checkProject } from '../src/runtime/backend-harness.mjs'
import { initializeGit } from '../test-support/git-project.mjs'
import { jestDocument } from '../test-support/jest-document.mjs'

async function backendProject(prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix))
  await writeFile(join(root, 'build.gradle.kts'), 'plugins { java }\n', 'utf8')
  await writeFile(join(root, 'gradlew'), '#!/bin/sh\n', 'utf8')
  return root
}

test('init creates the shared contract', async () => {
  const root = await backendProject('bth-init-')
  const result = await initProject(root)

  assert.ok(result.created.includes('.backend-harness/project.md'))
  assert.match(
    await readFile(join(root, '.backend-harness/project.md'), 'utf8'),
    /# Project/
  )
  const verification = JSON.parse(await readFile(join(root, '.backend-harness/verification.json'), 'utf8'))
  assert.equal(verification.gates[0].result.type, 'junit')
  assert.ok(verification.gates[0].command.includes('--rerun-tasks'))
  const implementation = JSON.parse(await readFile(join(root, '.backend-harness/implementation.json'), 'utf8'))
  assert.equal(implementation.adapter, null)
  assert.equal(implementation.recovery.maxAttempts, 2)
  const projectFacts = JSON.parse(await readFile(join(root, '.backend-harness/project-facts.json'), 'utf8'))
  assert.deepEqual(projectFacts.providers, [])
})

test('init preserves an existing team document by default', async () => {
  const root = await backendProject('bth-preserve-')
  await initProject(root)
  const projectFile = join(root, '.backend-harness/project.md')
  await writeFile(projectFile, '# Team-owned content\n', 'utf8')

  const result = await initProject(root)

  assert.ok(result.skipped.includes('.backend-harness/project.md'))
  assert.equal(await readFile(projectFile, 'utf8'), '# Team-owned content\n')
})

test('mixed JVM and Node repositories prepare only the selected verification system', async () => {
  const root = await backendProject('bth-init-mixed-preparation-')
  await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'jest' }, devDependencies: { jest: '29.7.0' } }))
  await writeFile(join(root, 'package-lock.json'), '{"lockfileVersion":3,"packages":{"":{}}}')
  await initProject(root)
  const verification = JSON.parse(await readFile(join(root, '.backend-harness/verification.json'), 'utf8'))
  const implementation = JSON.parse(await readFile(join(root, '.backend-harness/implementation.json'), 'utf8'))
  assert.equal(verification.gates[0].command[0], './gradlew')
  assert.equal(implementation.workspacePreparation, undefined, 'unrelated npm install must not precede JVM verification')
})

test('force backs up every replaced team document before overwriting', async () => {
  const root = await backendProject('bth-force-')
  await initProject(root)
  const projectFile = join(root, '.backend-harness/project.md')
  await writeFile(projectFile, '# Preserve this exact content\n', 'utf8')

  const result = await initProject(root, {
    force: true,
    now: () => new Date('2026-08-29T01:02:03.000Z')
  })

  const projectBackup = result.backups.find((path) => path.endsWith('/project.md'))
  assert.ok(projectBackup)
  assert.equal(await readFile(join(root, projectBackup), 'utf8'), '# Preserve this exact content\n')
  assert.match(await readFile(projectFile, 'utf8'), /# Project/)
  assert.ok(result.updated.includes('.backend-harness/project.md'))
})

test('init rejects a symlinked harness directory and writes nothing outside the project', async () => {
  const root = await backendProject('bth-symlink-root-')
  const outside = await mkdtemp(join(tmpdir(), 'bth-symlink-outside-'))
  await symlink(outside, join(root, '.backend-harness'))

  await assert.rejects(initProject(root), /symbolic link/)
  assert.deepEqual(await readdir(outside), [])
})

test('init refuses missing roots and does not create them', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'bth-missing-parent-'))
  const root = join(parent, 'not-created')

  await assert.rejects(initProject(root), /must already exist/)
  assert.deepEqual(await readdir(parent), [])
})

test('init refuses the user home directory even when force is requested', async () => {
  await assert.rejects(initProject(homedir(), { force: true, allowUnversioned: true }), /home directory/)
})

test('an intentional empty directory requires allowUnversioned', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-unversioned-'))

  await assert.rejects(initProject(root), /neither inside a Git worktree nor a recognizable/)
  const result = await initProject(root, { allowUnversioned: true })
  assert.ok(result.created.length > 0)
})

test('init generates and executes structured Jest verification without an extra reporter dependency', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-init-jest-'))
  await mkdir(join(root, 'node_modules/jest/bin'), { recursive: true })
  await mkdir(join(root, 'test'), { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({
    name: 'api', private: true, scripts: { test: 'jest --config test/jest.config.js' }, devDependencies: { jest: '1.0.0' }
  }) + '\n')
  await writeFile(join(root, 'test/jest.config.js'), 'export default {}\n')
  await writeFile(join(root, 'package-lock.json'), '{"lockfileVersion":3}\n')
  await writeFile(join(root, 'node_modules/jest/bin/jest.js'), [
    "import { writeFileSync } from 'node:fs'",
    "if (!process.argv.includes('--config') || !process.argv.includes('test/jest.config.js')) process.exit(19)",
    "const output = process.argv.find((value) => value.startsWith('--outputFile=')).slice(13)",
    'writeFileSync(output, ' + JSON.stringify(JSON.stringify(jestDocument(['passed', 'pending']))) + ')',
    ''
  ].join('\n'))

  const initialized = await initProject(root, { allowUnversioned: true })
  assert.equal(initialized.detection.system, 'node-jest')
  assert.deepEqual(JSON.parse(await readFile(join(root, '.backend-harness/implementation.json'), 'utf8')).workspacePreparation, { kind: 'npm-ci-offline', projectPath: '.', timeoutMs: 180000 })
  const verification = JSON.parse(await readFile(join(root, '.backend-harness/verification.json'), 'utf8'))
  assert.equal(verification.gates[0].command[0], './.backend-harness/bin/verify-portable')
  assert.equal(verification.gates[0].result.type, 'junit')
  assert.ok((await stat(join(root, '.backend-harness/bin/verify-portable'))).mode & 0o100)

  initializeGit(root)
  const checked = await checkProject(root)
  assert.equal(checked.confirmed, true, JSON.stringify(checked.result, null, 2))
  assert.equal(checked.result.tests.tests, 2)
  assert.equal(checked.result.tests.executed, 1)
  assert.equal(checked.result.tests.skipped, 1)
})

test('init does not guess through shell-wrapped Node test scripts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-init-shell-test-'))
  await writeFile(join(root, 'package.json'), JSON.stringify({
    name: 'api', private: true, scripts: { test: 'cross-env NODE_ENV=test jest && echo done' }, devDependencies: { jest: '1.0.0' }
  }) + '\n')

  const initialized = await initProject(root, { allowUnversioned: true })

  assert.equal(initialized.detection.status, 'unknown')
  assert.equal(initialized.detection.system, null)
  await assert.rejects(readFile(join(root, '.backend-harness/verification.json'), 'utf8'), { code: 'ENOENT' })
})

test('init generates nested offline Pytest verification from one monorepo backend', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-init-pytest-'))
  await mkdir(join(root, 'backend/.venv/bin'), { recursive: true })
  await writeFile(join(root, 'backend/pyproject.toml'), '[project]\nname="api"\n[dependency-groups]\ndev=["pytest>=8"]\n')
  await writeFile(join(root, 'backend/uv.lock'), 'version = 1\n')
  const python = join(root, 'backend/.venv/bin/python')
  await writeFile(python, [
    '#!/bin/sh',
    'for argument in "$@"; do',
    '  case "$argument" in --junitxml=*) report="${argument#--junitxml=}" ;; esac',
    'done',
    'mkdir -p "$(dirname "$report")"',
    'printf \'%s\\n\' \'<testsuite tests="1"><testcase name="api"/></testsuite>\' > "$report"',
    ''
  ].join('\n'))
  await chmod(python, 0o755)

  const initialized = await initProject(root, { allowUnversioned: true })
  assert.equal(initialized.detection.system, 'python-pytest')
  assert.deepEqual(initialized.detection.testModules, ['backend'])
  assert.match(await readFile(join(root, '.backend-harness/project.md'), 'utf8'), /^framework: pytest$/m)

  initializeGit(root)
  const checked = await checkProject(root)
  assert.equal(checked.confirmed, true, JSON.stringify(checked.result, null, 2))
  assert.equal(checked.result.tests.executed, 1)
})

test('init binds a Python workspace root and retains explicitly customized preparation on repeat', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-init-uv-workspace-'))
  await mkdir(join(root, 'backend'), { recursive: true })
  await writeFile(join(root, 'backend/pyproject.toml'), '[project]\nname="api"\n[dependency-groups]\ndev=["pytest>=8"]\n')
  await writeFile(join(root, 'pyproject.toml'), '[tool.uv.workspace]\nmembers=["backend"]\n')
  await writeFile(join(root, 'uv.lock'), 'version=1\n')
  await initProject(root, { allowUnversioned: true })
  const path = join(root, '.backend-harness/implementation.json')
  const document = JSON.parse(await readFile(path, 'utf8'))
  assert.deepEqual(document.workspacePreparation, { kind: 'uv-sync-offline', projectPath: 'backend', timeoutMs: 180000 })
  const verification = JSON.parse(await readFile(join(root, '.backend-harness/verification.json'), 'utf8'))
  for (const input of ['backend/pyproject.toml', 'pyproject.toml', 'uv.lock']) assert.ok(verification.gates[0].inputs.includes(input))
  document.workspacePreparation.pythonVersion = '3.12.13'
  await writeFile(path, JSON.stringify(document))
  const repeated = await initProject(root, { allowUnversioned: true })
  assert.ok(repeated.skipped.includes('.backend-harness/implementation.json'))
  assert.equal(await readFile(path, 'utf8'), JSON.stringify(document))
})
