// Public pilot test environment. Runs the generated product verifier and original suite.
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = await realpath(process.cwd())
const fixture = dirname(fileURLToPath(import.meta.url))
if (fixture !== join(root, '.backend-harness/bin')) throw new Error('Run only the evaluator fixture inside its disposable clone')
const gitDir = await lstat(join(root, '.git'))
if ((!gitDir.isDirectory() && !gitDir.isFile()) || gitDir.isSymbolicLink()) throw new Error('An explicit disposable evaluator checkout is required')
const image = 'postgres@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685'
const token = randomUUID()
const password = randomUUID() + randomUUID()
const name = 'bth-fastapi-product-' + token
const label = 'bth.fastapi.productqa=' + token
const temporary = await mkdtemp(join(tmpdir(), 'bth-fastapi-product-runtime-'))
const report = join(root, '.backend-harness/local/reports/tests/junit.xml')
const environment = { PATH: process.env.PATH, HOME: process.env.HOME, SystemRoot: process.env.SystemRoot,
  PYTEST_ADDOPTS: '-p bth_evaluation_bootstrap', PYTHONDONTWRITEBYTECODE: '1' }
const evidence = { image, preparation: 'not-run', databaseReady: false, testsExitCode: null, containerRemoved: null, networkRemoved: null,
  networkPolicy: 'dedicated bridge; loopback bind requested; OS egress isolation not enforced; public synthetic data only' }
let network = null, container = null
function run(program, args, timeout = 5000, env = environment) {
  const result = spawnSync(program, args, { cwd: root, env, encoding: 'utf8', timeout, maxBuffer: 2 * 1024 * 1024, shell: false, windowsHide: true })
  if (result.error || result.signal) throw new Error(program + ' did not finish within its bounded execution contract')
  return result
}
function checked(program, args, timeout = 5000, env = environment) {
  const result = run(program, args, timeout, env)
  if (result.status !== 0) {
    process.stderr.write((result.stderr || result.stdout).slice(-12000))
    throw new Error(program + ' exited with code ' + result.status)
  }
  return result.stdout.trim()
}
async function noLocalDotenv() {
  // Settings constructors are also forced to _env_file=None by conftest.py.
  // Do not read a dotenv file, even if the public project happens to contain one.
  const lock = await readFile(join(root, 'uv.lock'), 'utf8')
  if (!lock.includes('https://pypi.org/simple') || /source = \{ (?:git|path)/.test(lock)) throw new Error('Only the pinned public registry workspace is supported')
}
try {
  await noLocalDotenv()
  evidence.preparation = 'external-product-environment-required'
  checked('docker', ['image', 'inspect', image]) // no pull or tag substitution
  network = checked('docker', ['network', 'create', '--driver', 'bridge', '--label', label, name])
  if (!/^[a-f0-9]{64}$/.test(network)) throw new Error('Invalid owned network ID')
  container = checked('docker', ['run', '--detach', '--pull=never', '--name', name, '--label', label,
    '--network', network, '--publish', '127.0.0.1::5432', '--read-only', '--user', '70:70',
    '--cap-drop=ALL', '--security-opt=no-new-privileges', '--memory=384m', '--cpus=1', '--pids-limit=128',
    '--tmpfs', '/var/lib/postgresql/data:rw,uid=70,gid=70,mode=0700,size=256m',
    '--tmpfs', '/var/run/postgresql:rw,uid=70,gid=70,mode=0700,size=16m', '--tmpfs', '/tmp:rw,size=16m',
    '--env', 'POSTGRES_USER=bth_oracle', '--env', 'POSTGRES_DB=bth_oracle',
    '--env', 'POSTGRES_PASSWORD=' + password, image], 15000)
  if (!/^[a-f0-9]{64}$/.test(container)) throw new Error('Invalid owned container ID')
  const info = JSON.parse(checked('docker', ['inspect', container]))[0]
  if (info.Config.Labels['bth.fastapi.productqa'] !== token || info.Mounts.some(m => m.Type !== 'tmpfs')) throw new Error('Unexpected container ownership or persistent mount')
  const mapping = info.NetworkSettings.Ports['5432/tcp']
  if (mapping?.length !== 1 || mapping[0].HostIp !== '127.0.0.1' || !/^\d+$/.test(mapping[0].HostPort)) throw new Error('Expected exactly one loopback port')
  const port = mapping[0].HostPort
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    if (run('docker', ['exec', container, 'pg_isready', '-U', 'bth_oracle', '-d', 'bth_oracle'], 3000).status === 0) { evidence.databaseReady = true; break }
    await new Promise(resolveWait => setTimeout(resolveWait, 200))
  }
  if (!evidence.databaseReady) throw new Error('Temporary database did not become ready')
  await mkdir(dirname(report), { recursive: true })
  await rm(report, { force: true })
  const execution = run(process.execPath, [join(root, '.backend-harness/bin/verify-portable.mjs')], 180000, { ...environment,
    PYTHONPATH: join(root, 'backend'), BTH_ORACLE_DB_PORT: port, PROJECT_NAME: 'BTH public fixture', ENVIRONMENT: 'local',
    POSTGRES_SERVER: '127.0.0.1', POSTGRES_PORT: port, POSTGRES_USER: 'bth_oracle', POSTGRES_DB: 'bth_oracle', POSTGRES_PASSWORD: password,
    SECRET_KEY: 'bth-public-test-key-not-a-real-secret-1234567890', FIRST_SUPERUSER: 'admin@example.com',
    FIRST_SUPERUSER_PASSWORD: 'bth-public-test-password', FRONTEND_HOST: 'http://localhost:5173' })
  evidence.testsExitCode = execution.status
  process.stdout.write(execution.stdout)
  process.stderr.write(execution.stderr)
  process.exitCode = execution.status ?? 1
} catch (error) {
  process.stderr.write(String(error.message) + '\n')
  process.exitCode = 1
} finally {
  try {
    // Resolve exact names and verify ownership even after a failed start.
    const existing = run('docker', ['inspect', name])
    if (existing.status === 0) {
      const owned = JSON.parse(existing.stdout)[0]
      if (owned.Config.Labels['bth.fastapi.productqa'] !== token) throw new Error('Refusing to remove an unowned container')
      checked('docker', ['rm', '--force', '--volumes', owned.Id])
      evidence.containerRemoved = run('docker', ['inspect', owned.Id]).status !== 0
    } else evidence.containerRemoved = true
    if (network) {
      const owned = JSON.parse(checked('docker', ['network', 'inspect', network]))[0]
      if (owned.Labels['bth.fastapi.productqa'] !== token) throw new Error('Refusing to remove an unowned network')
      checked('docker', ['network', 'rm', network])
      evidence.networkRemoved = run('docker', ['network', 'inspect', network]).status !== 0
    } else evidence.networkRemoved = true
  } catch (error) { process.stderr.write('Cleanup failed: ' + error.message + '\n'); process.exitCode = 1 }
  await rm(temporary, { recursive: true, force: true })
  process.stderr.write('BTH_FASTAPI_FULL_TEST_QA ' + JSON.stringify(evidence) + '\n')
}
