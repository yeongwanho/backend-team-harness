import { statPath } from '../fs-safety.mjs'
import { resolve } from 'node:path'

const PACKS = Object.freeze({
  'secrets-gitleaks': Object.freeze({
    id: 'secrets-gitleaks',
    title: 'Gitleaks secret scan',
    evidenceTier: 'REPORTED',
    purpose: 'Run a redacted working-tree secret scan and convert findings to the BTH findings contract.',
    files: ['README.md', 'run', 'run.mjs'],
    gate: {
      id: 'secrets',
      required: true,
      command: ['./.backend-harness/packs/secrets-gitleaks/run'],
      inputs: ['./.backend-harness/packs/secrets-gitleaks/run.mjs'],
      timeoutMs: 120000,
      result: {
        type: 'findings',
        reports: ['.backend-harness/generated/packs/secrets-gitleaks/findings.json'],
        blockingSeverities: ['high', 'critical']
      }
    }
  }),
  'db-integration': Object.freeze({
    id: 'db-integration',
    title: 'Production-dialect DB integration tests',
    evidenceTier: 'EXECUTED',
    purpose: 'Connect a project-owned Testcontainers or Compose lifecycle to required integration-test evidence.',
    files: ['README.md'],
    gate: 'build-specific'
  }),
  architecture: Object.freeze({
    id: 'architecture',
    title: 'Executable architecture rules',
    evidenceTier: 'EXECUTED',
    purpose: 'Run project-owned ArchUnit or Spring Modulith rules as ordinary JUnit tests.',
    files: ['README.md', 'gradle-kotlin-dsl.snippet.gradle.kts', 'gradle-groovy-dsl.snippet.gradle'],
    gate: 'build-specific'
  }),
  contract: Object.freeze({
    id: 'contract',
    title: 'API and message contract tests',
    evidenceTier: 'EXECUTED',
    purpose: 'Run project-owned Pact, Spring Cloud Contract, or OpenAPI compatibility tests.',
    files: ['README.md'],
    gate: 'build-specific'
  }),
  'codegraph-advisory': Object.freeze({
    id: 'codegraph-advisory',
    title: 'Advisory Java/Kotlin import graph',
    evidenceTier: 'REPORTED',
    purpose: 'Create a generation-stamped import graph with explicit provenance; it never changes PASS.',
    files: ['README.md', 'run', 'run.mjs'],
    gate: {
      id: 'codegraph',
      required: false,
      command: ['./.backend-harness/packs/codegraph-advisory/run'],
      inputs: ['./.backend-harness/packs/codegraph-advisory/run.mjs'],
      timeoutMs: 120000,
      result: {
        type: 'observation',
        reports: ['.backend-harness/generated/packs/codegraph-advisory/graph.json']
      }
    }
  })
})

export function listPacks() {
  return Object.values(PACKS).map(({ files: _files, gate: _gate, ...pack }) => pack)
}

export function getPack(id) {
  return Object.hasOwn(PACKS, id) ? PACKS[id] : null
}

async function buildKind(root) {
  if (await statPath(resolve(root, 'build.gradle')) || await statPath(resolve(root, 'build.gradle.kts'))) {
    return 'gradle'
  }
  if (await statPath(resolve(root, 'pom.xml'))) {
    return 'maven'
  }
  throw new Error('This pack needs a recognizable Gradle or Maven project.')
}

export async function gateForPack(pack, root) {
  if (pack.gate !== 'build-specific') {
    return structuredClone(pack.gate)
  }
  const build = await buildKind(root)
  const windows = process.platform === 'win32'
  if (pack.id === 'db-integration') {
    return build === 'gradle' ? {
      id: 'db-integration', required: true, network: true,
      command: [windows ? './gradlew.bat' : './gradlew', 'integrationTest', '--no-daemon', '--console=plain', '--rerun-tasks'],
      inputs: [], timeoutMs: 900000,
      result: { type: 'junit', reports: ['build/test-results/integrationTest/**/*.xml'], minimumTests: 1 }
    } : {
      id: 'db-integration', required: true, network: true,
      command: [windows ? './mvnw.cmd' : './mvnw', '-B', '-Pdb-integration', '-Dfailsafe.reportsDirectory=target/bth-reports/db-integration', 'verify'],
      inputs: [], timeoutMs: 900000,
      result: { type: 'junit', reports: ['target/bth-reports/db-integration/TEST-*.xml'], minimumTests: 1 }
    }
  }
  if (pack.id === 'architecture') {
    return build === 'gradle' ? {
      id: 'architecture', required: true,
      command: [windows ? './gradlew.bat' : './gradlew', 'architectureTest', '--offline', '--no-daemon', '--console=plain', '--rerun-tasks'],
      inputs: [], timeoutMs: 600000,
      result: { type: 'junit', reports: ['build/test-results/architectureTest/**/*.xml'], minimumTests: 1 }
    } : {
      id: 'architecture', required: true,
      command: [windows ? './mvnw.cmd' : './mvnw', '-o', '-B', '-Dtest=*ArchitectureTest', '-Dsurefire.reportsDirectory=target/bth-reports/architecture', 'test'],
      inputs: [], timeoutMs: 600000,
      result: { type: 'junit', reports: ['target/bth-reports/architecture/TEST-*.xml'], minimumTests: 1 }
    }
  }
  return build === 'gradle' ? {
    id: 'contract', required: true,
    command: [windows ? './gradlew.bat' : './gradlew', 'contractTest', '--offline', '--no-daemon', '--console=plain', '--rerun-tasks'],
    inputs: [], timeoutMs: 900000,
    result: { type: 'junit', reports: ['build/test-results/contractTest/**/*.xml'], minimumTests: 1 }
  } : {
    id: 'contract', required: true,
    command: [windows ? './mvnw.cmd' : './mvnw', '-o', '-B', '-Pcontract-test', '-Dfailsafe.reportsDirectory=target/bth-reports/contract', 'verify'],
    inputs: [], timeoutMs: 900000,
    result: { type: 'junit', reports: ['target/bth-reports/contract/TEST-*.xml'], minimumTests: 1 }
  }
}
