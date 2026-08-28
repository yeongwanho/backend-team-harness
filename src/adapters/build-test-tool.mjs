import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { relative } from 'node:path'
import { resolveSafeProjectPath, statPath } from '../fs-safety.mjs'
import { runProcess } from '../core/process-runner.mjs'

async function executableWrapper(root, relativePath) {
  const path = await resolveSafeProjectPath(root, relativePath)
  const stat = await statPath(path)
  if (!stat?.isFile() || stat.isSymbolicLink()) {
    return null
  }
  if (process.platform !== 'win32') {
    try {
      await access(path, constants.X_OK)
    } catch {
      return null
    }
  }
  return path
}

async function selectBuildCommand(root) {
  const gradle = await executableWrapper(root, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')
  if (gradle) {
    return {
      kind: 'gradle',
      program: gradle,
      displayProgram: './' + relative(root, gradle),
      args: ['test', '--offline', '--no-daemon', '--console=plain']
    }
  }

  const maven = await executableWrapper(root, process.platform === 'win32' ? 'mvnw.cmd' : 'mvnw')
  if (maven) {
    return {
      kind: 'maven',
      program: maven,
      displayProgram: './' + relative(root, maven),
      args: ['-o', '-B', 'test']
    }
  }

  throw new Error('No executable Gradle or Maven wrapper is available. Global build tools are intentionally not used.')
}

export function createBuildTestTool(options = {}) {
  const processRunner = options.processRunner ?? runProcess
  return Object.freeze({
    id: 'build.test',
    description: 'Run the project-owned Gradle/Maven test wrapper in offline mode.',
    allowedStates: ['VERIFYING'],
    network: false,
    mutatesSource: false,
    async execute(_invocation, context) {
      const command = await selectBuildCommand(context.root)
      const result = await processRunner({
        program: command.program,
        args: command.args,
        cwd: context.root,
        timeoutMs: options.timeoutMs
      })
      return {
        adapter: command.kind,
        command: [command.displayProgram, ...command.args],
        ...result
      }
    }
  })
}
