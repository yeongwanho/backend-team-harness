import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile, stat } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { delimiter, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { portableVerificationTemplates } from '../src/core/portable-test-discovery.mjs'

const exec = promisify(execFile)
async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bth python runner ')))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'backend/src'), { recursive: true })
  const file = portableVerificationTemplates({ canGenerateVerification: true, framework: 'pytest', projectPath: 'backend', venvPath: '.venv' }).find(f => f.path.endsWith('.mjs'))
  const runner = join(root, file.path)
  await mkdir(dirname(runner), { recursive: true })
  await writeFile(runner, file.content)
  return { root, runner }
}
async function shim(root, path, content) {
  const file = join(root, path)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, '#!' + process.execPath + '\n' + content)
  await chmod(file, 0o755)
}

test('Python verifier uses the prepared environment with member cwd and source path', { skip: process.platform === 'win32' }, async t => {
  const { root, runner } = await fixture(t)
  await shim(root, '.backend-harness/local/python-venv/bin/python', 'console.log(JSON.stringify({cwd:process.cwd(),path:process.env.PYTHONPATH,args:process.argv.slice(2)}))')
  const { stdout } = await exec(process.execPath, [runner], { cwd: root, timeout: 5000 })
  const value = JSON.parse(stdout)
  assert.equal(value.cwd, join(root, 'backend'))
  assert.deepEqual(value.path.split(delimiter), [join(root, 'backend'), join(root, 'backend/src')])
  assert.deepEqual(value.args.slice(0, 2), ['-m', 'pytest'])
  assert.ok(value.args.some(arg => arg.startsWith('--junitxml=')))
})

test('Python verifier reuses a workspace-root venv, never changes the test cwd to the root', { skip: process.platform === 'win32' }, async t => {
  const { root, runner } = await fixture(t)
  await shim(root, '.venv/bin/python', 'console.log(process.cwd())')
  const { stdout } = await exec(process.execPath, [runner], { cwd: root, timeout: 5000 })
  assert.equal(stdout.trim(), join(root, 'backend'))
})

test('missing Python environments fail without invoking uv or installing dependencies', { skip: process.platform === 'win32' }, async t => {
  const { root, runner } = await fixture(t)
  await shim(root, 'fake-bin/uv', 'require("node:fs").writeFileSync("uv-was-called", "bad")')
  await assert.rejects(exec(process.execPath, [runner], { cwd: root, timeout: 5000, env: { ...process.env, PATH: join(root, 'fake-bin') } }), /Python environment is missing/)
  await assert.rejects(stat(join(root, 'uv-was-called')), { code: 'ENOENT' })
})

test('Python verifier rejects a linked environment instead of executing an external project', { skip: process.platform === 'win32' }, async t => {
  const { root, runner } = await fixture(t)
  await mkdir(join(root, 'other/bin'), { recursive: true })
  await shim(root, 'other/bin/python', 'console.log("must not execute")')
  await symlink(join(root, 'other'), join(root, '.venv'), 'dir')
  await assert.rejects(exec(process.execPath, [runner], { cwd: root, timeout: 5000 }), /symbolic link/)
})
