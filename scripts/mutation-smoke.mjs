import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const mutations = [
  {
    file: 'src/evaluation/task-acceptance.mjs',
    from: "casesExecuted && errors === 0 && cases.some((entry) => entry.outcome === 'failed')",
    to: "casesExecuted && cases.some((entry) => ['failed', 'error'].includes(entry.outcome))",
    test: 'test/task-acceptance.test.mjs'
  },
  {
    file: 'src/core/jest-module-resolution.mjs',
    from: 'overrides.some(key => key in jest)',
    to: 'false',
    test: 'test/jest-module-resolution.test.mjs'
  },
  {
    file: 'src/evaluation/empty-test-baseline.mjs',
    from: '...jestModuleSearchArgs(detection, resolve(root, detection.projectPath)),',
    to: '',
    test: 'test/empty-test-baseline.test.mjs'
  },
  {
    file: 'src/core/execution-diagnostics.mjs',
    from: 'if (checked.get(accepted.path)) entries.push(accepted)',
    to: 'entries.push(accepted)',
    test: 'test/execution-diagnostics.test.mjs'
  },
  {
    file: 'src/core/implementation-verification.mjs',
    from: 'executionDiagnostics: compactExecutionDiagnostics(gate.executionDiagnostics),',
    to: 'executionDiagnostics: null,',
    test: 'test/implementation-verification.test.mjs'
  },
  {
    file: 'src/core/test-authoring-contract.mjs',
    from: 'if (text !== template.content)',
    to: 'if (false)',
    test: 'test/test-authoring-contract.test.mjs'
  },
  {
    file: 'src/core/test-authoring-contract.mjs',
    from: 'if (canonicalJson(expected) !== canonicalJson(verificationConfig))',
    to: 'if (false)',
    test: 'test/test-authoring-contract.test.mjs'
  },
  {
    file: 'src/core/lexical-retrieval.mjs',
    from: ".replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')",
    to: ".replace(/([A-Z]+)([A-Z][a-z])/g, '$1$2')",
    test: 'test/lexical-retrieval.test.mjs'
  },
  {
    file: 'src/core/lexical-retrieval.mjs',
    from: 'record.ownedIdentifiers?.has(term) ? 2 : 1',
    to: 'record.ownedIdentifiers?.has(term) ? 1 : 1',
    test: 'test/lexical-retrieval.test.mjs'
  },
  {
    file: 'src/core/implementation-verification.mjs',
    from: "structuredReason: code(gate.result?.reason ?? gate.structuredReason),",
    to: 'structuredReason: null,',
    test: 'test/implementation-verification.test.mjs'
  },
  {
    file: 'src/core/portable-project-index.mjs',
    from: 'roles: rolesFor(path, code),',
    to: "roles: [...rolesFor(path, code), ...(content.includes('/domain/') ? ['entity'] : [])],",
    test: 'test/portable-project-index.test.mjs'
  },
  {
    file: 'src/core/workspace-preparation.mjs',
    from: "'ci', '--offline', '--ignore-scripts'",
    to: "'ci', '--ignore-scripts'",
    test: 'test/workspace-preparation.test.mjs'
  },
  {
    file: 'src/evaluation/empty-test-baseline.mjs',
    from: 'if (!Array.isArray(files) || files.length !== 0)',
    to: 'if (!Array.isArray(files))',
    test: 'test/empty-test-baseline.test.mjs'
  },
  {
    file: 'src/runtime/implementation-orchestrator.mjs',
    from: 'selectedFeedbackGates.length > 0 && selectedFeedbackGates.length < verificationConfig.gates.length',
    to: 'selectedFeedbackGates.length > 0',
    test: 'test/work-first-test.test.mjs'
  },
  {
    file: 'src/core/jest-report.mjs',
    from: "if (!entry || !['passed', 'failed', 'pending', 'todo', 'disabled', 'skipped'].includes(entry.status)) fail('unknown assertion status')",
    to: "if (entry.status === 'focused') entry.status = 'passed'",
    test: 'test/jest-report.test.mjs'
  },
  {
    file: 'src/core/task-state.mjs',
    from: "if (!ALLOWED_TRANSITIONS[record.state].includes(to)) {",
    to: "if (false && !ALLOWED_TRANSITIONS[record.state].includes(to)) {",
    test: 'test/task-state.test.mjs'
  },
  {
    file: 'src/adapters/verification-tool.mjs',
    from: 'return result.exitCode === 0 && result.signal === null',
    to: 'return result.exitCode !== 0 && result.signal === null',
    test: 'test/generic-verification.test.mjs'
  },
  {
    file: 'src/core/work-draft.mjs',
    from: "status: blockers.length ? 'blocked' : questions.length ? 'needs-decisions' : 'ready-for-plan-review',",
    to: "status: 'ready-for-plan-review',",
    test: 'test/work-draft.test.mjs'
  },
  {
    file: 'src/core/junit.mjs',
    from: 'if (containsXmlDeclaration(text)) {',
    to: 'if (false) {',
    test: 'test/junit.test.mjs'
  },
  {
    file: 'src/core/junit.mjs',
    from: 'if (containsXmlDeclaration(text)) {',
    to: 'if (containsXmlDeclaration(text) || text.includes("<!DOCTYPE")) {',
    test: 'test/junit.test.mjs'
  },
  {
    file: 'src/core/retrieval-query.mjs',
    from: 'if (requirement) return requirement',
    to: 'if (false && requirement) return requirement',
    test: 'test/retrieval-query.test.mjs'
  },
  {
    file: 'src/core/migration-discovery.mjs',
    from: 'if (propertyDepth !== 0) return []',
    to: 'if (false) return []',
    test: 'test/migration-discovery.test.mjs'
  },
  {
    file: 'src/core/migration-discovery.mjs',
    from: "(recursive || posix.dirname(path) === directory + '/versions')",
    to: '(true)',
    test: 'test/migration-discovery.test.mjs'
  }
]

