import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initProject } from '../src/init-project.mjs'
import { configureImplementationProvider } from '../src/config/implementation-setup.mjs'
import { runWork } from '../src/runtime/work-orchestrator.mjs'
import { resetImplementation } from '../src/runtime/implementation-orchestrator.mjs'
import { initializeGit } from '../test-support/git-project.mjs'

const task = { taskId: 'PYTHON-PREP', actor: 'developer', requirement: 'Return 42 from the answer helper and add a focused pytest regression.',
  decisions: { modules: ['backend'], databaseImpact: 'none', apiImpact: 'compatible' } }
const result = exitCode => ({ exitCode, signal: null, timedOut: false, stdioDrainTimedOut: false, durationMs: 1,
  stdout: { bytes: 0, sha256: 'a'.repeat(64), tail: '' }, stderr: { bytes: 21, sha256: 'b'.repeat(64), tail: 'offline cache missing' } })

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'bth-work-python-'))
  t.after(async () => {
    try { await resetImplementation(root, task.taskId, { actor: 'fixture', discardWorkspace: true }) } catch { /* may not have been allocated */ }
    await rm(root, { recursive: true, force: true })
  })
  await mkdir(join(root, 'backend'))
  await writeFile(join(root, '.gitignore'), '.venv/\n__pycache__/\n')
  await writeFile(join(root, 'backend/answer.py'), 'def answer():\n    return 0\n')
  await writeFile(join(root, 'backend/pyproject.toml'), '[project]\nname="app"\n[dependency-groups]\ndev=["pytest"]\n')
  await writeFile(join(root, 'pyproject.toml'), '[tool.uv.workspace]\nmembers=["backend"]\n')
  await writeFile(join(root, 'uv.lock'), 'version=1\n[[package]]\nname="app"\nsource={virtual="backend"}\n[[package]]\nname="pytest"\nsource={registry="https://pypi.org/simple"}\nwheels=[{url="https://files.pythonhosted.org/pytest.whl",hash="sha256:' + 'a'.repeat(64) + '"}]\n')
  initializeGit(root, { forcePaths: ['.gitignore'] })
  await initProject(root)
  await configureImplementationProvider(root, 'codex', { maxAttempts: 1, allowedPrefixes: ['backend/'] })
  initializeGit(root, { forcePaths: ['.gitignore', '.backend-harness/.gitignore'] })
  return root
}

test('actual work orchestration spends no provider attempt when Python offline preparation fails', async t => {
  const root = await fixture(t)
  let preparationCalls = 0, providerCalls = 0
  const failed = await runWork(root, task, { approve: true, run: true, allowWrite: true, allowNetwork: true,
    providerProbe: async () => ({ available: true, version: 'synthetic-boundary-only' }),
    preparationRunner: async invocation => {
      preparationCalls++
      assert.ok(invocation.args.includes('--no-build'))
      return result(1)
    },
    providerRunner: async () => { providerCalls++; assert.fail('must not spend a provider call') }
  })
  assert.equal(failed.status, 'implementation-failed', JSON.stringify(failed))
  assert.equal(preparationCalls, 1)
  assert.equal(providerCalls, 0)
  assert.equal(failed.implementation.record.preparation.failureCode, 'offline-dependency-cache-incomplete')
  assert.equal(failed.implementation.record.preparation.sourceStable, true)
  assert.equal(failed.implementation.record.attempts.length, 0)
  assert.equal(await readFile(join(root, 'backend/answer.py'), 'utf8'), 'def answer():\n    return 0\n')
})

test('Python preparation changing declared source stops before the provider even with exit zero', async t => {
  const root = await fixture(t)
  const failed = await runWork(root, task, { approve: true, run: true, allowWrite: true, allowNetwork: true,
    providerProbe: async () => ({ available: true, version: 'synthetic-boundary-only' }),
    preparationRunner: async invocation => { await writeFile(join(invocation.cwd, 'backend/answer.py'), '# changed by preparation\n'); return result(0) },
    providerRunner: async () => assert.fail('must not call provider on a tainted workspace')
  })
  assert.equal(failed.status, 'implementation-failed', JSON.stringify(failed))
  assert.equal(failed.implementation.record.preparation.failureCode, 'workspace-preparation-source-changed')
  assert.equal(failed.implementation.record.attempts.length, 0)
  assert.equal(await readFile(join(root, 'backend/answer.py'), 'utf8'), 'def answer():\n    return 0\n')
})
