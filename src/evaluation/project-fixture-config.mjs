import { posix } from 'node:path'
import { parseVerificationConfig } from '../config/verification.mjs'
import { parseImplementationConfig } from '../config/implementation.mjs'

const HASH = /^[a-f0-9]{64}$/
function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Project fixture fields must be objects.')
}
function keys(value, allowed) {
  object(value)
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Unknown project fixture key.')
}
function path(value) {
  if (typeof value !== 'string' || !value || value.length > 512 || /[\\:\x00-\x1f*?\[\]]/.test(value) || value.startsWith('/') ||
    value.split('/').some(part => !part || part === '.' || part === '..' || ['.git', 'node_modules', '.venv'].includes(part) || part.startsWith('.env'))) throw new Error('Project fixture path must be a safe exact relative path.')
  return posix.normalize(value)
}

export function parseProjectFixture(value) {
  if (value === undefined || value === null) return null
  keys(value, ['files', 'verification', 'workspacePreparation'])
  if (!Array.isArray(value.files) || !value.files.length || value.files.length > 16) throw new Error('Project fixture requires 1-16 files.')
  const files = value.files.map(entry => {
    keys(entry, ['path', 'fixture', 'sha256', 'expectedSha256', 'executable'])
    const target = path(entry.path), fixture = path(entry.fixture)
    const gitContract = target === '.backend-harness/.gitattributes'
    if (!(gitContract || target.startsWith('.backend-harness/bin/') || /(^|\/)(?:test|tests|__tests__)\//.test(target)) ||
      (target.includes('.backend-harness/') && !gitContract && !target.startsWith('.backend-harness/bin/'))) throw new Error('Project fixture files must be test-only, harness verification wrappers or their Git byte contract.')
    if (!fixture.startsWith('fixtures/')) throw new Error('Project fixture source must be inside the fixtures directory.')
    if (!HASH.test(entry.sha256 ?? '') || !Object.hasOwn(entry, 'expectedSha256') ||
      (entry.expectedSha256 !== null && !HASH.test(entry.expectedSha256 ?? ''))) throw new Error('Project fixture hashes and explicit preimages are required.')
    if (entry.executable !== undefined && typeof entry.executable !== 'boolean') throw new Error('Project fixture executable flag must be boolean.')
    return { path: target, fixture, sha256: entry.sha256, expectedSha256: entry.expectedSha256, executable: entry.executable ?? false }
  })
  const paths = files.map(file => file.path)
  if (new Set(paths).size !== files.length || paths.some(a => paths.some(b => a !== b && a.startsWith(b + '/')))) throw new Error('Project fixture paths must not overlap.')
  const verification = parseVerificationConfig(JSON.stringify(value.verification), 'project-fixture.verification')
  // The verification fingerprint already includes each gate executable. Keep
  // exact generated contracts valid without adding redundant input entries.
  const inputs = new Set(verification.gates.flatMap(gate => [gate.command[0], ...gate.inputs]).map(path => path.replace(/^\.\//, '')))
  if (paths.some(path => !inputs.has(path))) throw new Error('Every project fixture must be protected by declared verification inputs.')
  if (verification.gates.some(gate => !paths.includes(gate.command[0].replace(/^\.\//, '')))) throw new Error('Every project fixture gate command must be a pinned wrapper.')
  const workspacePreparation = parseImplementationConfig(JSON.stringify({ schemaVersion: 2, adapter: null,
    workspacePreparation: value.workspacePreparation ?? null })).workspacePreparation
  return { files, verification, workspacePreparation }
}
