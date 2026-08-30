import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  defaultVerificationConfig,
  resolveGateExecutable,
  verificationExecutablePaths,
  verificationInputPaths
} from '../src/config/verification.mjs'
import { implementationStateDirectory, projectExecutableForPlatform } from '../src/core/platform.mjs'
import { buildProcessLaunch, buildSafeEnvironment, windowsTaskkillInvocation } from '../src/core/process-runner.mjs'
import { gateForPack, getPack } from '../src/packs/catalog.mjs'

test('shared Gradle and Maven wrapper commands resolve to Windows launchers', () => {
  assert.equal(projectExecutableForPlatform('./gradlew', 'win32'), './gradlew.bat')
  assert.equal(projectExecutableForPlatform('./mvnw', 'win32'), './mvnw.cmd')
  assert.equal(projectExecutableForPlatform('./tools/verify.cmd', 'win32'), './tools/verify.cmd')
  assert.equal(projectExecutableForPlatform('./gradlew', 'linux'), './gradlew')
})

test('Windows batch launch uses cmd.exe without enabling a string shell', () => {
  const launch = buildProcessLaunch({
    program: 'C:\\work tree\\gradlew.bat',
    args: ['test', '--console=plain', '-Dfixture=value with spaces'],
    platform: 'win32',
    env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' }
  })

  assert.equal(launch.program, 'C:\\Windows\\System32\\cmd.exe')
  assert.deepEqual(launch.args.slice(0, 3), ['/d', '/s', '/c'])
  assert.equal(
    launch.args[3],
    '""C:\\work tree\\gradlew.bat" "test" "--console=plain" "-Dfixture=value with spaces""'
  )
  assert.equal(launch.options.shell, false)
  assert.equal(launch.options.windowsVerbatimArguments, true)
})

test('safe child environment keeps the Windows command processor path', () => {
  const environment = buildSafeEnvironment({ COMSPEC: 'C:\\Windows\\System32\\cmd.exe', SECRET_TOKEN: 'do-not-copy' })
  assert.equal(environment.COMSPEC, 'C:\\Windows\\System32\\cmd.exe')
  assert.equal(environment.SECRET_TOKEN, undefined)
})

test('Windows batch launch rejects cmd.exe expansion and quote injection', () => {
  for (const argument of ['%PATH%', 'unsafe"value', 'line\nbreak']) {
    assert.throws(
      () => buildProcessLaunch({ program: 'C:\\repo\\gradlew.bat', args: [argument], platform: 'win32' }),
      /cannot be represented safely/
    )
  }
})

test('Windows timeout escalation targets the complete descendant tree', () => {
  assert.deepEqual(windowsTaskkillInvocation(42, 'SIGTERM'), {
    program: 'taskkill.exe',
    args: ['/pid', '42', '/t']
  })
  assert.deepEqual(windowsTaskkillInvocation(42, 'SIGKILL'), {
    program: 'taskkill.exe',
    args: ['/pid', '42', '/t', '/f']
  })
  assert.throws(() => windowsTaskkillInvocation(0, 'SIGTERM'), /positive PID/)
})

test('Windows uses LOCALAPPDATA for isolated implementation state', () => {
  assert.equal(
    implementationStateDirectory({
      platform: 'win32',
      environment: { LOCALAPPDATA: 'D:\\Profiles\\Ada\\AppData\\Local' },
      home: 'D:\\Profiles\\Ada'
    }),
    'D:\\Profiles\\Ada\\AppData\\Local\\backend-team-harness'
  )
  assert.equal(
    implementationStateDirectory({ platform: 'win32', environment: {}, home: 'C:\\Users\\Ada' }),
    'C:\\Users\\Ada\\AppData\\Local\\backend-team-harness'
  )
  assert.equal(
    implementationStateDirectory({ platform: 'linux', environment: { XDG_STATE_HOME: '/var/state/ada' }, home: '/home/ada' }),
    '/var/state/ada/backend-team-harness'
  )
})

test('portable verification config binds and resolves the Windows wrapper', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-windows-gradle-'))
  await writeFile(join(root, 'build.gradle.kts'), 'plugins { java }\n', 'utf8')
  await writeFile(join(root, 'gradlew.bat'), '@exit /b 0\r\n', 'utf8')

  const config = await defaultVerificationConfig(root)
  assert.equal(config.gates[0].command[0], './gradlew')
  assert.deepEqual(verificationExecutablePaths(config, { platform: 'win32' }), ['./gradlew.bat'])
  assert.ok(verificationInputPaths(config, { platform: 'win32' }).includes('./gradlew.bat'))
  assert.equal((await resolveGateExecutable(root, config.gates[0].command, { platform: 'win32' })).displayPath, './gradlew.bat')
})

test('installed pack contracts stay portable and select the wrapper at execution time', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-windows-pack-'))
  await writeFile(join(root, 'build.gradle.kts'), 'plugins { java }\n', 'utf8')
  const gate = await gateForPack(getPack('db-integration'), root)

  assert.equal(gate.command[0], './gradlew')
  assert.deepEqual(
    verificationExecutablePaths({ gates: [gate] }, { platform: 'win32' }),
    ['./gradlew.bat']
  )
})
