import { constants } from 'node:fs'
import { access, readdir, readFile } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { loadQualityGates } from './config/quality-gates.mjs'
import { loadVerificationConfig, resolveGateExecutable } from './config/verification.mjs'
import { resolveReadableRoot, statPath } from './fs-safety.mjs'

const SKIPPED_DIRECTORIES = new Set([
  '.git',
  '.gradle',
  '.backend-harness',
  'build',
  'node_modules',
  'out',
  'target'
])

async function regularFile(root, path) {
  const stat = await statPath(resolve(root, path))
  return Boolean(stat?.isFile() && !stat.isSymbolicLink())
}

async function executableFile(root, path) {
  if (!await regularFile(root, path)) {
    return false
  }
  if (process.platform === 'win32') {
    return true
  }
  try {
    await access(resolve(root, path), constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function findFiles(root, predicate, options = {}) {
  const matches = []
  const maxDepth = options.maxDepth ?? 12
  const maxEntries = options.maxEntries ?? 10_000
  let visited = 0

  async function visit(directory, depth) {
    if (depth > maxDepth || visited >= maxEntries) {
      return
    }
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      visited += 1
      if (visited > maxEntries) {
        return
      }
      if (entry.isSymbolicLink()) {
        continue
      }
      const path = resolve(directory, entry.name)
      const pathFromRoot = relative(root, path)
      if (entry.isFile() && predicate(pathFromRoot, entry.name)) {
        matches.push(pathFromRoot)
      } else if (entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name)) {
        await visit(path, depth + 1)
      }
    }
  }

  await visit(root, 0)
  return { matches, truncated: visited >= maxEntries }
}

async function inspectBuildFiles(root) {
  const candidates = await findFiles(
    root,
    (_path, name) => ['build.gradle', 'build.gradle.kts', 'pom.xml'].includes(name),
    { maxDepth: 4 }
  )
  const valid = []
  const invalid = []
  for (const path of candidates.matches) {
    const content = await readFile(resolve(root, path), 'utf8')
    const isMaven = path.endsWith('pom.xml')
    const hasRecognizableContent = isMaven
      ? /<project(?:\s|>)/.test(content)
      : /(plugins\s*\{|apply\s*(?:plugin|\()|dependencies\s*\{|java\s*\{)/.test(content)
    ;(hasRecognizableContent ? valid : invalid).push(path)
  }
  return { valid, invalid, truncated: candidates.truncated }
}

async function inspectFlyway(root) {
  const found = await findFiles(
    root,
    (path, name) => path.split(sep).join('/').includes('src/main/resources/db/migration/') && name.endsWith('.sql')
  )
  const versioned = new Map()
  const invalid = []
  const duplicates = []
  for (const path of found.matches) {
    const name = path.split(sep).at(-1)
    const versionMatch = name.match(/^V([0-9]+(?:[._][0-9]+)*)__[^/]+\.sql$/)
    const repeatable = /^R__[^/]+\.sql$/.test(name)
    if (!versionMatch && !repeatable) {
      invalid.push(path)
      continue
    }
    if (versionMatch) {
      const version = versionMatch[1]
        .split(/[._]/)
        .map((part) => BigInt(part).toString())
        .join('.')
      if (versioned.has(version)) {
        duplicates.push([versioned.get(version), path])
      } else {
        versioned.set(version, path)
      }
    }
  }
  return { files: found.matches, invalid, duplicates, truncated: found.truncated }
}

function check(id, status, message, details = undefined) {
  return details === undefined ? { id, status, message } : { id, status, message, details }
}

export async function doctorProject(inputPath = '.') {
  const root = await resolveReadableRoot(inputPath)
  const checks = []

  const builds = await inspectBuildFiles(root)
  checks.push(check(
    'build-file',
    builds.valid.length > 0 ? 'pass' : 'fail',
    builds.valid.length > 0
      ? 'Recognizable Gradle/Maven build definitions found.'
      : 'No recognizable Gradle or Maven build definition found.',
    builds
  ))

  const wrapperCandidates = ['gradlew', 'gradlew.bat', 'mvnw', 'mvnw.cmd']
  const wrappers = []
  for (const path of wrapperCandidates) {
    if (await executableFile(root, path)) {
      wrappers.push(path)
    }
  }
  checks.push(check(
    'build-wrapper',
    wrappers.length > 0 ? 'pass' : 'warn',
    wrappers.length > 0
      ? 'An executable build-wrapper file is available.'
      : 'No executable build-wrapper file found; guarded verification cannot run yet.',
    { files: wrappers }
  ))

  const productionSources = await findFiles(
    root,
    (path, name) => path.split(sep).join('/').includes('src/main/java/') && name.endsWith('.java')
  )
  checks.push(check(
    'main-source',
    productionSources.matches.length > 0 ? 'pass' : 'warn',
    productionSources.matches.length > 0
      ? 'Java production source files detected.'
      : 'No Java production source file found under a conventional source set.',
    { count: productionSources.matches.length, truncated: productionSources.truncated }
  ))

  const testSources = await findFiles(
    root,
    (path, name) => path.split(sep).join('/').includes('src/test/java/') && name.endsWith('.java')
  )
  checks.push(check(
    'test-source',
    testSources.matches.length > 0 ? 'pass' : 'warn',
    testSources.matches.length > 0
      ? 'Java test source files detected.'
      : 'No Java test source file found under a conventional source set.',
    { count: testSources.matches.length, truncated: testSources.truncated }
  ))

  const flyway = await inspectFlyway(root)
  const flywayInvalid = flyway.invalid.length > 0 || flyway.duplicates.length > 0
  checks.push(check(
    'flyway',
    flywayInvalid ? 'fail' : flyway.files.length > 0 ? 'pass' : 'warn',
    flywayInvalid
      ? 'Flyway migration names or versions are inconsistent.'
      : flyway.files.length > 0
        ? 'Flyway migration files have recognizable, non-duplicated names.'
        : 'No conventional Flyway SQL migration file found.',
    flyway
  ))

  const contractFiles = [
    '.backend-harness/project.md',
    '.backend-harness/architecture.md',
    '.backend-harness/glossary.md'
  ]
  const missingContractFiles = []
  for (const path of contractFiles) {
    if (!await regularFile(root, path)) {
      missingContractFiles.push(path)
    }
  }
  checks.push(check(
    'shared-contract',
    missingContractFiles.length === 0 ? 'pass' : 'fail',
    missingContractFiles.length === 0
      ? 'Required shared contract documents are regular files.'
      : 'Required shared contract documents are missing or not regular files.',
    { missing: missingContractFiles }
  ))

  let qualityGates
  try {
    qualityGates = await loadQualityGates(root)
  } catch (error) {
    qualityGates = { gates: [], diagnostics: [error instanceof Error ? error.message : String(error)] }
  }
  checks.push(check(
    'quality-gate-schema',
    qualityGates.diagnostics.length === 0 && qualityGates.gates.length > 0 ? 'pass' : 'fail',
    qualityGates.diagnostics.length === 0 && qualityGates.gates.length > 0
      ? 'Quality-gate definitions were parsed and validated.'
      : 'Quality-gate definitions are missing or invalid.',
    qualityGates
  ))

  let verification
  const verificationDiagnostics = []
  try {
    verification = await loadVerificationConfig(root, { allowInferred: false })
    for (const gate of verification.config.gates) {
      try {
        await resolveGateExecutable(root, gate.command)
      } catch (error) {
        verificationDiagnostics.push(gate.id + ': ' + (error instanceof Error ? error.message : String(error)))
      }
    }
  } catch (error) {
    verificationDiagnostics.push(error instanceof Error ? error.message : String(error))
  }
  checks.push(check(
    'verification-config',
    verificationDiagnostics.length === 0 ? 'pass' : 'fail',
    verificationDiagnostics.length === 0
      ? 'Executable verification gates and structured result rules are configured.'
      : 'Verification configuration is missing, invalid, or not executable.',
    {
      source: verification?.source ?? null,
      gates: verification?.config.gates.map((gate) => gate.id) ?? [],
      diagnostics: verificationDiagnostics
    }
  ))

  return {
    schemaVersion: 1,
    root,
    healthy: checks.every((entry) => entry.status !== 'fail'),
    checks
  }
}
