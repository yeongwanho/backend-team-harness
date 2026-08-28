import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { resolve } from 'node:path'

async function exists(root, path) {
  try {
    await access(resolve(root, path), constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function anyExists(root, candidates) {
  const values = await Promise.all(candidates.map((path) => exists(root, path)))
  return values.some(Boolean)
}

export async function doctorProject(inputPath = '.') {
  const root = resolve(inputPath)
  const checks = []

  const hasBuild = await anyExists(root, ['build.gradle', 'build.gradle.kts', 'pom.xml'])
  checks.push({
    id: 'build-file',
    status: hasBuild ? 'pass' : 'fail',
    message: hasBuild ? 'Build definition detected.' : 'No Gradle or Maven build definition found.'
  })

  const hasWrapper = await anyExists(root, ['gradlew', 'gradlew.bat', 'mvnw', 'mvnw.cmd'])
  checks.push({
    id: 'build-wrapper',
    status: hasWrapper ? 'pass' : 'warn',
    message: hasWrapper ? 'Build wrapper detected.' : 'No build wrapper found; reproducibility may depend on a global tool.'
  })

  const hasMainJava = await exists(root, 'src/main/java')
  checks.push({
    id: 'main-source',
    status: hasMainJava ? 'pass' : 'warn',
    message: hasMainJava ? 'Java production sources detected.' : 'No conventional src/main/java directory found.'
  })

  const hasTests = await exists(root, 'src/test/java')
  checks.push({
    id: 'test-source',
    status: hasTests ? 'pass' : 'warn',
    message: hasTests ? 'Java test sources detected.' : 'No conventional src/test/java directory found.'
  })

  const hasMigrations = await exists(root, 'src/main/resources/db/migration')
  checks.push({
    id: 'flyway',
    status: hasMigrations ? 'pass' : 'warn',
    message: hasMigrations ? 'Conventional Flyway migration directory detected.' : 'No conventional Flyway directory found.'
  })

  const harnessFiles = [
    '.backend-harness/project.md',
    '.backend-harness/architecture.md',
    '.backend-harness/policies',
    '.backend-harness/workflows',
    '.backend-harness/quality-gates'
  ]
  const harnessValues = await Promise.all(harnessFiles.map((path) => exists(root, path)))
  const missingHarness = harnessFiles.filter((_, index) => !harnessValues[index])
  checks.push({
    id: 'shared-contract',
    status: missingHarness.length === 0 ? 'pass' : 'fail',
    message: missingHarness.length === 0
      ? 'Shared backend harness contract detected.'
      : 'Missing shared harness paths: ' + missingHarness.join(', ')
  })

  return {
    root,
    healthy: checks.every((check) => check.status !== 'fail'),
    checks
  }
}

