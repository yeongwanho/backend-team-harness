import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initProject } from '../src/init-project.mjs'
import { checkProject } from '../src/runtime/backend-harness.mjs'
import { initializeGit } from '../test-support/git-project.mjs'

const enabled = process.env.BTH_REAL_JVM_E2E === '1'

function commandAvailable(command) {
  return spawnSync(command, ['-version'], { encoding: 'utf8' }).status === 0
}

async function writeJavaTest(root) {
  const directory = join(root, 'src/test/java/example')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'RealHarnessTest.java'), [
    'package example;',
    'import org.junit.jupiter.api.Test;',
    'import static org.junit.jupiter.api.Assertions.assertEquals;',
    'class RealHarnessTest {',
    '  @Test void executesThroughTheRealBuildTool() { assertEquals(4, 2 + 2); }',
    '}',
    ''
  ].join('\n'), 'utf8')
  await writeFile(join(root, '.gitignore'), 'build/\ntarget/\n.gradle/\n', 'utf8')
}

test('real Maven and Gradle projects produce accepted JUnit verification', { skip: !enabled }, async (t) => {
  await t.test('Maven verify includes a real JUnit execution', { skip: !commandAvailable('mvn') }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'bth-real-maven-'))
    await writeJavaTest(root)
    await writeFile(join(root, 'pom.xml'), [
      '<project xmlns="http://maven.apache.org/POM/4.0.0">',
      '  <modelVersion>4.0.0</modelVersion>',
      '  <groupId>example</groupId><artifactId>bth-real-maven</artifactId><version>1</version>',
      '  <properties><maven.compiler.source>11</maven.compiler.source><maven.compiler.target>11</maven.compiler.target><project.build.sourceEncoding>UTF-8</project.build.sourceEncoding></properties>',
      '  <dependencies><dependency><groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter</artifactId><version>5.8.2</version><scope>test</scope></dependency></dependencies>',
      '  <build><plugins><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-surefire-plugin</artifactId><version>2.22.2</version></plugin></plugins></build>',
      '</project>',
      ''
    ].join('\n'), 'utf8')
    await writeFile(join(root, 'mvnw'), '#!/bin/sh\nexec mvn "$@"\n', 'utf8')
    await chmod(join(root, 'mvnw'), 0o755)
    const warmed = spawnSync('mvn', ['-B', 'verify'], { cwd: root, encoding: 'utf8' })
    assert.equal(warmed.status, 0, warmed.stderr || warmed.stdout)
    initializeGit(root)
    await initProject(root)

    const result = await checkProject(root)

    assert.equal(result.confirmed, true, JSON.stringify(result.result, null, 2))
    assert.equal(result.result.tests.tests, 1)
    assert.deepEqual(result.result.gates[0].command.slice(-3), ['-o', '-B', 'verify'])
  })

  await t.test('Gradle test includes a real JUnit execution', { skip: !commandAvailable('gradle') }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'bth-real-gradle-'))
    await writeJavaTest(root)
    await writeFile(join(root, 'settings.gradle'), 'rootProject.name = "bth-real-gradle"\n', 'utf8')
    await writeFile(join(root, 'build.gradle'), [
      'plugins { id "java" }',
      'repositories { mavenCentral() }',
      'dependencies { testImplementation "org.junit.jupiter:junit-jupiter:5.8.2" }',
      'test { useJUnitPlatform() }',
      ''
    ].join('\n'), 'utf8')
    await writeFile(join(root, 'gradlew'), '#!/bin/sh\nexec gradle "$@"\n', 'utf8')
    await chmod(join(root, 'gradlew'), 0o755)
    const warmed = spawnSync('gradle', ['test', '--no-daemon', '--console=plain'], { cwd: root, encoding: 'utf8' })
    assert.equal(warmed.status, 0, warmed.stderr || warmed.stdout)
    initializeGit(root)
    await initProject(root)

    const result = await checkProject(root)

    assert.equal(result.confirmed, true, JSON.stringify(result.result, null, 2))
    assert.equal(result.result.tests.tests, 1)
    assert.ok(result.result.gates[0].command.includes('--rerun-tasks'))
  })
})
