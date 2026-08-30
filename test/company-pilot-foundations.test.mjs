import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectProjectIntelligence } from '../src/adapters/project-intelligence.mjs'
import { defaultVerificationConfig } from '../src/config/verification.mjs'
import { doctorProject } from '../src/doctor.mjs'
import { initProject } from '../src/init-project.mjs'
import { inspectJvmBuild } from '../src/core/jvm-build-discovery.mjs'
import { scanProjectManifest } from '../src/core/project-manifest.mjs'
import { checkProject } from '../src/runtime/backend-harness.mjs'
import { initializeGit } from '../test-support/git-project.mjs'

async function writeExecutable(path, content = '#!/bin/sh\nexit 0\n') {
  await writeFile(path, content, 'utf8')
  await chmod(path, 0o755)
}

async function multiModuleGradleProject(prefix = 'bth-company-pilot-') {
  const root = await mkdtemp(join(tmpdir(), prefix))
  await mkdir(join(root, 'gradle/wrapper'), { recursive: true })
  await mkdir(join(root, 'hospital/src/main/java/example'), { recursive: true })
  await mkdir(join(root, 'hospital/src/test/java/example'), { recursive: true })
  await mkdir(join(root, 'admin/src/main/java/example'), { recursive: true })
  await mkdir(join(root, 'admin/src/test/java/example'), { recursive: true })
  await writeFile(join(root, 'settings.gradle.kts'), 'rootProject.name = "company"\ninclude("hospital", "admin")\n', 'utf8')
  await writeFile(join(root, 'build.gradle.kts'), 'plugins { id("org.springframework.boot") version "3.5.0" apply false }\n', 'utf8')
  await writeFile(join(root, 'hospital/build.gradle.kts'), 'plugins { java; id("org.springframework.boot") }\n', 'utf8')
  await writeFile(join(root, 'admin/build.gradle.kts'), 'plugins { java; id("org.springframework.boot") }\n', 'utf8')
  await writeFile(join(root, 'hospital/src/main/java/example/Hospital.java'), 'class Hospital {}\n', 'utf8')
  await writeFile(join(root, 'hospital/src/test/java/example/HospitalTest.java'), 'class HospitalTest {}\n', 'utf8')
  await writeFile(join(root, 'admin/src/main/java/example/Admin.java'), 'class Admin {}\n', 'utf8')
  await writeFile(join(root, 'admin/src/test/java/example/AdminTest.java'), 'class AdminTest {}\n', 'utf8')
  await writeFile(join(root, 'gradle/wrapper/gradle-wrapper.properties'), 'distributionUrl=https\\://services.gradle.org/distributions/gradle-7.5-bin.zip\n', 'utf8')
  await writeFile(join(root, '.gitignore'), '**/build/\n', 'utf8')
  await writeExecutable(join(root, 'gradlew'))
  return root
}

test('read-only intelligence bootstraps from Git source without a harness contract', async () => {
  const root = await multiModuleGradleProject('bth-bootstrap-intelligence-')
  initializeGit(root)

  const result = await inspectProjectIntelligence(root, { useCache: false, javaRuntimeMajor: 17 })
  const verification = result.intelligence.facts.find((entry) => entry.id === 'verification.config.present')

  assert.equal(result.structuralReadiness, false)
  assert.equal(result.intelligence.overallStatus, 'unknown')
  assert.equal(result.verification.status, 'missing')
  assert.equal(result.verification.path, null)
  assert.equal(result.intelligence.code.metrics.files, 4)
  assert.equal(verification.value, false)
})

test('verification discovery covers every detected Gradle test module', async () => {
  const root = await multiModuleGradleProject('bth-multimodule-default-')

  const config = await defaultVerificationConfig(root)

  assert.deepEqual(config.gates[0].result.reports, [
    'admin/build/test-results/test/**/*.xml',
    'hospital/build/test-results/test/**/*.xml'
  ])
  assert.ok(config.gates[0].inputs.includes('settings.gradle.kts'))
  assert.ok(config.gates[0].inputs.includes('admin/build.gradle.kts'))
  assert.ok(config.gates[0].inputs.includes('hospital/build.gradle.kts'))
})

