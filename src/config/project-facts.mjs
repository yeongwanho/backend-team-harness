import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { canonicalJson } from '../core/canonical-json.mjs'
import { resolveSafeProjectPath, statPath } from '../fs-safety.mjs'

const CONTRACT_PATH = '.backend-harness/project-facts.json'
const MAX_CONTRACT_BYTES = 1024 * 1024
const MAX_SOURCE_BYTES = 1024 * 1024
const MAX_PROVIDERS = 32
const MAX_FACTS_PER_PROVIDER = 256
const MAX_TOTAL_FACTS = 512
const MAX_SOURCES_PER_FACT = 8
const MAX_ARRAY_VALUES = 64
const PROVIDER_ID = /^[a-z][a-z0-9-]{0,63}$/
const FACT_ID = /^project\.[a-z][a-z0-9.-]{0,119}$/
const AUTHORITY_TYPES = new Set(['project-declared', 'deterministic-tool-output'])
const FACT_STATUSES = new Set(['confirmed', 'unknown', 'conflict'])
const PROVIDER_KEYS = new Set(['id', 'version', 'authority', 'facts'])
const FACT_KEYS = new Set(['id', 'status', 'value', 'summary', 'sources'])
const SOURCE_KEYS = new Set(['path', 'section'])

function plainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype)
}

function boundedString(value, label, maximum) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum || value.includes('\0')) {
    throw new Error(label + ' must be a non-empty string of at most ' + maximum + ' characters.')
  }
  return value
}

function rejectUnknownKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(label + ': unknown key ' + key)
  }
}

function scalar(value) {
  return ['string', 'number', 'boolean'].includes(typeof value) && (typeof value !== 'number' || Number.isFinite(value))
}

function validateValue(value, label, status) {
  if (status === 'unknown') {
    if (value !== null) throw new Error(label + ' must be null when status is unknown.')
    return
  }
  if (scalar(value)) return
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ARRAY_VALUES || !value.every(scalar)) {
    throw new Error(label + ' must be a scalar or contain at most 64 scalar entries.')
  }
  const unique = new Set(value.map((entry) => canonicalJson(entry)))
  if (unique.size !== value.length) throw new Error(label + ' must not contain duplicate entries.')
  if (status === 'conflict' && value.length < 2) throw new Error(label + ' must contain at least two alternatives when status is conflict.')
}

function validateSource(source, label) {
  if (!plainObject(source)) throw new Error(label + ' must be an object.')
  rejectUnknownKeys(source, SOURCE_KEYS, label)
  boundedString(source.path, label + '.path', 512)
  if (isAbsolute(source.path) || source.path.split(/[\\/]/).includes('..') || !source.path.toLowerCase().endsWith('.md')) {
    throw new Error(label + '.path must reference a project-relative Markdown policy file.')
  }
  boundedString(source.section, label + '.section', 512)
}

function validateFact(fact, providerLabel, index) {
  const label = providerLabel + '.facts[' + index + ']'
  if (!plainObject(fact)) throw new Error(label + ' must be an object.')
  rejectUnknownKeys(fact, FACT_KEYS, label)
  if (typeof fact.id !== 'string' || !FACT_ID.test(fact.id)) {
    throw new Error(label + '.id must use the project-owned namespace `project.*`.')
  }
  if (!FACT_STATUSES.has(fact.status)) throw new Error(label + '.status must be confirmed, unknown, or conflict.')
  if (!Object.hasOwn(fact, 'value')) throw new Error(label + '.value is required.')
  validateValue(fact.value, label + '.value', fact.status)
  boundedString(fact.summary, label + '.summary', 2048)
  if (!Array.isArray(fact.sources) || fact.sources.length === 0 || fact.sources.length > MAX_SOURCES_PER_FACT) {
    throw new Error(label + ' requires at least one policy source and at most ' + MAX_SOURCES_PER_FACT + '.')
  }
  fact.sources.forEach((source, sourceIndex) => validateSource(source, label + '.sources[' + sourceIndex + ']'))
}

export function parseProjectFacts(text, source = '<inline>') {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_CONTRACT_BYTES) {
    throw new Error(source + ': project-fact contract exceeds the ' + MAX_CONTRACT_BYTES + '-byte limit.')
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error(source + ': invalid JSON: ' + (error instanceof Error ? error.message : String(error)))
  }
  if (!plainObject(parsed)) throw new Error(source + ': project-fact contract must be an object.')
  rejectUnknownKeys(parsed, new Set(['schemaVersion', 'providers']), source)
  if (parsed.schemaVersion !== 1) throw new Error(source + ': schemaVersion must be 1.')
  if (!Array.isArray(parsed.providers) || parsed.providers.length > MAX_PROVIDERS) {
    throw new Error(source + ': providers must be an array with at most ' + MAX_PROVIDERS + ' entries.')
  }
  const providerIds = new Set()
  let totalFacts = 0
  parsed.providers.forEach((provider, providerIndex) => {
    const label = 'providers[' + providerIndex + ']'
    if (!plainObject(provider)) throw new Error(label + ' must be an object.')
    rejectUnknownKeys(provider, PROVIDER_KEYS, label)
    if (typeof provider.id !== 'string' || !PROVIDER_ID.test(provider.id)) throw new Error(label + '.id is invalid.')
    if (providerIds.has(provider.id)) throw new Error(source + ': duplicate provider id ' + provider.id + '.')
    providerIds.add(provider.id)
    boundedString(provider.version, label + '.version', 128)
    if (!AUTHORITY_TYPES.has(provider.authority)) {
      throw new Error(label + '.authority must be project-declared or deterministic-tool-output.')
    }
    if (!Array.isArray(provider.facts) || provider.facts.length > MAX_FACTS_PER_PROVIDER) {
      throw new Error(label + '.facts must contain at most ' + MAX_FACTS_PER_PROVIDER + ' entries.')
    }
    const factIds = new Set()
    provider.facts.forEach((fact, factIndex) => {
      validateFact(fact, label, factIndex)
      if (factIds.has(fact.id)) throw new Error(label + ': duplicate fact id ' + fact.id + '.')
      factIds.add(fact.id)
    })
    totalFacts += provider.facts.length
  })
  if (totalFacts > MAX_TOTAL_FACTS) throw new Error(source + ': project-fact contract exceeds ' + MAX_TOTAL_FACTS + ' total facts.')
  return parsed
}

