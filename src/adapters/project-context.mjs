import { isAbsolute, relative, sep } from 'node:path'
import { doctorProject } from '../doctor.mjs'
import { defaultVerificationConfig, loadVerificationConfig, parseVerificationConfig, verificationExecutablePaths, verificationInputPaths } from '../config/verification.mjs'
import { loadQualityGates } from '../config/quality-gates.mjs'
import { captureSourceBinding } from '../core/source-binding.mjs'
import { JVM_BUILD_DISCOVERY } from '../core/jvm-build-discovery.mjs'
import { PROJECT_MANIFEST, scanProjectManifest } from '../core/project-manifest.mjs'
import { resolveReadableRoot } from '../fs-safety.mjs'

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

export async function captureProjectContextSourceBinding(inputPath, verification = undefined) {
  const loaded = verification ?? await loadVerificationConfig(inputPath, { allowInferred: false })
  return captureSourceBinding(inputPath, {
    explicitPaths: verificationInputPaths(loaded.config),
    allowSymlinkPaths: verificationExecutablePaths(loaded.config)
  })
}

export async function inspectProjectContext(inputPath, options = {}) {
  const root = await resolveReadableRoot(inputPath)
  const manifest = options.manifest ?? (options.doctor ? null : await scanProjectManifest(root, options.manifestOptions))
  const doctorOptions = { manifest, processRunner: options.processRunner }
  if (Object.hasOwn(options, 'javaRuntimeMajor')) doctorOptions.javaRuntimeMajor = options.javaRuntimeMajor
  const doctor = options.doctor ?? await doctorProject(root, doctorOptions)
  let verification = options.verification
  let verificationStatus = 'configured'
  const verificationDiagnostics = []
  if (!verification) {
    try {
      verification = await loadVerificationConfig(root, { allowInferred: false })
    } catch (error) {
      verificationStatus = 'missing'
      verificationDiagnostics.push(error instanceof Error ? error.message : String(error))
      const inferred = await defaultVerificationConfig(root, manifest ? {
        manifest,
        detection: doctor[JVM_BUILD_DISCOVERY]
      } : {})
      if (inferred) {
        verification = {
          source: 'inferred-jvm-default',
          config: parseVerificationConfig(JSON.stringify(inferred), 'inferred-jvm-default')
        }
      } else {
        verification = {
          source: null,
          config: {
            schemaVersion: 1,
            context: { profile: null, databaseDialect: null },
            scheduling: { strategy: 'configured', minimumObservations: 5, priorFailures: 1, priorPasses: 1, maxParallel: 1 },
            gates: []
          }
        }
      }
    }
  }
  const policies = options.policies ?? await loadQualityGates(doctor.root)
  const inferredInputs = verification.config.gates.length > 0 ? verificationInputPaths(verification.config) : []
  const sourceBinding = options.sourceBinding ?? await captureSourceBinding(root, {
    explicitPaths: verificationStatus === 'configured'
      ? inferredInputs
      : [],
    allowSymlinkPaths: verificationStatus === 'configured' && verification.config.gates.length > 0 ? verificationExecutablePaths(verification.config) : []
  })
  const build = checkById(doctor, 'build-file')
  const wrapper = checkById(doctor, 'build-wrapper')
  const main = checkById(doctor, 'main-source')
  const tests = checkById(doctor, 'test-source')
  const flyway = checkById(doctor, 'flyway')
  const contract = checkById(doctor, 'shared-contract')
  const quality = checkById(doctor, 'quality-gate-schema')
  const verificationCheck = checkById(doctor, 'verification-config')
  const verificationSource = verificationStatus === 'configured' && verification.source
    ? portable(isAbsolute(verification.source) ? relative(doctor.root, verification.source) : verification.source)
    : null

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

  const result = {
    schemaVersion: 1,
    sourceBinding,
    structuralReadiness: doctor.healthy,
    facts,
    verification: {
      status: verificationStatus,
      path: verificationSource,
      inferredFromSource: verificationStatus === 'missing' && verification.source === 'inferred-jvm-default',
      diagnostics: verificationDiagnostics,
      context: verification.config.context,
      gates: verification.config.gates.map((gate) => ({
        id: gate.id,
        required: gate.required,
        network: gate.network,
        resultType: gate.result.type,
        minimumTests: gate.result.minimumTests ?? null
      }))
    },
    policyGates: policies.gates.map((gate) => ({
      name: gate.name,
      required: gate.required,
      checks: [...gate.checks],
      file: gate.file
    })),
    policyDiagnostics: [...policies.diagnostics],
    policyPaths: [
      '.backend-harness/project.md',
      '.backend-harness/architecture.md',
      '.backend-harness/glossary.md',
      '.backend-harness/quality-gates/',
      verificationSource
    ].filter(Boolean)
  }
  if (manifest) {
    Object.defineProperty(result, PROJECT_MANIFEST, { value: manifest })
  }
  return result
}
