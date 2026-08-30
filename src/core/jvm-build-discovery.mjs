import { readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { runProcess } from './process-runner.mjs'

// Historical thresholds from Gradle's official Java compatibility matrix,
// checked 2026-08-30: https://docs.gradle.org/current/userguide/compatibility.html
const GRADLE_COMPATIBILITY_SOURCE = 'https://docs.gradle.org/current/userguide/compatibility.html'
const MAVEN_COMPATIBILITY_SOURCE = 'https://maven.apache.org/docs/history.html'
const GRADLE_RUNTIME_RANGES = new Map([
  [8, { minimum: '2.0', maximumExclusive: '9.0', maximumLabel: '8.14.x' }],
  [9, { minimum: '4.3', maximumExclusive: '9.0', maximumLabel: '8.14.x' }],
  [10, { minimum: '4.7', maximumExclusive: '9.0', maximumLabel: '8.14.x' }],
  [11, { minimum: '5.0', maximumExclusive: '9.0', maximumLabel: '8.14.x' }],
  [12, { minimum: '5.4', maximumExclusive: '9.0', maximumLabel: '8.14.x' }],
  [13, { minimum: '6.0', maximumExclusive: '9.0', maximumLabel: '8.14.x' }],
  [14, { minimum: '6.3', maximumExclusive: '9.0', maximumLabel: '8.14.x' }],
  [15, { minimum: '6.7', maximumExclusive: '9.0', maximumLabel: '8.14.x' }],
  [16, { minimum: '7.0', maximumExclusive: '9.0', maximumLabel: '8.14.x' }],
  [17, { minimum: '7.3' }], [18, { minimum: '7.5' }], [19, { minimum: '7.6' }],
  [20, { minimum: '8.3' }], [21, { minimum: '8.5' }], [22, { minimum: '8.8' }],
  [23, { minimum: '8.10' }], [24, { minimum: '8.14' }],
  [25, { minimum: '9.1.0' }], [26, { minimum: '9.4.0' }]
])
const MAX_BUILD_FILE_BYTES = 2 * 1024 * 1024
const MAX_WRAPPER_PROPERTIES_BYTES = 256 * 1024
const MAX_BUILD_FILES = 128
const MAX_TOTAL_BUILD_BYTES = 16 * 1024 * 1024
export const JVM_BUILD_DISCOVERY = Symbol.for('backend-team-harness.jvm-build-discovery')

function portableDirectory(path) {
  const directory = dirname(path).replaceAll('\\', '/')
  return directory === '.' ? '.' : directory
}

function versionParts(value) {
  return String(value ?? '').split('.').map((part) => Number.parseInt(part, 10) || 0)
}

function versionAtLeast(actual, required) {
  const left = versionParts(actual)
  const right = versionParts(required)
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference !== 0) return difference > 0
  }
  return true
}

function sourceModule(path) {
  const match = /^(.*?)(?:\/)?src\/(?:main|test)\/(?:java|kotlin)\//.exec(path)
  return match ? (match[1] || '.') : null
}

function buildKind(path) {
  if (/(?:^|\/)build\.gradle(?:\.kts)?$/.test(path)) return 'gradle'
  if (/(?:^|\/)pom\.xml$/.test(path)) return 'maven'
  return null
}

