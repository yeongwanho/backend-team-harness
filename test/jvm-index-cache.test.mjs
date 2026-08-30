import test from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectProjectIntelligence, warmProjectIntelligenceCache } from '../src/adapters/project-intelligence.mjs'
import { initProject } from '../src/init-project.mjs'
import { initializeGit, runGit, writeGradleFixture } from '../test-support/git-project.mjs'

const CACHE_PATH = '.backend-harness/local/cache/jvm-index.json'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'bth-jvm-cache-'))
  await writeGradleFixture(root)
  await initProject(root)
  await mkdir(join(root, 'src/main/java/example'), { recursive: true })
  await writeFile(join(root, 'src/main/java/example/App.java'), [
    'package example;',
    'import org.springframework.web.bind.annotation.GetMapping;',
    'import org.springframework.web.bind.annotation.RestController;',
    '@RestController class App { @GetMapping("/one") Object one() { return null; } }',
    ''
  ].join('\n'), 'utf8')
  await writeFile(join(root, 'src/main/java/example/Helper.java'), 'package example; class Helper {}\n', 'utf8')
  initializeGit(root)
  return root
}

test('read-only intelligence inspection never creates a cache file', async () => {
  const root = await fixture()
  const result = await inspectProjectIntelligence(root)

  assert.equal(result.intelligence.code.cache.status, 'missing')
  await assert.rejects(access(join(root, CACHE_PATH)))
})

test('an explicit warm reuses the unchanged source-bound JVM index', async () => {
  const root = await fixture()
  const fresh = await inspectProjectIntelligence(root, { useCache: false })
  const warmed = await warmProjectIntelligenceCache(root)
  const reused = await inspectProjectIntelligence(root)

  assert.equal(warmed.status, 'written')
  assert.equal(warmed.written, true)
  assert.equal(reused.intelligence.code.cache.status, 'hit')
  assert.equal(reused.intelligence.sourceFingerprint, warmed.sourceFingerprint)
  assert.deepEqual(reused.intelligence.facts, fresh.intelligence.facts)
  assert.deepEqual(reused.intelligence.code.files, fresh.intelligence.code.files)
})

test('a source edit makes the previous cache stale and forces a fresh index', async () => {
  const root = await fixture()
  await warmProjectIntelligenceCache(root)
  await writeFile(join(root, 'src/main/java/example/App.java'), [
    'package example;',
    'import org.springframework.web.bind.annotation.GetMapping;',
    'import org.springframework.web.bind.annotation.RestController;',
    '@RestController class App {',
    '  @GetMapping("/one") Object one() { return null; }',
    '  @GetMapping("/two") Object two() { return null; }',
    '}',
    ''
  ].join('\n'), 'utf8')

  const result = await inspectProjectIntelligence(root)
  const routes = result.intelligence.facts.find((fact) => fact.id === 'code.routes.count')

  assert.equal(result.intelligence.code.cache.status, 'incremental')
  assert.equal(result.intelligence.code.metrics.parsedFiles, 1)
  assert.equal(result.intelligence.code.metrics.reusedFiles, 1)
  assert.equal(routes.value, 2)
})

test('a non-JVM source-bound change reuses every cached JVM file', async () => {
  const root = await fixture()
  await warmProjectIntelligenceCache(root)
  await writeFile(join(root, 'notes.txt'), 'Changed non-JVM project context.\n', 'utf8')

  const result = await inspectProjectIntelligence(root)

  assert.equal(result.intelligence.code.cache.status, 'incremental')
  assert.equal(result.intelligence.code.metrics.parsedFiles, 0)
  assert.equal(result.intelligence.code.metrics.reusedFiles, 2)
  assert.equal(result.intelligence.code.metrics.readBytes, 0)
})

test('incremental paths stay project-relative inside a larger monorepo worktree', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'bth-jvm-cache-monorepo-'))
  const root = join(parent, 'services/backend')
  await mkdir(root, { recursive: true })
  await writeGradleFixture(root)
  await initProject(root)
  await mkdir(join(root, 'src/main/java/example'), { recursive: true })
  await writeFile(join(root, 'src/main/java/example/App.java'), 'package example; class App {}\n', 'utf8')
  await writeFile(join(root, 'src/main/java/example/Helper.java'), 'package example; class Helper {}\n', 'utf8')
  initializeGit(parent)
  await warmProjectIntelligenceCache(root)
  await writeFile(join(root, 'src/main/java/example/App.java'), 'package example; class App { int changed; }\n', 'utf8')

  const result = await inspectProjectIntelligence(root)

  assert.equal(result.intelligence.code.cache.status, 'incremental')
  assert.equal(result.intelligence.code.metrics.parsedFiles, 1)
  assert.equal(result.intelligence.code.metrics.reusedFiles, 1)
})