function headings(text) {
  return new Set(text.split(/\r?\n/).flatMap((line) => {
    const match = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)
    return match ? [match[1].trim()] : []
  }))
}

export async function loadProjectFacts(root) {
  const path = await resolveSafeProjectPath(root, CONTRACT_PATH)
  const metadata = await statPath(path)
  if (!metadata) {
    return {
      schemaVersion: 1,
      source: null,
      providers: [],
      facts: [],
      diagnostics: ['Project facts are not configured at ' + CONTRACT_PATH + '.']
    }
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('Project-fact contract must be a regular non-symbolic link file.')
  if (metadata.size > MAX_CONTRACT_BYTES) throw new Error('Project-fact contract exceeds the ' + MAX_CONTRACT_BYTES + '-byte limit.')
  const parsed = parseProjectFacts(await readFile(path, 'utf8'), CONTRACT_PATH)
  const cachedSources = new Map()
  const facts = []
  for (const provider of parsed.providers) {
    for (const fact of provider.facts) {
      const verifiedSources = []
      for (const source of fact.sources) {
        let verified = cachedSources.get(source.path)
        if (!verified) {
          const sourcePath = await resolveSafeProjectPath(root, source.path)
          const sourceMetadata = await statPath(sourcePath)
          if (!sourceMetadata?.isFile() || sourceMetadata.isSymbolicLink()) {
            throw new Error('Project fact ' + fact.id + ' source must be a regular non-symbolic link Markdown file: ' + source.path)
          }
          if (sourceMetadata.size > MAX_SOURCE_BYTES) {
            throw new Error('Project fact ' + fact.id + ' source exceeds the ' + MAX_SOURCE_BYTES + '-byte limit: ' + source.path)
          }
          const content = await readFile(sourcePath)
          verified = {
            headings: headings(content.toString('utf8')),
            sha256: createHash('sha256').update(content).digest('hex')
          }
          cachedSources.set(source.path, verified)
        }
        if (!verified.headings.has(source.section)) {
          throw new Error('Project fact ' + fact.id + ' source section was not found: ' + source.path + ' # ' + source.section)
        }
        verifiedSources.push({ ...source, sha256: verified.sha256 })
      }
      facts.push({
        id: fact.id,
        status: fact.status,
        value: fact.value,
        summary: fact.summary,
        authority: {
          type: provider.authority,
          provider: provider.id,
          version: provider.version,
          verdictAuthority: false
        },
        evidence: { sources: verifiedSources }
      })
    }
  }
  return {
    schemaVersion: 1,
    source: CONTRACT_PATH,
    providers: parsed.providers.map((provider) => ({
      id: provider.id,
      version: provider.version,
      authority: provider.authority,
      facts: provider.facts.length
    })),
    facts,
    diagnostics: []
  }
}

function distinctSorted(values) {
  const byCanonical = new Map(values.map((value) => [canonicalJson(value), value]))
  return [...byCanonical.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, value]) => value)
}

export function mergeProjectFacts(builtInFacts, projectFacts) {
  const builtInIds = new Set(builtInFacts.map((fact) => fact.id))
  const groups = new Map()
  for (const fact of projectFacts) {
    if (builtInIds.has(fact.id)) throw new Error('Project fact ' + fact.id + ' collides with built-in fact authority.')
    const group = groups.get(fact.id) ?? []
    group.push(fact)
    groups.set(fact.id, group)
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([id, entries]) => {
    const confirmed = distinctSorted(entries.filter((entry) => entry.status === 'confirmed').map((entry) => entry.value))
    const hasExplicitConflict = entries.some((entry) => entry.status === 'conflict')
    const conflictCandidates = distinctSorted(entries.flatMap((entry) =>
      entry.status === 'conflict' && Array.isArray(entry.value) ? entry.value : entry.status === 'unknown' ? [] : [entry.value]
    ))
    const status = hasExplicitConflict || confirmed.length > 1 ? 'conflict' : confirmed.length === 1 ? 'confirmed' : 'unknown'
    const value = status === 'conflict' ? conflictCandidates : status === 'confirmed' ? confirmed[0] : null
    const providers = [...new Set(entries.map((entry) => entry.authority.provider))].sort()
    const sources = distinctSorted(entries.flatMap((entry) => entry.evidence.sources))
    return {
      id,
      status,
      value,
      summary: status === 'conflict' ? 'Project-owned providers disagree about ' + id + '.' : entries[0].summary,
      authority: { type: 'project-owned', providers, verdictAuthority: false },
      evidence: { sources }
    }
  })
}
