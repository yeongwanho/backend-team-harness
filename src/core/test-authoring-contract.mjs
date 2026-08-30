import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { canonicalJson } from './canonical-json.mjs'
import { inspectPortableTestBuild, portableVerificationConfig, portableVerificationTemplates } from './portable-test-discovery.mjs'
import { parseVerificationConfig, verificationInputPaths } from '../config/verification.mjs'
import { resolveSafeProjectPath, statPath } from '../fs-safety.mjs'
import { redactString } from './redaction.mjs'

const hash = value => createHash('sha256').update(value).digest('hex')
const unknown = reason => ({ status: 'unknown', authority: 'source-bound-test-authoring-guidance', reason })
const fields = ['rootDir', 'roots', 'testMatch', 'testRegex', 'testPathIgnorePatterns', 'moduleFileExtensions']

async function boundedRead(root, path, limit) {
  const absolute = await resolveSafeProjectPath(root, path)
  const metadata = await statPath(absolute)
  if (!metadata?.isFile() || metadata.isSymbolicLink() || metadata.size > limit) return null
  const text = await readFile(absolute, 'utf8')
  return Buffer.byteLength(text) <= limit ? text : null
}

function safeString(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 512 &&
    !/[\x00-\x1f\x7f]/.test(value) && redactString(value).count === 0
}

function relativeScope(value) {
  const path = value.replace(/^<rootDir>(?:\/|$)/, '').replaceAll('\\', '/')
  return !path.startsWith('/') && !path.includes(':') && !path.split('/').includes('..') &&
    !path.includes('<') && !path.includes('>')
}

function discoveryFields(jest) {
  if (!jest || typeof jest !== 'object' || Array.isArray(jest) || 'preset' in jest || 'projects' in jest) return null
  const result = {}
  for (const key of fields) {
    if (!(key in jest)) continue
    const value = jest[key]
    const values = Array.isArray(value) ? value : [value]
    if (values.length > 16 || !values.every(safeString)) return null
    if (['roots', 'testMatch', 'testPathIgnorePatterns', 'moduleFileExtensions'].includes(key) && !Array.isArray(value)) return null
    if (key === 'rootDir' && (Array.isArray(value) || value.includes('<rootDir>'))) return null
    if (['rootDir', 'roots'].includes(key) && !values.every(relativeScope)) return null
    result[key] = value
  }
  return Object.keys(result).length ? result : null
}

// Advisory only. Never execute a config, run discovery, change test selection,
// or walk the repository to explain where the existing gate expects tests.
export async function inspectTestAuthoringContract(root, verificationConfig) {
  try {
    const inputs = verificationInputPaths(verificationConfig)
    const detection = await inspectPortableTestBuild(root, { files: inputs })
    if (!detection.canGenerateVerification || detection.framework !== 'jest') return unknown('unrecognized-test-gate')
    // Additional flags can select another config, root, project or suite. Do
    // not incorrectly attribute the inline package defaults to those commands.
    if (detection.testArgs.length) return unknown('non-default-jest-command')
    const expected = parseVerificationConfig(JSON.stringify(portableVerificationConfig(detection)))
    if (canonicalJson(expected) !== canonicalJson(verificationConfig)) return unknown('custom-verification-gate')
    const runnerSources = []
    for (const template of portableVerificationTemplates(detection)) {
      const text = await boundedRead(root, template.path, 65536)
      if (text !== template.content) return unknown('generated-runner-mismatch')
      runnerSources.push({ path: template.path, sha256: hash(text) })
    }
    const manifest = (detection.projectPath === '.' ? '' : detection.projectPath + '/') + 'package.json'
    const text = await boundedRead(root, manifest, 1024 * 1024)
    if (text === null) return unknown('unreadable-test-metadata')
    const declaredDiscovery = discoveryFields(JSON.parse(text).jest)
    if (!declaredDiscovery) return unknown('inline-discovery-not-resolved')
    return {
      status: 'observed', authority: 'source-bound-test-authoring-guidance',
      gateId: expected.gates[0].id, framework: 'jest', projectPath: detection.projectPath,
      source: { path: manifest, sha256: hash(text), selector: 'jest' },
      verificationSha256: hash(canonicalJson(verificationConfig)), runnerSources, declaredDiscovery,
      guidance: 'Author focused tests inside this gate’s declared discovery scope, relative to projectPath. An adjacent test may belong to a different suite such as test:e2e; that script is not selected by this gate. Unlisted settings are not inferred defaults. Do not weaken or change the gate to make tests count; unknown configuration requires inspection. Only actual final test execution proves coverage.'
    }
  } catch {
    return unknown('test-metadata-unavailable')
  }
}
