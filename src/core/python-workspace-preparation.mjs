import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { resolveSafeProjectPath, statPath } from '../fs-safety.mjs'
import { scanProjectManifest } from './project-manifest.mjs'
import { buildSafeEnvironment, runProcess } from './process-runner.mjs'
import { inspectPythonTestProjects, parsePythonToml, readPythonMetadata } from './python-project.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
function registryUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
  } catch { return false }
}

export function validateOfflineUvLock(document, uv) {
  if (document?.version !== 1 || !Array.isArray(document.package) || document.package.length < 1 || document.package.length > 20000) throw new Error('Unsupported or unbounded uv lockfile.')
  const found = new Set()
  let dependencyEntries = 0
  for (const entry of document.package) {
    if (!entry || typeof entry.name !== 'string' || !entry.source || typeof entry.source !== 'object' || Array.isArray(entry.source) || Object.keys(entry.source).length !== 1) throw new Error('Unsupported uv package source.')
    const localPath = entry.source.editable ?? entry.source.virtual
    if (localPath !== undefined) {
      if (!uv.members.some(member => member.name === entry.name && member.path === localPath) || found.has(entry.name)) throw new Error('uv lock contains an undeclared or duplicate local workspace package.')
      found.add(entry.name)
      continue
    }
    if (!registryUrl(entry.source.registry)) throw new Error('uv preparation only supports credential-free HTTPS registry artifacts and declared workspace members.')
    if (entry.wheels !== undefined && (!Array.isArray(entry.wheels) || entry.wheels.length > 1024)) throw new Error('uv wheels must be a bounded artifact list.')
    const artifacts = [...(entry.wheels ?? []), ...(entry.sdist ? [entry.sdist] : [])]
    if (!artifacts.length || artifacts.length > 1024 || artifacts.some(artifact => !registryUrl(artifact?.url) || !/^sha256:[a-f0-9]{64}$/.test(artifact?.hash ?? ''))) throw new Error('uv artifacts require bounded HTTPS locations and pinned SHA-256 hashes.')
    dependencyEntries++
  }
  if (found.size !== uv.members.length) throw new Error('uv lock is missing declared workspace packages.')
  return { dependencyEntries, workspaceEntries: found.size }
}

export async function preparePythonWorkspaceDependencies(workspace, configuration, declaredInputs, options = {}) {
  const manifest = await scanProjectManifest(workspace)
  const selected = (await inspectPythonTestProjects(workspace, manifest)).find(project => project.projectPath === configuration.projectPath)
  if (!selected?.uv || selected.metadataIssue) throw new Error('Python preparation requires an unambiguous repository-contained uv workspace and lock.')
  const declared = new Set(declaredInputs.map(path => path.replace(/^\.\//, '')))
  if (selected.buildInputs.some(path => !declared.has(path))) throw new Error('Every uv workspace manifest, lock and Python pin must be declared verification inputs.')
  const inputs = []
  for (const path of selected.buildInputs) {
    const file = await readPythonMetadata(workspace, path, path === selected.uv.lockPath ? 8 * 1024 * 1024 : 1024 * 1024)
    if (!file) throw new Error('Declared Python preparation input is missing.')
    // Do not let an out-of-date manifest make uv inspect arbitrary local/Git sources.
    if (path.endsWith('pyproject.toml')) {
      const document = parsePythonToml(file.text)
      for (const source of Object.values(document.tool?.uv?.sources ?? {})) {
        const entries = Array.isArray(source) ? source : [source]
        if (entries.some(entry => !entry || Object.keys(entry).some(key => !['workspace', 'index', 'marker', 'extra', 'group'].includes(key)) ||
            (entry.workspace !== true && typeof entry.index !== 'string'))) throw new Error('Python preparation rejects external local, URL and Git manifest sources.')
      }
    }
    inputs.push({ path, sha256: hash(file.bytes), ...(path === selected.uv.lockPath ? { lock: parsePythonToml(file.text) } : {}) })
  }
  const counts = validateOfflineUvLock(inputs.find(input => input.lock).lock, selected.uv)
  const environmentPath = await resolveSafeProjectPath(workspace, '.backend-harness/local/python-venv')
  const environment = await statPath(environmentPath)
  if (environment && (!environment.isDirectory() || environment.isSymbolicLink())) throw new Error('Prepared Python environment must not be a link or non-directory.')
  await mkdir(dirname(environmentPath), { recursive: true })
  const project = await resolveSafeProjectPath(workspace, selected.uv.workspacePath)
  const version = configuration.pythonVersion ?? selected.uv.pythonVersion
  if (version !== null && version !== undefined && !/^3\.\d{1,2}(?:\.\d{1,2})?$/.test(version)) throw new Error('Python version must be a numeric Python 3 version.')
  const flags = ['--package', selected.uv.packageName, '--offline', '--locked', '--no-build', '--no-install-workspace', '--no-python-downloads', '--no-config',
    ...(version ? ['--python', version] : []), ...selected.uv.testGroups.flatMap(group => ['--group', group]), ...selected.uv.testExtras.flatMap(extra => ['--extra', extra])]
  const invocation = {
    program: (options.platform ?? process.platform) === 'win32' ? 'uv.exe' : 'uv',
    args: ['sync', '--project', project, ...flags], cwd: project, timeoutMs: configuration.timeoutMs,
    env: { ...buildSafeEnvironment(), UV_PROJECT_ENVIRONMENT: environmentPath, UV_OFFLINE: '1', UV_PYTHON_DOWNLOADS: 'never', UV_NO_CONFIG: '1', UV_NO_ENV_FILE: '1' }
  }
  const execution = await (options.processRunner ?? runProcess)(invocation)
  const passed = execution.exitCode === 0 && !execution.signal && !execution.timedOut && !execution.stdioDrainTimedOut
  const tail = (execution.stderr?.tail ?? '') + '\n' + (execution.stdout?.tail ?? '')
  return {
    kind: configuration.kind, projectPath: configuration.projectPath, status: passed ? 'passed' : 'failed', ...counts,
    inputs: inputs.map(({ path, sha256 }) => ({ path, sha256 })),
    command: [invocation.program, 'sync', '--project', '<isolated-workspace>', ...flags],
    environmentPath: '.backend-harness/local/python-venv',
    failureCode: passed ? null : execution.signal || execution.timedOut || execution.stdioDrainTimedOut ? 'workspace-preparation-failed'
      : /offline|not.*cache|cache.*missing|not found in.*cache/i.test(tail)
      ? 'offline-dependency-cache-incomplete' : /lockfile.*(?:update|change)|lock.*needs.*update/i.test(tail)
        ? 'python-lock-out-of-date' : 'workspace-preparation-failed',
    process: { exitCode: execution.exitCode, signal: execution.signal, timedOut: execution.timedOut,
      stdioDrainTimedOut: execution.stdioDrainTimedOut, durationMs: execution.durationMs,
      stdout: { sha256: execution.stdout?.sha256, bytes: execution.stdout?.bytes },
      stderr: { sha256: execution.stderr?.sha256, bytes: execution.stderr?.bytes } },
    lifecycleScripts: false, onlineFallback: false, egressIsolation: 'not-enforced'
  }
}
