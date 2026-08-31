// Evaluator-only public Spring fixture. No source edits or selected/disabled tests.
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const LABEL = 'bth.spring.fixture'
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const ID = /^[a-f0-9]{64}$/, IMAGE = /^sha256:[a-f0-9]{64}$/
function checked(result) {
  if (result.status !== 0 || result.signal || result.error) throw new Error('Fixture command failed; no successful verification claimed.')
  return result.stdout
}

export function cleanupSpringContainers(owner, images, docker) {
  if (!UUID.test(owner ?? '') || !images.length || images.some(image => !IMAGE.test(image))) throw new Error('Expected exact fixture owner and image IDs.')
  const ids = [...new Set(checked(docker(['ps', '-aq', '--no-trunc', '--filter', 'label=' + LABEL + '=' + owner])).trim().split('\n').filter(Boolean))]
  if (ids.some(id => !ID.test(id))) throw new Error('Invalid owned container list.')
  for (const id of ids) {
    const info = JSON.parse(checked(docker(['inspect', id])))
    if (!Array.isArray(info) || info.length !== 1 || info[0].Id !== id || !images.includes(info[0].Image) ||
      info[0].Config?.Labels?.[LABEL] !== owner) throw new Error('Container ownership mismatch; refusing cleanup.')
    checked(docker(['rm', '--force', '--volumes', id]))
  }
  return ids.length
}

export function mavenInvocation(platform, env) {
  if (platform === 'win32') return { program: env.ComSpec ?? env.COMSPEC ?? 'cmd.exe',
    args: ['/d', '/s', '/c', '"".\\mvnw.cmd" "-o" "-B" "verify""'], shell: false, windowsVerbatimArguments: true }
  return { program: './mvnw', args: ['-o', '-B', 'verify'], shell: false }
}

async function main() {
  if (process.argv.length !== 2) throw new Error('No verifier arguments are allowed.')
  const root = await realpath(process.cwd())
  if (dirname(fileURLToPath(import.meta.url)) !== join(root, '.backend-harness/bin')) throw new Error('Only the pinned disposable benchmark fixture is supported.')
  const env = {}
  for (const key of ['PATH', 'HOME', 'JAVA_HOME', 'M2_HOME', 'SystemRoot', 'ComSpec', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR',
    'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CERT_PATH', 'DOCKER_TLS_VERIFY', 'TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE']) {
    if (typeof process.env[key] === 'string') env[key] = process.env[key]
  }
  const docker = args => spawnSync('docker', args, { cwd: root, env, encoding: 'utf8', timeout: 20000, maxBuffer: 2 * 1024 * 1024, shell: false, windowsHide: true })
  checked(docker(['info', '--format', '{{.ServerVersion}}']))
  const images = ['mysql:9.7', 'postgres:18.4'].map(tag => {
    const image = checked(docker(['image', 'inspect', '--format', '{{.Id}}', tag])).trim()
    if (!IMAGE.test(image)) throw new Error('Exact cached image required; no pull fallback.')
    return { tag, image }
  })
  const owner = randomUUID()
  Object.assign(env, { CI: 'true', TERM: 'dumb', BTH_SPRING_OWNER: owner,
    BTH_SPRING_MYSQL_IMAGE: images[0].image, BTH_SPRING_POSTGRES_IMAGE: images[1].image,
    BTH_SPRING_DB_PASSWORD: randomUUID() + randomUUID(), TESTCONTAINERS_REUSE_ENABLE: 'false' })
  const evidence = { images, mavenExitCode: null, timedOut: false, cleanupConfirmed: false, removedAfterMaven: null,
    networkPolicy: 'owned loopback tmpfs containers; no OS egress isolation; public synthetic data only' }
  try {
    const invocation = mavenInvocation(process.platform, env)
    const result = spawnSync(invocation.program, invocation.args, { ...invocation, cwd: root, env, encoding: 'utf8',
      timeout: 180000, maxBuffer: 16 * 1024 * 1024, windowsHide: true })
    process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '')
    evidence.mavenExitCode = result.status
    evidence.timedOut = result.error?.code === 'ETIMEDOUT'
    process.exitCode = result.status === 0 && !result.signal && !result.error ? 0 : 1
  } finally {
    try {
      evidence.removedAfterMaven = cleanupSpringContainers(owner, images.map(entry => entry.image), docker)
      evidence.cleanupConfirmed = cleanupSpringContainers(owner, images.map(entry => entry.image), docker) === 0
      if (!evidence.cleanupConfirmed) process.exitCode = 1
    } catch { process.stderr.write('Owned fixture cleanup could not be confirmed.\n'); process.exitCode = 1 }
    process.stderr.write('BTH_SPRING_FULL_TEST_QA ' + JSON.stringify(evidence) + '\n')
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1 })
}