test('generated multi-module verification ingests fresh JUnit reports from every module', async () => {
  const root = await multiModuleGradleProject('bth-multimodule-execution-')
  await writeExecutable(join(root, 'gradlew'), [
    '#!/bin/sh',
    'mkdir -p admin/build/test-results/test hospital/build/test-results/test',
    'printf \'%s\\n\' \'<testsuite tests="1"><testcase name="admin"/></testsuite>\' > admin/build/test-results/test/TEST-admin.xml',
    'printf \'%s\\n\' \'<testsuite tests="1"><testcase name="hospital"/></testsuite>\' > hospital/build/test-results/test/TEST-hospital.xml',
    ''
  ].join('\n'))
  initializeGit(root)
  await initProject(root)

  const result = await checkProject(root)

  assert.equal(result.confirmed, true, JSON.stringify(result.result, null, 2))
  assert.equal(result.result.tests.executed, 2)
  assert.deepEqual(result.result.gates[0].result.reportFiles, [
    'admin/build/test-results/test/TEST-admin.xml',
    'hospital/build/test-results/test/TEST-hospital.xml'
  ])
})

test('init records detected build facts instead of writing unknown placeholders', async () => {
  const root = await multiModuleGradleProject('bth-init-detected-project-')
  initializeGit(root)

  const result = await initProject(root)
  const project = await readFile(join(root, '.backend-harness/project.md'), 'utf8')

  assert.equal(result.detection.system, 'gradle')
  assert.deepEqual(result.detection.testModules, ['admin', 'hospital'])
  assert.match(project, /^framework: spring-boot$/m)
  assert.match(project, /^build: gradle-multi-module$/m)
})

test('doctor rejects a root-only JUnit contract for a multi-module Gradle repository', async () => {
  const root = await multiModuleGradleProject('bth-doctor-multimodule-')
  initializeGit(root)
  await initProject(root)
  await writeFile(join(root, '.backend-harness/verification.json'), JSON.stringify({
    schemaVersion: 1,
    gates: [{
      id: 'tests', required: true, command: ['./gradlew', 'test', '--offline'],
      result: { type: 'junit', reports: ['build/test-results/test/**/*.xml'], minimumTests: 1 }
    }]
  }, null, 2) + '\n', 'utf8')

  const result = await doctorProject(root, { javaRuntimeMajor: 17 })
  const coverage = result.checks.find((entry) => entry.id === 'verification-coverage')

  assert.equal(result.healthy, false)
  assert.equal(coverage.status, 'fail')
  assert.deepEqual(coverage.details.uncoveredTestModules, ['admin', 'hospital'])
})

test('doctor reports Java 23 and Gradle 7.5 as incompatible instead of healthy', async () => {
  const root = await multiModuleGradleProject('bth-doctor-toolchain-')
  initializeGit(root)
  await initProject(root)

  const result = await doctorProject(root, { javaRuntimeMajor: 23 })
  const compatibility = result.checks.find((entry) => entry.id === 'jvm-toolchain')

  assert.equal(result.healthy, false)
  assert.equal(compatibility.status, 'fail')
  assert.equal(compatibility.details.gradleVersion, '7.5')
  assert.equal(compatibility.details.javaRuntimeMajor, 23)
  assert.equal(compatibility.details.minimumGradleVersion, '8.10')
})

