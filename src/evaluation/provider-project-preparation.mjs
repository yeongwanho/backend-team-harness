import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { initProject } from '../init-project.mjs'
import { verificationInputPaths } from '../config/verification.mjs'
import { buildSafeEnvironment } from '../core/process-runner.mjs'
import { prepareWorkspaceDependencies } from '../core/workspace-preparation.mjs'
import { applyProjectFixture, inspectProjectFixture } from './project-fixture.mjs'
import { parseProjectFixture } from './project-fixture-config.mjs'

const execute = promisify(execFile)
async function git(root, args) {
  return (await execute('git', args, { cwd: root, env: buildSafeEnvironment(), maxBuffer: 1024 * 1024 })).stdout.trim()
}

// Only the evaluator's disposable, history-sanitized clone may be amended.
// This is common setup, never an implementation-provider contribution.
export async function prepareBenchmarkProjectFixture(root, sourceRoot, fixtureRoot, input, options = {}) {
  const fixture = parseProjectFixture(input)
  if (!fixture) throw new Error('An explicit benchmark project fixture is required.')
  if (await git(root, ['remote']) || await git(root, ['rev-list', '--count', 'HEAD']) !== '1' ||
      await git(root, ['log', '-1', '--format=%s']) !== 'sanitized benchmark base' ||
      await git(root, ['status', '--porcelain=v1', '--untracked-files=all'])) {
    throw new Error('Project fixture preparation requires a clean, sanitized single-commit benchmark clone with no remote.')
  }
  await initProject(root, { preferredSystem: options.buildSystem })
  const overlay = await applyProjectFixture(root, fixtureRoot, fixture)
  await git(root, ['add', '-f', '--', '.backend-harness/.gitignore', ...fixture.files.map(file => file.path)])
  await git(root, ['add', '--', '.backend-harness'])
  await git(root, ['-c', 'user.name=Backend Team Harness Benchmark', '-c', 'user.email=bth-benchmark@example.invalid',
    'commit', '--amend', '--no-edit', '-q'])
  const preparation = await (options.prepareDependencies ?? prepareWorkspaceDependencies)(sourceRoot, root,
    fixture.workspacePreparation, verificationInputPaths(fixture.verification))
  const integrity = await inspectProjectFixture(root, fixture)
  const sourceClean = !(await git(root, ['status', '--porcelain=v1', '--untracked-files=all']))
  return {
    passed: (preparation === null || preparation.status === 'passed') && integrity.valid && sourceClean,
    process: preparation?.process ?? null,
    preparation,
    fixture: { files: overlay.files, integrity, sourceClean }
  }
}