async function copyFixture(target) {
  await cp(join(root, 'src'), join(target, 'src'), { recursive: true })
  await cp(join(root, 'test'), join(target, 'test'), { recursive: true })
  await cp(join(root, 'test-support'), join(target, 'test-support'), { recursive: true })
  await cp(join(root, 'packs'), join(target, 'packs'), { recursive: true })
  await cp(join(root, 'package.json'), join(target, 'package.json'))
  await symlink(join(root, 'node_modules'), join(target, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
}

function runTests(target, test) {
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', test], {
    cwd: target, encoding: 'utf8', timeout: 120_000, windowsHide: true
  })
  if (result.error) throw result.error
  const tests = Number(result.stdout.match(/^# tests (\d+)$/m)?.[1] ?? 0)
  const passed = Number(result.stdout.match(/^# pass (\d+)$/m)?.[1] ?? 0)
  const skipped = Number(result.stdout.match(/^# skipped (\d+)$/m)?.[1] ?? 0)
  const failures = Number(result.stdout.match(/^# fail (\d+)$/m)?.[1] ?? 0)
  return { ...result, tests, passed, skipped, failures }
}

const workspace = await mkdtemp(join(tmpdir(), 'bth-mutation-'))
try {
  for (const [index, mutation] of mutations.entries()) {
    const target = join(workspace, String(index))
    await copyFixture(target)
    const sourcePath = join(target, mutation.file)
    const source = await readFile(sourcePath, 'utf8')
    const occurrences = source.split(mutation.from).length - 1
    if (occurrences !== 1) throw new Error('Mutation anchor must occur exactly once: ' + mutation.file)
    const baseline = runTests(target, mutation.test)
    if (baseline.status !== 0 || baseline.signal || baseline.passed < 1 || baseline.failures !== 0) {
      throw new Error('Unmutated fixture must pass before mutation: ' + mutation.test + '\n' + (baseline.stderr || baseline.stdout).slice(-4096))
    }
    await writeFile(sourcePath, source.replace(mutation.from, mutation.to), 'utf8')
    const result = runTests(target, mutation.test)
    if (result.status === 0) {
      throw new Error('Mutation survived: ' + mutation.file + ' against ' + mutation.test)
    }
    if (result.status !== 1 || result.signal || result.tests !== baseline.tests || result.skipped !== baseline.skipped || result.failures < 1 || !/code: ['"]ERR_ASSERTION['"]/.test(result.stdout)) {
      throw new Error('Mutation result is inconclusive (not an executed assertion failure): ' + mutation.file)
    }
    console.log('KILLED ' + mutation.file + ' by ' + mutation.test + ' (baseline ' + baseline.passed + ' passed; mutant ' + result.failures + ' failed tests with assertion evidence)')
  }
} finally {
  await rm(workspace, { recursive: true, force: true })
}
