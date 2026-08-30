import { constants } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { loadQualityGates } from './config/quality-gates.mjs'
import { loadVerificationConfig, resolveGateExecutable } from './config/verification.mjs'
import { inspectJvmBuild, JVM_BUILD_DISCOVERY } from './core/jvm-build-discovery.mjs'
import { scanProjectManifest } from './core/project-manifest.mjs'
import { reportGlobRegex } from './core/report-glob.mjs'
import { resolveReadableRoot, statPath } from './fs-safety.mjs'

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

function matchingFiles(manifest, predicate, options = {}) {
  const maxParentDepth = options.maxParentDepth ?? Infinity
  return {
    matches: manifest.files.filter((path) => {
      const parts = path.split('/')
      return parts.length - 1 <= maxParentDepth && predicate(path, parts.at(-1))
    }),
    truncated: manifest.truncated
  }
}

async function inspectBuildFiles(root, manifest) {
  const candidates = matchingFiles(
    manifest,
    (_path, name) => ['build.gradle', 'build.gradle.kts', 'pom.xml'].includes(name),
    { maxParentDepth: 4 }
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

async function inspectFlyway(manifest) {
  const found = matchingFiles(
    manifest,
    (path, name) => path.includes('/db/migration/') && name.endsWith('.sql')
  )
  const versioned = new Map()
  const invalid = []
  const duplicates = []
  for (const path of found.matches) {
    const name = path.split('/').at(-1)
    const versionMatch = name.match(/^([VU])([0-9]+(?:[._][0-9]+)*)__[^/]+\.sql$/)
    const repeatable = /^R__[^/]+\.sql$/.test(name)
    if (!versionMatch && !repeatable) {
      invalid.push(path)
      continue
    }
    if (versionMatch) {
      const parts = versionMatch[2]
        .split(/[._]/)
        .map((part) => BigInt(part).toString())
      while (parts.length > 1 && parts.at(-1) === '0') {
        parts.pop()
      }
      const version = versionMatch[1] + ':' + parts.join('.')
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

export async function doctorProject(inputPath = '.', options = {}) {
  const root = await resolveReadableRoot(inputPath)
  const manifest = options.manifest ?? await scanProjectManifest(root)
  if (manifest.root !== root) {
    throw new Error('Project manifest belongs to a different root.')
  }
  const checks = []
  const detectionOptions = { processRunner: options.processRunner }
  if (Object.hasOwn(options, 'javaRuntimeMajor')) detectionOptions.javaRuntimeMajor = options.javaRuntimeMajor
  const detection = await inspectJvmBuild(root, manifest, detectionOptions)

  const builds = await inspectBuildFiles(root, manifest)
  const buildStatus = builds.valid.length > 0 ? 'pass' : builds.invalid.length > 0 ? 'fail' : 'warn'
  checks.push(check(
    'build-file',
    buildStatus,
    builds.valid.length > 0
      ? 'Recognizable Gradle/Maven build definitions found.'
      : builds.invalid.length > 0
        ? 'Gradle/Maven build candidates exist but are not recognizable files.'
        : 'No JVM build definition found; a valid project-declared verification contract may still be used.',
    builds
  ))

  checks.push(check(
    'build-metadata',
    detection.status === 'confirmed' ? 'pass' : detection.status === 'conflict' ? 'fail' : 'warn',
    detection.status === 'confirmed'
      ? 'Build system, modules, framework hints, and report locations were detected from repository files.'
      : detection.status === 'conflict'
        ? 'Build metadata is conflicting or contains unrecognized build definitions.'
        : 'Build metadata could not be identified confidently.',
    {
      status: detection.status,
      system: detection.system,
      build: detection.label,
      framework: detection.framework,
      buildFiles: detection.buildFiles,
      invalidBuildFiles: detection.invalidBuildFiles,
      productionModules: detection.productionModules,
      testModules: detection.testModules,
      diagnostics: detection.diagnostics
    }
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
      : 'No JVM build wrapper found; project-owned verification executables are checked separately.',
    { files: wrappers }
  ))

  const compatibilityStatus = detection.compatibility.status === 'conflict'
    ? 'fail'
    : detection.status === 'confirmed' && detection.compatibility.status === 'confirmed'
      ? 'pass'
      : 'warn'
  checks.push(check(
    'jvm-toolchain',
    compatibilityStatus,
    detection.compatibility.reason,
    {
      system: detection.system,
      gradleVersion: detection.system === 'gradle' ? detection.wrapper.version : null,
      mavenVersion: detection.system === 'maven' ? detection.wrapper.version : null,
      javaRuntimeMajor: detection.compatibility.javaRuntimeMajor,
      minimumJavaVersion: detection.compatibility.minimumJavaVersion,
      minimumGradleVersion: detection.compatibility.minimumGradleVersion,
      maximumGradleVersion: detection.compatibility.maximumGradleVersion,
      declaredJavaVersions: detection.declaredJavaVersions,
      compatibilitySource: detection.compatibility.source,
      compatibilityCheckedAsOf: detection.compatibility.checkedAsOf
    }
  ))

  const productionSources = matchingFiles(
    manifest,
    (path, name) => /src\/main\/(?:java|kotlin)\//.test(path) && /\.(?:java|kt)$/.test(name)
  )
  checks.push(check(
    'main-source',
    productionSources.matches.length > 0 ? 'pass' : 'warn',
    productionSources.matches.length > 0
      ? 'JVM production source files detected.'
      : 'No Java/Kotlin production source file found under a conventional source set.',
    { count: productionSources.matches.length, truncated: productionSources.truncated }
  ))

  const testSources = matchingFiles(
    manifest,
    (path, name) => /src\/test\/(?:java|kotlin)\//.test(path) && /\.(?:java|kt)$/.test(name)
  )
  checks.push(check(
    'test-source',
    testSources.matches.length > 0 ? 'pass' : 'warn',
    testSources.matches.length > 0
      ? 'JVM test source files detected.'
      : 'No Java/Kotlin test source file found under a conventional source set.',
    { count: testSources.matches.length, truncated: testSources.truncated }
  ))

  const flyway = await inspectFlyway(manifest)
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
      ? 'Human review-checklist definitions were parsed and validated; executable authority remains in verification.json.'
      : 'Human review-checklist definitions are missing or invalid.',
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

  const junitReports = verification?.config.gates
    .filter((gate) => gate.required && gate.result.type === 'junit')
    .flatMap((gate) => gate.result.reports) ?? []
  const uncoveredTestModules = detection.testModules.filter((module) => {
    const prefix = module === '.' ? '' : module + '/'
    const candidates = detection.system === 'gradle'
      ? [prefix + 'build/test-results/test/TEST-bth-sample.xml']
      : detection.system === 'maven'
        ? [prefix + 'target/surefire-reports/TEST-bth-sample.xml', prefix + 'target/failsafe-reports/TEST-bth-sample.xml']
        : []
    return candidates.length > 0 && !candidates.some((candidate) => junitReports.some((pattern) => reportGlobRegex(pattern).test(candidate)))
  })
  const coverageApplicable = ['gradle', 'maven'].includes(detection.system) && detection.testModules.length > 0
  const coverageStatus = !coverageApplicable
    ? 'warn'
    : verificationDiagnostics.length > 0 || uncoveredTestModules.length > 0
      ? 'fail'
      : 'pass'
  checks.push(check(
    'verification-coverage',
    coverageStatus,
    !coverageApplicable
      ? 'No conventional JVM test module was detected, so generated JUnit coverage cannot be proven.'
      : uncoveredTestModules.length > 0
        ? 'Required JUnit report patterns do not cover every detected test module.'
        : 'Required JUnit report patterns cover every detected test module.',
    {
      system: detection.system,
      testModules: detection.testModules,
      uncoveredTestModules,
      reports: junitReports
    }
  ))

  const failures = checks.filter((entry) => entry.status === 'fail')
  const criticalUnknowns = checks.filter((entry) => entry.status === 'warn' && (
    entry.id === 'jvm-toolchain' && detection.status === 'confirmed' ||
    entry.id === 'verification-coverage' && coverageApplicable
  ))
  const readiness = failures.length > 0 ? 'blocked' : criticalUnknowns.length > 0 ? 'unknown' : 'ready'

  const result = {
    schemaVersion: 1,
    scope: 'structural-readiness',
    root,
    readiness,
    healthy: readiness === 'ready',
    checks
  }
  Object.defineProperty(result, JVM_BUILD_DISCOVERY, { value: detection })
  return result
}