test('doctor enforces the official upper Gradle range for pre-Java-17 runtimes', async () => {
  const root = await multiModuleGradleProject('bth-doctor-toolchain-upper-')
  await writeFile(join(root, 'gradle/wrapper/gradle-wrapper.properties'), 'distributionUrl=https\\://services.gradle.org/distributions/gradle-9.0-bin.zip\n', 'utf8')
  initializeGit(root)
  await initProject(root)

  const result = await doctorProject(root, { javaRuntimeMajor: 11 })
  const compatibility = result.checks.find((entry) => entry.id === 'jvm-toolchain')

  assert.equal(result.healthy, false)
  assert.equal(compatibility.status, 'fail')
  assert.equal(compatibility.details.maximumGradleVersion, '8.14.x')
})

test('doctor confirms a Maven 3.9 wrapper on Java 8 from official runtime requirements', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-doctor-maven39-'))
  await mkdir(join(root, '.mvn/wrapper'), { recursive: true })
  await mkdir(join(root, 'src/test/java/example'), { recursive: true })
  await writeFile(join(root, 'pom.xml'), '<project></project>\n', 'utf8')
  await writeFile(join(root, 'src/test/java/example/AppTest.java'), 'class AppTest {}\n', 'utf8')
  await writeFile(join(root, '.mvn/wrapper/maven-wrapper.properties'), 'distributionUrl=https://repo.example/apache-maven-3.9.16-bin.zip\n', 'utf8')
  await writeExecutable(join(root, 'mvnw'))
  initializeGit(root)
  await initProject(root)

  const result = await doctorProject(root, { javaRuntimeMajor: 8 })
  const compatibility = result.checks.find((entry) => entry.id === 'jvm-toolchain')

  assert.equal(compatibility.status, 'pass')
  assert.equal(compatibility.details.minimumJavaVersion, 8)
})

test('doctor rejects a Maven 4 wrapper running below Java 17', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-doctor-maven4-'))
  await mkdir(join(root, '.mvn/wrapper'), { recursive: true })
  await mkdir(join(root, 'src/test/java/example'), { recursive: true })
  await writeFile(join(root, 'pom.xml'), '<project></project>\n', 'utf8')
  await writeFile(join(root, 'src/test/java/example/AppTest.java'), 'class AppTest {}\n', 'utf8')
  await writeFile(join(root, '.mvn/wrapper/maven-wrapper.properties'), 'distributionUrl=https://repo.example/apache-maven-4.0.0-rc-6-bin.zip\n', 'utf8')
  await writeExecutable(join(root, 'mvnw'))
  initializeGit(root)
  await initProject(root)

  const result = await doctorProject(root, { javaRuntimeMajor: 11 })
  const compatibility = result.checks.find((entry) => entry.id === 'jvm-toolchain')

  assert.equal(result.healthy, false)
  assert.equal(compatibility.status, 'fail')
  assert.equal(compatibility.details.minimumJavaVersion, 17)
})

test('JVM build discovery fails closed at its bounded build-file limit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-bounded-build-discovery-'))
  await writeFile(join(root, 'build.gradle.kts'), 'plugins { java }\n', 'utf8')
  await writeExecutable(join(root, 'gradlew'))
  for (let index = 0; index < 128; index += 1) {
    const module = 'module-' + String(index).padStart(3, '0')
    await mkdir(join(root, module), { recursive: true })
    await writeFile(join(root, module, 'build.gradle.kts'), 'plugins { java }\n', 'utf8')
  }

  const manifest = await scanProjectManifest(root)
  const result = await inspectJvmBuild(root, manifest, { inspectRuntime: false })

  assert.equal(result.status, 'conflict')
  assert.equal(result.candidateOverflowCount, 1)
  assert.equal(result.canGenerateVerification, false)
  assert.match(result.diagnostics.join('\n'), /additional build definitions remain uninspected/)
})

test('CLI names network execution as risk acknowledgement and states that egress is not isolated', () => {
  const result = spawnSync(process.execPath, ['src/cli.mjs', '--help'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8'
  })

  assert.equal(result.status, 0)
  assert.match(result.stdout, /--acknowledge-network-risk/)
  assert.match(result.stdout, /does not enforce operating-system egress isolation/i)
})
