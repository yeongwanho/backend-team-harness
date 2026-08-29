import { isAbsolute, relative, sep } from 'node:path'
import { doctorProject } from '../doctor.mjs'
import { loadVerificationConfig, verificationInputPaths } from '../config/verification.mjs'
import { captureSourceBinding } from '../core/source-binding.mjs'

function portable(path) {
  return path.split(sep).join('/')
}

function fact(id, status, summary, evidence) {
  return { id, status, summary, evidence }
}

function factStatus(check) {
  if (check.status === 'pass') {
    return 'confirmed'
  }
  if (check.status === 'fail') {
    return 'conflict'
  }
  return 'unknown'
}

function checkById(doctor, id) {
  return doctor.checks.find((entry) => entry.id === id)
}

export async function inspectProjectContext(inputPath, options = {}) {
  const doctor = options.doctor ?? await doctorProject(inputPath)
  const verification = options.verification ?? await loadVerificationConfig(inputPath, { allowInferred: false })
  const sourceBinding = options.sourceBinding ?? await captureSourceBinding(inputPath, {
    explicitPaths: verificationInputPaths(verification.config),
    allowSymlinkPaths: verification.config.gates.map((gate) => gate.command[0])
  })
  const build = checkById(doctor, 'build-file')
  const wrapper = checkById(doctor, 'build-wrapper')
  const main = checkById(doctor, 'main-source')
  const tests = checkById(doctor, 'test-source')
  const flyway = checkById(doctor, 'flyway')
  const contract = checkById(doctor, 'shared-contract')
  const quality = checkById(doctor, 'quality-gate-schema')
  const verificationCheck = checkById(doctor, 'verification-config')
  const verificationSource = verification.source
    ? portable(isAbsolute(verification.source) ? relative(doctor.root, verification.source) : verification.source)
    : '.backend-harness/verification.json'

  const facts = [
    fact('git.source', 'confirmed', 'The interview is bound to one Git source fingerprint.', {
      fingerprint: sourceBinding.fingerprint,
      headCommit: sourceBinding.headCommit,
      clean: sourceBinding.clean,
      changedEntryCount: sourceBinding.changedEntryCount
    }),
    fact('build.definition', factStatus(build), build.message, {
      valid: build.details?.valid ?? [],
      invalid: build.details?.invalid ?? [],
      truncated: build.details?.truncated === true
    }),
    fact('build.wrapper', factStatus(wrapper), wrapper.message, {
      files: wrapper.details?.files ?? []
    }),
    fact('source.production', factStatus(main), main.message, {
      count: main.details?.count ?? 0,
      truncated: main.details?.truncated === true
    }),
    fact('source.tests', factStatus(tests), tests.message, {
      count: tests.details?.count ?? 0,
      truncated: tests.details?.truncated === true
    }),
    fact('database.flyway', factStatus(flyway), flyway.message, {
      files: flyway.details?.files ?? [],
      invalid: flyway.details?.invalid ?? [],
      duplicates: flyway.details?.duplicates ?? [],
      truncated: flyway.details?.truncated === true
    }),
    fact('contract.shared', factStatus(contract), contract.message, {
      missing: contract.details?.missing ?? []
    }),
    fact('policy.quality-gates', factStatus(quality), quality.message, {
      path: '.backend-harness/quality-gates/'
    }),
    fact('verification.contract', factStatus(verificationCheck), verificationCheck.message, {
      path: verificationSource,
      gateIds: verification.config.gates.map((gate) => gate.id)
    })
  ]

  return {
    schemaVersion: 1,
    sourceBinding,
    structuralReadiness: doctor.healthy,
    facts,
    verification: {
      path: verificationSource,
      context: verification.config.context,
      gates: verification.config.gates.map((gate) => ({
        id: gate.id,
        required: gate.required,
        network: gate.network,
        resultType: gate.result.type,
        minimumTests: gate.result.minimumTests ?? null
      }))
    },
    policyPaths: [
      '.backend-harness/project.md',
      '.backend-harness/architecture.md',
      '.backend-harness/glossary.md',
      '.backend-harness/quality-gates/',
      verificationSource
    ]
  }
}