test('a clean committed JVM change is diffed from the cached HEAD inside a monorepo', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'bth-jvm-cache-commit-'))
  const root = join(parent, 'services/backend')
  await mkdir(root, { recursive: true })
  await writeGradleFixture(root)
  await initProject(root)
  await mkdir(join(root, 'src/main/java/example'), { recursive: true })
  await writeFile(join(root, 'src/main/java/example/App.java'), 'package example; class App {}\n', 'utf8')
  await writeFile(join(root, 'src/main/java/example/Helper.java'), 'package example; class Helper {}\n', 'utf8')
  initializeGit(parent)
  await warmProjectIntelligenceCache(root)
  await writeFile(join(root, 'src/main/java/example/App.java'), 'package example; class App { int committed; }\n', 'utf8')
  runGit(parent, ['add', 'services/backend/src/main/java/example/App.java'])
  runGit(parent, ['commit', '-qm', 'change app'])

  const result = await inspectProjectIntelligence(root)

  assert.equal(result.intelligence.code.cache.status, 'incremental')
  assert.equal(result.intelligence.code.metrics.parsedFiles, 1)
  assert.equal(result.intelligence.code.metrics.reusedFiles, 1)
})

test('an altered cache is ignored instead of becoming project fact authority', async () => {
  const root = await fixture()
  await warmProjectIntelligenceCache(root)
  const path = join(root, CACHE_PATH)
  const record = JSON.parse(await readFile(path, 'utf8'))
  record.index.metrics.routes = 999
  await writeFile(path, JSON.stringify(record) + '\n', 'utf8')

  const result = await inspectProjectIntelligence(root)
  const routes = result.intelligence.facts.find((fact) => fact.id === 'code.routes.count')

  assert.equal(result.intelligence.code.cache.status, 'invalid')
  assert.match(result.intelligence.code.cache.diagnostic, /seal does not match/)
  assert.equal(routes.value, 1)
})

test('Git-ignored JVM sources disable cache reuse because the root fingerprint cannot bind them', async () => {
  const root = await fixture()
  await writeFile(join(root, '.gitignore'), 'build/\ntarget/\nsrc/generated/\n', 'utf8')
  await mkdir(join(root, 'src/generated/java/example'), { recursive: true })
  await writeFile(join(root, 'src/generated/java/example/Generated.java'), 'package example; class Generated {}\n', 'utf8')

  const result = await warmProjectIntelligenceCache(root)

  assert.equal(result.status, 'unsupported')
  assert.equal(result.written, false)
  assert.match(result.diagnostic, /ignored by Git/)
  await assert.rejects(access(join(root, CACHE_PATH)))
})

test('assume-unchanged and skip-worktree Git index flags disable cache reuse', async () => {
  for (const flag of ['--assume-unchanged', '--skip-worktree']) {
    const root = await fixture()
    runGit(root, ['update-index', flag, 'src/main/java/example/App.java'])

    const result = await warmProjectIntelligenceCache(root)

    assert.equal(result.status, 'unsupported')
    assert.equal(result.written, false)
    assert.match(result.diagnostic, /nonordinary Git index flag/)
  }
})

test('a symbolic-link cache path is never read or overwritten', { skip: process.platform === 'win32' }, async () => {
  const root = await fixture()
  const outside = join(await mkdtemp(join(tmpdir(), 'bth-jvm-cache-outside-')), 'outside.json')
  await writeFile(outside, '{"outside":true}\n', 'utf8')
  const cachePath = join(root, CACHE_PATH)
  await mkdir(join(root, '.backend-harness/local/cache'), { recursive: true })
  await rm(cachePath, { force: true })
  await symlink(outside, cachePath)

  const inspected = await inspectProjectIntelligence(root)
  assert.equal(inspected.intelligence.code.cache.status, 'invalid')
  assert.match(inspected.intelligence.code.cache.diagnostic, /symbolic link/)
  await assert.rejects(warmProjectIntelligenceCache(root), /symbolic link/)
  assert.equal(await readFile(outside, 'utf8'), '{"outside":true}\n')
})
