import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { initProject } from '../src/init-project.mjs'
import { initializeGit } from '../test-support/git-project.mjs'

const attributesPath = '.backend-harness/.gitattributes'
const attributes = '# Preserve harness contract bytes across Git checkouts.\n* -text\n*.cmd whitespace=cr-at-eol\n'
const git = (root, args) => execFileSync('git', ['-c', 'user.name=Harness Test', '-c', 'user.email=test@example.invalid', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

for (const system of ['maven', 'gradle', 'jest', 'unknown']) {
  test(`${system} init preserves harness contracts through Git without changing company attributes`, async () => {
    const allocation = await mkdtemp(join(tmpdir(), 'bth-git-contract-'))
    try {
      const root = join(allocation, 'source'); await mkdir(root)
      await writeFile(join(root, 'README.md'), '# Isolated Git contract fixture\n'); await initializeGit(root)
      const companyAttributes = '* text=auto\n*.json text eol=crlf\n*.cmd text eol=crlf\n'
      await writeFile(join(root, '.gitattributes'), companyAttributes)
      if (system === 'maven') {
        await writeFile(join(root, 'pom.xml'), '<project><modelVersion>4.0.0</modelVersion><groupId>test</groupId><artifactId>api</artifactId><version>1</version></project>\n')
        await writeFile(join(root, 'mvnw'), '#!/bin/sh\n', { mode: 0o755 })
      } else if (system === 'gradle') {
        await writeFile(join(root, 'build.gradle.kts'), 'plugins { java }\n')
        await writeFile(join(root, 'gradlew'), '#!/bin/sh\n', { mode: 0o755 })
      } else if (system === 'jest') {
        await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'jest' }, devDependencies: { jest: '29.7.0' } }) + '\n')
      }
      const initialized = await initProject(root)
      assert.equal(initialized.created.filter(path => path === attributesPath).length, 1, 'every init path must emit exactly one byte-preserving contract')
      assert.equal(await readFile(join(root, attributesPath), 'utf8'), attributes)
      if (system !== 'unknown') {
        const verification = JSON.parse(await readFile(join(root, '.backend-harness/verification.json')))
        assert.ok(verification.gates.every(gate => gate.inputs.includes(attributesPath)), 'attribute changes must invalidate verification')
      }
      const contractPath = '.backend-harness/fixture.cmd', contract = '@echo off\r\nexit /b 0\r\n'
      await writeFile(join(root, contractPath), contract)
      const paths = [attributesPath, contractPath, '.backend-harness/implementation.json']
      if (system !== 'unknown') paths.push('.backend-harness/verification.json')
      const expected = new Map(await Promise.all(paths.map(async path => [path, await readFile(join(root, path))])))
      git(root, ['add', '-f', '.gitattributes', '.backend-harness'])
      git(root, ['commit', '-qm', 'Test contract'])
      for (const mode of ['input', 'true', 'false']) {
        const target = join(allocation, 'checkout-' + mode)
        git(allocation, ['-c', 'core.autocrlf=' + mode, 'clone', '-q', '--no-local', root, target])
        for (const [path, bytes] of expected) {
          assert.deepEqual(await readFile(join(target, path)), bytes, `${system}/${mode}/${path}`)
          assert.equal(git(target, ['show', 'HEAD:' + path]), bytes.toString())
        }
        assert.equal(git(target, ['status', '--porcelain']), '')
      }
      assert.equal(await readFile(join(root, '.gitattributes'), 'utf8'), companyAttributes)
    } finally { await rm(allocation, { recursive: true, force: true }) }
  })
}

test('init preserves team attributes by default and backs them up on explicit force', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-preserve-attributes-'))
  try {
    await writeFile(join(root, 'README.md'), '# Isolated Git contract fixture\n')
    await initializeGit(root); await mkdir(join(root, '.backend-harness'))
    const original = '# Team-managed rule\n*.cmd text eol=crlf\n'
    await writeFile(join(root, attributesPath), original)
    const first = await initProject(root)
    assert.ok(first.skipped.includes(attributesPath))
    assert.equal(await readFile(join(root, attributesPath), 'utf8'), original)
    const forced = await initProject(root, { force: true })
    const backup = forced.backups.find(path => path.endsWith('/.gitattributes'))
    assert.ok(backup)
    assert.equal(await readFile(join(root, backup), 'utf8'), original)
    assert.equal(await readFile(join(root, attributesPath), 'utf8'), attributes)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('init refuses a symlinked attributes contract before writing any template', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-symlink-attributes-'))
  try {
    await writeFile(join(root, 'README.md'), '# Isolated Git contract fixture\n')
    await initializeGit(root); await mkdir(join(root, '.backend-harness'))
    const outside = join(root, 'outside.txt'); await writeFile(outside, 'unchanged\n')
    await symlink(outside, join(root, attributesPath))
    await assert.rejects(initProject(root), /symbolic link/)
    assert.equal(await readFile(outside, 'utf8'), 'unchanged\n')
    await assert.rejects(readFile(join(root, '.backend-harness/project.md')), { code: 'ENOENT' })
  } finally { await rm(root, { recursive: true, force: true }) }
})