function recognizableBuild(path, content) {
  return path.endsWith('pom.xml')
    ? /<project(?:\s|>)/.test(content)
    : /(plugins\s*\{|apply\s*(?:plugin|\()|dependencies\s*\{|java\s*\{|subprojects\s*\{|allprojects\s*\{)/.test(content)
}

async function boundedText(path, maximumBytes) {
  const metadata = await stat(path)
  if (!metadata.isFile() || metadata.size > maximumBytes) return null
  return readFile(path, 'utf8')
}

function frameworkFrom(contents, sourceFiles) {
  if (contents.some((content) => /org\.springframework\.boot|spring-boot-/i.test(content)) ||
      sourceFiles.some((path) => /SpringBootApplication\.(?:java|kt)$/.test(path))) {
    return 'spring-boot'
  }
  return contents.length > 0 || sourceFiles.some((path) => /\.(?:java|kt)$/.test(path)) ? 'jvm' : 'unknown'
}

function parseGradleVersion(content) {
  return content?.match(/gradle-([0-9]+(?:\.[0-9]+){1,3})-(?:bin|all)\.zip/i)?.[1] ?? null
}

function parseMavenVersion(content) {
  return content?.match(/apache-maven-([0-9]+(?:\.[0-9]+){1,3})(?:-[a-z0-9.]+)*-(?:bin|all)\.zip/i)?.[1] ?? null
}

function declaredJavaVersions(contents) {
  const versions = new Set()
  const expressions = [
    /JavaLanguageVersion\.of\(\s*([0-9]+)\s*\)/g,
    /jvmToolchain\(\s*([0-9]+)\s*\)/g,
    /JavaVersion\.VERSION_(?:1_)?([0-9]+)/g,
    /<(?:java\.version|maven\.compiler\.(?:release|source|target))>\s*([0-9]+)\s*</g
  ]
  for (const content of contents) {
    for (const expression of expressions) {
      for (const match of content.matchAll(expression)) versions.add(Number.parseInt(match[1], 10))
    }
  }
  return [...versions].filter(Number.isSafeInteger).sort((left, right) => left - right)
}

async function runtimeJavaMajor(root, options) {
  if (Object.hasOwn(options, 'javaRuntimeMajor')) return options.javaRuntimeMajor
  if (options.inspectRuntime === false) return null
  const program = process.env.JAVA_HOME
    ? join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
    : 'java'
  try {
    const result = await (options.processRunner ?? runProcess)({ program, args: ['-version'], cwd: root, timeoutMs: 5000 })
    const output = result.stderr?.tail || result.stdout?.tail || ''
    const version = output.match(/version\s+"([^"]+)"/i)?.[1] ?? output.match(/openjdk\s+([^\s]+)/i)?.[1]
    if (!version) return null
    const major = Number.parseInt(version.startsWith('1.') ? version.split('.')[1] : version.split(/[.+_-]/)[0], 10)
    return Number.isSafeInteger(major) ? major : null
  } catch {
    return null
  }
}

function compatibility(system, wrapperVersion, javaRuntimeMajor) {
  if (system === 'maven') {
    const source = { source: MAVEN_COMPATIBILITY_SOURCE, checkedAsOf: '2026-08-31' }
    if (javaRuntimeMajor === null || wrapperVersion === null) {
      return {
        ...source,
        status: 'unknown', javaRuntimeMajor, minimumJavaVersion: null,
        reason: javaRuntimeMajor === null ? 'The active Java runtime could not be identified.' : 'The Maven wrapper version could not be identified.'
      }
    }
    const mavenMajor = versionParts(wrapperVersion)[0]
    const minimumJavaVersion = mavenMajor >= 4 ? 17 : mavenMajor === 3 && versionAtLeast(wrapperVersion, '3.9.0') ? 8 : null
    if (minimumJavaVersion === null) {
      return {
        ...source,
        status: 'unknown', javaRuntimeMajor, minimumJavaVersion: null,
        reason: 'The Maven wrapper is outside the supported 3.9+ and 4.x ranges covered by the embedded official requirements.'
      }
    }
    const supported = javaRuntimeMajor >= minimumJavaVersion
    return {
      ...source,
      status: supported ? 'confirmed' : 'conflict',
      javaRuntimeMajor,
      minimumJavaVersion,
      reason: supported
        ? 'The active Java runtime meets the official minimum for the Maven wrapper line.'
        : 'Maven ' + wrapperVersion + ' cannot run on Java ' + javaRuntimeMajor + '; Java ' + minimumJavaVersion + ' or newer is required.'
    }
  }
  const source = { source: GRADLE_COMPATIBILITY_SOURCE, checkedAsOf: '2026-08-30' }
  if (system !== 'gradle') {
    return {
      ...source,
      status: 'unknown',
      javaRuntimeMajor,
      minimumJavaVersion: null,
      minimumGradleVersion: null,
      reason: 'No single JVM build system was detected.'
    }
  }
  if (javaRuntimeMajor === null || wrapperVersion === null) {
    return {
      ...source,
      status: 'unknown', javaRuntimeMajor, minimumGradleVersion: javaRuntimeMajor === null ? null : (GRADLE_RUNTIME_RANGES.get(javaRuntimeMajor)?.minimum ?? null),
      minimumJavaVersion: null,
      maximumGradleVersion: null,
      reason: javaRuntimeMajor === null ? 'The active Java runtime could not be identified.' : 'The Gradle wrapper version could not be identified.'
    }
  }
  const supportedRange = GRADLE_RUNTIME_RANGES.get(javaRuntimeMajor)
  if (!supportedRange) {
    return {
      ...source,
      status: 'unknown', javaRuntimeMajor, minimumJavaVersion: null, minimumGradleVersion: null, maximumGradleVersion: null,
      reason: 'The detected Java runtime is outside the embedded official Gradle compatibility table (Java 8-26).'
    }
  }
  const aboveMinimum = versionAtLeast(wrapperVersion, supportedRange.minimum)
  const belowMaximum = !supportedRange.maximumExclusive || !versionAtLeast(wrapperVersion, supportedRange.maximumExclusive)
  const supported = aboveMinimum && belowMaximum
  return {
    ...source,
    status: supported ? 'confirmed' : 'conflict',
    javaRuntimeMajor,
    minimumJavaVersion: null,
    minimumGradleVersion: supportedRange.minimum,
    maximumGradleVersion: supportedRange.maximumLabel ?? null,
    reason: supported
      ? 'The Gradle wrapper meets the official minimum version for the active Java runtime.'
      : !aboveMinimum
        ? 'Gradle ' + wrapperVersion + ' cannot run on Java ' + javaRuntimeMajor + '; Gradle ' + supportedRange.minimum + ' or newer is required.'
        : 'Gradle ' + wrapperVersion + ' cannot run on Java ' + javaRuntimeMajor + '; the maximum supported Gradle line is ' + supportedRange.maximumLabel + '.'
  }
}

export async function inspectJvmBuild(root, manifest, options = {}) {
  const allCandidates = manifest.files.filter((path) => buildKind(path) !== null)
  const candidates = allCandidates.slice(0, MAX_BUILD_FILES)
  const candidateOverflowCount = allCandidates.length - candidates.length
  const builds = []
  const invalidBuildFiles = []
  let retainedBuildBytes = 0
  let aggregateLimitReached = false
  for (const path of candidates) {
    const content = await boundedText(join(root, path), MAX_BUILD_FILE_BYTES)
    const contentBytes = content === null ? 0 : Buffer.byteLength(content)
    if (content !== null && retainedBuildBytes + contentBytes > MAX_TOTAL_BUILD_BYTES) aggregateLimitReached = true
    if (content === null || aggregateLimitReached || !recognizableBuild(path, content)) {
      invalidBuildFiles.push(path)
      continue
    }
    retainedBuildBytes += contentBytes
    builds.push({ path, system: buildKind(path), module: portableDirectory(path), content })
  }
  const systems = [...new Set(builds.map((entry) => entry.system))].sort()
  const system = systems.length === 1 ? systems[0] : systems.length > 1 ? 'mixed' : null
  const testModules = [...new Set(manifest.files.filter((path) => /\/src\/test\/(?:java|kotlin)\//.test('/' + path)).map(sourceModule).filter(Boolean))].sort()
  const productionModules = [...new Set(manifest.files.filter((path) => /\/src\/main\/(?:java|kotlin)\//.test('/' + path)).map(sourceModule).filter(Boolean))].sort()
  const settingsFiles = manifest.files.filter((path) => ['settings.gradle', 'settings.gradle.kts', 'gradle.properties'].includes(path)).sort()
  const gradleWrapperProperties = manifest.files.includes('gradle/wrapper/gradle-wrapper.properties')
    ? await boundedText(join(root, 'gradle/wrapper/gradle-wrapper.properties'), MAX_WRAPPER_PROPERTIES_BYTES)
    : null
  const mavenWrapperProperties = manifest.files.includes('.mvn/wrapper/maven-wrapper.properties')
    ? await boundedText(join(root, '.mvn/wrapper/maven-wrapper.properties'), MAX_WRAPPER_PROPERTIES_BYTES)
    : null
  const wrapperPath = system === 'gradle'
    ? (manifest.files.includes('gradlew') ? 'gradlew' : manifest.files.includes('gradlew.bat') ? 'gradlew.bat' : null)
    : system === 'maven'
      ? (manifest.files.includes('mvnw') ? 'mvnw' : manifest.files.includes('mvnw.cmd') ? 'mvnw.cmd' : null)
      : null
  const wrapperVersion = system === 'gradle' ? parseGradleVersion(gradleWrapperProperties) : system === 'maven' ? parseMavenVersion(mavenWrapperProperties) : null
  const javaRuntimeMajor = await runtimeJavaMajor(root, options)
  const buildContents = builds.map((entry) => entry.content)
  const reportPatterns = system === 'gradle'
    ? (testModules.length > 0 ? testModules : ['.']).map((module) => (module === '.' ? '' : module + '/') + 'build/test-results/test/**/*.xml')
    : system === 'maven'
      ? (testModules.length > 0 ? testModules : ['.']).flatMap((module) => {
          const prefix = module === '.' ? '' : module + '/'
          return [prefix + 'target/surefire-reports/TEST-*.xml', prefix + 'target/failsafe-reports/TEST-*.xml']
        })
      : []
  const buildInputs = [...new Set([
    ...builds.map((entry) => entry.path),
    ...settingsFiles,
    ...(manifest.files.includes('gradle/wrapper/gradle-wrapper.properties') ? ['gradle/wrapper/gradle-wrapper.properties'] : []),
    ...(manifest.files.includes('gradle/wrapper/gradle-wrapper.jar') ? ['gradle/wrapper/gradle-wrapper.jar'] : []),
    ...(manifest.files.includes('.mvn/wrapper/maven-wrapper.properties') ? ['.mvn/wrapper/maven-wrapper.properties'] : []),
    ...(manifest.files.includes('.mvn/wrapper/maven-wrapper.jar') ? ['.mvn/wrapper/maven-wrapper.jar'] : []),
    ...(manifest.files.includes('.mvn/maven.config') ? ['.mvn/maven.config'] : [])
  ])].sort()
  const diagnostics = []
  if (system === 'mixed') diagnostics.push('Both Gradle and Maven build definitions were detected; no default verification command is safe to choose.')
  if (system === null) diagnostics.push('No recognizable Gradle or Maven build definition was detected.')
  if (candidateOverflowCount > 0) diagnostics.push('Build discovery stopped after ' + MAX_BUILD_FILES + ' files; ' + candidateOverflowCount + ' additional build definitions remain uninspected.')
  if (aggregateLimitReached) diagnostics.push('Build discovery reached the ' + MAX_TOTAL_BUILD_BYTES + '-byte aggregate content limit.')
  if (system && system !== 'mixed' && wrapperPath === null) diagnostics.push('The project build wrapper was not found at the repository root.')
  if (manifest.files.includes('gradle/wrapper/gradle-wrapper.properties') && gradleWrapperProperties === null) diagnostics.push('Gradle wrapper properties exceed the 256 KiB inspection limit.')
  if (manifest.files.includes('.mvn/wrapper/maven-wrapper.properties') && mavenWrapperProperties === null) diagnostics.push('Maven wrapper properties exceed the 256 KiB inspection limit.')
  if (reportPatterns.length > 32) diagnostics.push('Detected test modules require more than the 32 safe report patterns supported by one Gate.')
  if (buildInputs.length > 64) diagnostics.push('Detected build metadata requires more than the 64 source-bound inputs supported by one Gate.')
  const canGenerateVerification = ['gradle', 'maven'].includes(system) &&
    invalidBuildFiles.length === 0 &&
    candidateOverflowCount === 0 &&
    wrapperPath !== null &&
    reportPatterns.length > 0 &&
    reportPatterns.length <= 32 &&
    buildInputs.length <= 64

  return {
    schemaVersion: 1,
    status: systems.length === 1 && invalidBuildFiles.length === 0 && candidateOverflowCount === 0
      ? 'confirmed'
      : systems.length > 1 || invalidBuildFiles.length > 0 || candidateOverflowCount > 0
        ? 'conflict'
        : 'unknown',
    system,
    label: system && system !== 'mixed' ? system + (testModules.some((module) => module !== '.') || builds.some((entry) => entry.module !== '.') ? '-multi-module' : '-single-module') : 'unknown',
    framework: frameworkFrom(buildContents, manifest.files),
    buildFiles: builds.map(({ path, system: kind, module }) => ({ path, system: kind, module })),
    invalidBuildFiles,
    candidateOverflowCount,
    productionModules,
    testModules,
    settingsFiles,
    wrapper: { path: wrapperPath, version: wrapperVersion },
    declaredJavaVersions: declaredJavaVersions(buildContents),
    compatibility: compatibility(system, wrapperVersion, javaRuntimeMajor),
    reportPatterns,
    buildInputs,
    canGenerateVerification,
    diagnostics
  }
}
