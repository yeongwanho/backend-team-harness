import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { resolveSafeProjectPath, statPath } from '../fs-safety.mjs'
import { runProcess } from './process-runner.mjs'

async function sha256File(root, relativePath) {
  const path = await resolveSafeProjectPath(root, relativePath)
  const metadata = await statPath(path)
  if (!metadata?.isFile() || metadata.isSymbolicLink()) {
    throw new Error('Toolchain input is missing or unsafe: ' + relativePath)
  }
  const hash = createHash('sha256')
  await new Promise((resolvePromise, reject) => {
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.once('end', resolvePromise)
    stream.once('error', reject)
  })
  return { sha256: hash.digest('hex'), bytes: metadata.size }
}

async function wrapperVersion(root, paths, expression) {
  for (const relativePath of paths) {
    const path = await resolveSafeProjectPath(root, relativePath)
    const metadata = await statPath(path)
    if (!metadata?.isFile() || metadata.isSymbolicLink() || metadata.size > 256 * 1024) {
      continue
    }
    const match = (await readFile(path, 'utf8')).match(expression)
    if (match) {
      return match[1]
    }
  }
  return null
}

async function javaRuntime(root, needed) {
  if (!needed) {
    return { required: false, available: null, version: null, outputSha256: null }
  }
  const configured = typeof process.env.JAVA_HOME === 'string' && process.env.JAVA_HOME
    ? join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
    : 'java'
  try {
    const result = await runProcess({
      program: configured,
      args: ['-version'],
      cwd: root,
      timeoutMs: 5000
    })
    const output = (result.stderr.tail || result.stdout.tail).split('\n').map((line) => line.trim()).find(Boolean) ?? ''
    const quotedVersion = output.match(/version\s+"([^"]+)"/i)?.[1] ?? null
    const bareVersion = output.match(/^openjdk\s+([^\s]+)/i)?.[1] ?? null
    const version = quotedVersion ?? (bareVersion === 'version' ? null : bareVersion)
    return {
      required: true,
      available: result.exitCode === 0 && !result.timedOut,
      version,
      outputSha256: result.stderr.bytes > 0 ? result.stderr.sha256 : result.stdout.sha256
    }
  } catch {
    return { required: true, available: false, version: null, outputSha256: null }
  }
}

export async function captureToolchain(root, config) {
  const executables = []
  for (const gate of config.gates) {
    const relativePath = gate.command[0].replace(/^\.\//, '')
    executables.push({ gateId: gate.id, path: './' + relativePath, ...await sha256File(root, relativePath) })
  }
  const commandNames = config.gates.map((gate) => basename(gate.command[0]).toLowerCase())
  const javaNeeded = commandNames.some((name) => name.startsWith('gradlew') || name.startsWith('mvnw'))
  const [java, gradle, maven] = await Promise.all([
    javaRuntime(root, javaNeeded),
    wrapperVersion(root, ['gradle/wrapper/gradle-wrapper.properties'], /gradle-([0-9]+(?:\.[0-9]+)+)-/),
    wrapperVersion(root, ['.mvn/wrapper/maven-wrapper.properties'], /apache-maven-([0-9]+(?:\.[0-9]+)+)-/)
  ])
  return {
    node: process.version,
    java,
    wrappers: { gradle, maven },
    declaredContext: config.context,
    executables
  }
}
