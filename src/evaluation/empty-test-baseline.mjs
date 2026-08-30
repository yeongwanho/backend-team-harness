import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { canonicalJson } from '../core/canonical-json.mjs'
import { scanProjectManifest } from '../core/project-manifest.mjs'
import { inspectPortableTestBuild, portableVerificationConfig, portableVerificationTemplates } from '../core/portable-test-discovery.mjs'
import { buildSafeEnvironment, runProcess } from '../core/process-runner.mjs'
import { loadVerificationConfig, parseVerificationConfig } from '../config/verification.mjs'
import { loadImplementationConfig } from '../config/implementation.mjs'
import { captureConfiguredSourceBinding } from '../runtime/backend-harness.mjs'
import { resolveSafeProjectPath, statPath } from '../fs-safety.mjs'
import { jestModuleSearchArgs } from '../core/jest-module-resolution.mjs'

export function canAttemptBaseline(preflight) {
  return preflight?.confirmed === true || (preflight?.emptyTestBaseline?.status === 'no-tests-discovered' &&
    preflight.emptyTestBaseline.sourceStable === true && preflight.emptyTestBaseline.discoveredFiles === 0 &&
    preflight.emptyTestBaseline.requiredFinalMinimumTests >= 1)
}

// This permits trying to CREATE the first tests, not claiming an empty baseline
// passed. Candidate verification and independent acceptance remain mandatory.
export async function inspectEmptyTestBaseline(root, checked, options = {}) {
  const unconfirmed = { status: 'unconfirmed', discoveredFiles: null, sourceStable: null }
  if (checked?.confirmed || !checked?.result?.tests ||
      ['tests', 'executed', 'failures', 'errors', 'skipped'].some(key => checked.result.tests[key] !== 0)) return unconfirmed
  try {
    const manifest = await scanProjectManifest(root, { maxDepth: 12, maxEntries: 100000, onLimit: 'throw', onReadError: 'throw' })
    const detection = await inspectPortableTestBuild(root, manifest)
    if (!detection.canGenerateVerification || detection.framework !== 'jest') return unconfirmed
    const preparation = (await loadImplementationConfig(root)).config.workspacePreparation
    if (preparation?.kind !== 'npm-ci-offline' || preparation.projectPath !== detection.projectPath) return unconfirmed
    const loaded = await loadVerificationConfig(root, { allowInferred: false })
    const expected = parseVerificationConfig(JSON.stringify(portableVerificationConfig(detection)))
    if (canonicalJson(loaded.config) !== canonicalJson(expected)) return unconfirmed
    for (const template of portableVerificationTemplates(detection)) {
      const path = await resolveSafeProjectPath(root, template.path)
      const metadata = await statPath(path)
      if (!metadata?.isFile() || metadata.size > 65536 || await readFile(path, 'utf8') !== template.content) return unconfirmed
    }
    const entryPath = (detection.projectPath === '.' ? '' : detection.projectPath + '/') + 'node_modules/jest/bin/jest.js'
    const entry = await resolveSafeProjectPath(root, entryPath)
    if (!(await statPath(entry))?.isFile()) return unconfirmed
    const before = await captureConfiguredSourceBinding(root)
    const execution = await (options.processRunner ?? runProcess)({
      program: process.execPath, args: [entry, ...detection.testArgs, ...jestModuleSearchArgs(detection, resolve(root, detection.projectPath)), '--runInBand', '--listTests', '--json', '--no-cache'],
      cwd: resolve(root, detection.projectPath), timeoutMs: 30000, tailBytes: 65536, env: buildSafeEnvironment()
    })
    const after = await captureConfiguredSourceBinding(root)
    const sourceStable = before.fingerprint === after.fingerprint
    const executionEvidence = {
      exitCode: execution.exitCode, signal: execution.signal, timedOut: execution.timedOut,
      stdioDrainTimedOut: execution.stdioDrainTimedOut, durationMs: execution.durationMs,
      stdout: { sha256: execution.stdout.sha256, bytes: execution.stdout.bytes },
      stderr: { sha256: execution.stderr.sha256, bytes: execution.stderr.bytes }
    }
    if (!sourceStable || execution.exitCode !== 0 || execution.signal || execution.timedOut || execution.stdioDrainTimedOut ||
        execution.stdout.bytes > 65536 || Buffer.byteLength(execution.stdout.tail) !== execution.stdout.bytes) return { ...unconfirmed, sourceStable, process: executionEvidence }
    let files
    try { files = JSON.parse(execution.stdout.tail) } catch { return { ...unconfirmed, sourceStable, process: executionEvidence } }
    if (!Array.isArray(files) || files.length !== 0) return { ...unconfirmed, sourceStable, process: executionEvidence, discoveredFiles: Array.isArray(files) ? files.length : null }
    return {
      status: 'no-tests-discovered', framework: 'jest', projectPath: detection.projectPath,
      sourceStable, sourceFingerprint: before.fingerprint, process: executionEvidence, discoveredFiles: 0,
      requiredFinalMinimumTests: expected.gates[0].result.minimumTests,
      baselinePassed: false, requirement: 'Create executable focused tests; all final required gates and independent task acceptance must pass.'
    }
  } catch { return unconfirmed }
}
