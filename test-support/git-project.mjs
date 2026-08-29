import { spawnSync } from 'node:child_process'
import { chmod, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export function runGit(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'git failed')
  }
  return result.stdout.trim()
}

export function initializeGit(root) {
  runGit(root, ['init', '-q'])
  runGit(root, ['config', 'user.email', 'bth-test@example.invalid'])
  runGit(root, ['config', 'user.name', 'BTH Test'])
  runGit(root, ['add', '.'])
  runGit(root, ['commit', '-qm', 'fixture'])
}

export async function writeGradleFixture(root, options = {}) {
  const exitCode = options.exitCode ?? 0
  const tests = options.tests ?? 1
  const failures = options.failures ?? 0
  const errors = options.errors ?? 0
  const testCase = tests > 0
    ? '<testcase classname="example.VerificationTest" name="works">' +
      (failures ? '<failure message="failed"/>' : '') +
      (errors ? '<error message="errored"/>' : '') +
      '</testcase>'
    : ''
  await writeFile(join(root, 'build.gradle.kts'), 'plugins { java }\n', 'utf8')
  await writeFile(join(root, '.gitignore'), 'build/\ntarget/\n', 'utf8')
  await writeFile(
    join(root, 'gradlew'),
    '#!/bin/sh\n' +
    'mkdir -p build/test-results/test\n' +
    'printf \'%s\\n\' \'<testsuite tests="' + tests + '" failures="' + failures + '" errors="' + errors + '">' + testCase + '</testsuite>\' > build/test-results/test/TEST-fixture.xml\n' +
    'printf "synthetic output that must not be copied"\n' +
    'printf "synthetic error" >&2\n' +
    'exit ' + exitCode + '\n',
    'utf8'
  )
  await chmod(join(root, 'gradlew'), 0o755)
}
