import { constants } from 'node:fs'
import { access, lstat, realpath, stat } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { buildSafeEnvironment, runProcess } from '../core/process-runner.mjs'

export const PROVIDER_IDS = Object.freeze(['codex', 'claude'])
export const IMPLEMENTATION_MODES = Object.freeze(['auto', 'fast', 'balanced', 'deep'])

const PROFILE_DEFAULTS = Object.freeze({
  fast: Object.freeze({ contextBudgetCharacters: 2_000, taskBudgetCharacters: 8_000, effort: 'low' }),
  balanced: Object.freeze({ contextBudgetCharacters: 6_000, taskBudgetCharacters: 24_000, effort: 'medium' }),
  deep: Object.freeze({ contextBudgetCharacters: 12_000, taskBudgetCharacters: 64_000, effort: 'high' })
})

function providerName(provider) {
  if (!PROVIDER_IDS.includes(provider)) throw new Error('Unsupported implementation provider: ' + provider)
  return provider
}

function executableNames(provider, platform, env) {
  const base = providerName(provider)
  if (platform !== 'win32') return [base]
  const extensions = (env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
  return extensions.map((extension) => base + extension)
}

export async function resolveProviderExecutable(provider, options = {}) {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const pathValue = env.PATH
  if (typeof pathValue !== 'string' || !pathValue) throw new Error('PATH is unavailable while resolving provider ' + provider + '.')
  const pathDelimiter = platform === 'win32' ? ';' : delimiter
  for (const directory of pathValue.split(pathDelimiter).filter(Boolean)) {
    for (const name of executableNames(provider, platform, env)) {
      const candidate = join(directory, name)
      try {
        const link = await lstat(candidate)
        if (!link.isFile() && !link.isSymbolicLink()) continue
        const canonical = await realpath(candidate)
        const metadata = await stat(canonical)
        if (!metadata.isFile()) continue
        if (platform !== 'win32') await access(canonical, constants.X_OK)
        return { path: candidate, canonicalPath: canonical, display: provider }
      } catch {
        // Continue through PATH without exposing machine-specific resolution errors.
      }
    }
  }
  throw new Error('Implementation provider CLI is not available on PATH: ' + provider)
}

export function selectImplementationProfile(input = {}) {
  const configured = input.mode ?? 'auto'
  if (!IMPLEMENTATION_MODES.includes(configured)) throw new Error('Invalid implementation mode: ' + configured)
  const taskCharacters = input.taskCharacters ?? 0
  if (!Number.isSafeInteger(taskCharacters) || taskCharacters < 0) throw new Error('Implementation task size is invalid.')
  let selected = configured
  const reasons = []
  const projectRuleReadiness = ['confirmed', 'unknown', 'conflict'].includes(input.projectRuleReadiness)
    ? input.projectRuleReadiness
    : 'unknown'
  const adjacentCodeReady = typeof input.adjacentCodeReady === 'boolean' ? input.adjacentCodeReady : null
  const conventionsReady = typeof input.conventionsReady === 'boolean' ? input.conventionsReady : null
  if (configured === 'auto') {
    const claims = input.claims ?? {}
    const breakingPublicApi = claims.changesPublicApi === true && claims.preservesCompatibility !== true
    const ambiguousDatabaseChange = claims.changesDatabase === true && claims.requiresMigration !== false
    const highRisk = claims.requiresMigration === true || breakingPublicApi || ambiguousDatabaseChange
    const explicitlySmall = typeof claims.changesDatabase === 'boolean' &&
      claims.requiresMigration === false &&
      (claims.changesPublicApi !== true || claims.preservesCompatibility === true) &&
      claims.preservesCompatibility === true &&
      Array.isArray(claims.modules) && claims.modules.length === 1 &&
      Array.isArray(claims.requiredGates) && claims.requiredGates.length > 0
    if (highRisk || taskCharacters > PROFILE_DEFAULTS.balanced.taskBudgetCharacters) {
      selected = 'deep'
      reasons.push(
        taskCharacters > PROFILE_DEFAULTS.balanced.taskBudgetCharacters
          ? 'large-approved-task-requires-deep-budget'
          : claims.requiresMigration === true
            ? 'schema-migration-risk'
            : breakingPublicApi
              ? 'public-api-compatibility-risk'
              : 'database-migration-impact-unknown'
      )
    } else if (projectRuleReadiness === 'conflict') {
      selected = 'deep'
      reasons.push('project-rule-conflict')
    } else if (explicitlySmall && projectRuleReadiness !== 'confirmed') {
      selected = 'balanced'
      reasons.push('project-rules-not-confirmed-for-fast-mode')
    } else if (explicitlySmall && adjacentCodeReady === false) {
      selected = 'balanced'
      reasons.push('adjacent-code-not-confirmed-for-fast-mode')
    } else if (explicitlySmall && conventionsReady === false) {
      selected = 'balanced'
      reasons.push('project-conventions-not-observed-for-fast-mode')
    } else if (explicitlySmall) {
      selected = 'fast'
      reasons.push('explicit-single-module-no-migration-compatible-change')
    } else {
      selected = 'balanced'
      reasons.push('insufficient-structured-evidence-for-fast-mode')
    }
  } else {
    reasons.push('explicit-configured-mode')
  }
  const defaults = PROFILE_DEFAULTS[selected]
  const budget = input.contextBudgetCharacters ?? defaults.contextBudgetCharacters
  if (!Number.isSafeInteger(budget) || budget < 64 || budget > 32_768) {
    throw new Error('Implementation context budget must be between 64 and 32768 characters.')
  }
  if (taskCharacters > defaults.taskBudgetCharacters) {
    throw new Error(
      'Approved task text exceeds the ' + selected + ' profile limit of ' + defaults.taskBudgetCharacters +
      ' characters; split the task or select a larger profile.'
    )
  }
  return {
    configured,
    selected,
    reasons,
    effort: defaults.effort,
    taskCharacters,
    taskBudgetCharacters: defaults.taskBudgetCharacters,
    contextBudgetCharacters: budget,
    readiness: {
      projectRules: projectRuleReadiness,
      adjacentCode: adjacentCodeReady === null ? 'pending' : adjacentCodeReady ? 'confirmed' : 'unknown',
      discoveredConventions: conventionsReady === null ? 'pending' : conventionsReady ? 'observed' : 'unknown'
    },
    verificationStrategy: 'all-required-gates'
  }
}

function providerPrompt(requestPath) {
  return [
    'Open ' + requestPath + ' and implement only its approved task inside the current workspace.',
    'Before editing, follow projectConventions: read every declared rule source and relevant knowledge document, then inspect at least one adjacent production example and its matching test.',
    'Start with the ranked codeContext paths; when they are unavailable, use bounded Glob and Grep discovery inside allowedPrefixes.',
    'Use projectConventions.discovered as source-cited observations, not declared policy; preserve repeated naming, layering, DTO/error, transaction, persistence, and test patterns wherever the observations or adjacent examples show them, even for a small CRUD change.',
    'For MySQL/JPA work, inspect cited database observations and adjacent code for query shape, indexes, transaction scope, locks, and N+1 risk; source-pattern candidates are review prompts, never proof of a query plan or runtime defect.',
    'If a declared blocking project rule is unknown, unavailable, or conflicts with the code, do not guess; stop without changing files; preserve non-blocking warnings in the implementation evidence.',
    'Obey allowedPrefixes and authority limits. Never commit, change Git refs, deploy, access production, or edit .backend-harness control files.',
    'Do not read .env files, credential stores, private keys, tokens, or unrelated user data.',
    'Do not run the broad verification suite; Backend Team Harness runs every declared Gate after your edit.',
    'If recovery evidence is present, fix its concrete failure without widening the approved scope.'
  ].join(' ')
}

export function buildProviderInvocation(adapter, executable, requestPath, profile) {
  const prompt = providerPrompt(requestPath)
  if (adapter.provider === 'codex') {
    const args = [
      'exec', '--ephemeral', '--ignore-user-config', '--approve-for-me',
      '--color', 'never', '--json', '-c', 'model_reasoning_effort=' + profile.effort
    ]
    if (adapter.model) args.push('--model', adapter.model)
    args.push(prompt)
    return { program: executable.path, args, promptShaInput: prompt }
  }
  if (adapter.provider === 'claude') {
    const args = [
      '--print', '--output-format', 'json', '--no-session-persistence', '--disable-slash-commands', '--no-chrome',
      '--setting-sources', 'project', '--permission-mode', 'acceptEdits', '--tools', 'Read,Edit,Write,Glob,Grep',
      '--effort', profile.effort
    ]
    if (adapter.model) args.push('--model', adapter.model)
    if (adapter.maxBudgetUsd !== null) args.push('--max-budget-usd', String(adapter.maxBudgetUsd))
    args.push(prompt)
    return { program: executable.path, args, promptShaInput: prompt }
  }
  throw new Error('Unsupported implementation provider: ' + adapter.provider)
}

function numericUsage(value, path = '', result = {}, depth = 0) {
  if (depth > 5 || Object.keys(result).length >= 32 || value === null || value === undefined) return result
  if (typeof value === 'number' && Number.isFinite(value) && /(token|cost|duration|turn)/i.test(path)) {
    result[path.slice(0, 160)] = value
    return result
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < Math.min(value.length, 16); index += 1) numericUsage(value[index], path + '[' + index + ']', result, depth + 1)
  } else if (typeof value === 'object') {
    for (const [key, nested] of Object.entries(value).slice(0, 64)) {
      numericUsage(nested, path ? path + '.' + key : key, result, depth + 1)
    }
  }
  return result
}

export function extractProviderUsage(stdoutTail) {
  if (typeof stdoutTail !== 'string' || !stdoutTail.trim()) return {}
  const documents = []
  try { documents.push(JSON.parse(stdoutTail)) } catch {
    for (const line of stdoutTail.trim().split(/\r?\n/).slice(-64)) {
      try { documents.push(JSON.parse(line)) } catch {
        // Provider prose and partial JSON are deliberately ignored.
      }
    }
  }
  const usage = documents.reduce((result, document) => numericUsage(document, '', result), {})
  if (Object.keys(usage).length > 0) return usage
  const knownNumericFields = /"(input_tokens|output_tokens|cached_input_tokens|cache_read_input_tokens|cache_creation_input_tokens|reasoning_output_tokens|total_cost_usd|cost_usd|duration_ms|duration_api_ms|num_turns)"\s*:\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g
  for (const match of stdoutTail.matchAll(knownNumericFields)) {
    const value = Number(match[2])
    if (Number.isFinite(value)) usage[match[1]] = value
    if (Object.keys(usage).length >= 32) break
  }
  return usage
}

function finiteUsageValue(usage, candidates) {
  for (const candidate of candidates) {
    const value = usage[candidate]
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  }
  return null
}

export function normalizeProviderUsage(provider, usage = {}, fallbackDurationMs = null) {
  const input = finiteUsageValue(usage, [
    'usage.input_tokens', 'usage.inputTokens', 'input_tokens', 'inputTokens',
    'message.usage.input_tokens', 'result.usage.input_tokens'
  ])
  const output = finiteUsageValue(usage, [
    'usage.output_tokens', 'usage.outputTokens', 'output_tokens', 'outputTokens',
    'message.usage.output_tokens', 'result.usage.output_tokens'
  ])
  const cachedInput = finiteUsageValue(usage, [
    'usage.cached_input_tokens', 'usage.cache_read_input_tokens', 'usage.cache_creation_input_tokens',
    'cached_input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'
  ])
  const reasoningOutput = finiteUsageValue(usage, [
    'usage.reasoning_output_tokens', 'reasoning_output_tokens'
  ])
  const reportedTotal = finiteUsageValue(usage, ['usage.total_tokens', 'total_tokens', 'totalTokens'])
  const knownTokenParts = [input, output].filter((value) => value !== null)
  const total = reportedTotal ?? (knownTokenParts.length > 0 ? knownTokenParts.reduce((sum, value) => sum + value, 0) : null)
  return {
    schemaVersion: 1,
    provider,
    tokens: { input, output, cachedInput, reasoningOutput, total },
    costUsd: finiteUsageValue(usage, ['total_cost_usd', 'cost_usd', 'costUsd', 'usage.cost_usd']),
    durationMs: finiteUsageValue(usage, ['duration_ms', 'duration_api_ms', 'durationMs']) ??
      (typeof fallbackDurationMs === 'number' && Number.isFinite(fallbackDurationMs) && fallbackDurationMs >= 0 ? fallbackDurationMs : null),
    turns: finiteUsageValue(usage, ['num_turns', 'turns']),
    providerReported: Object.fromEntries(Object.entries(usage).slice(0, 32))
  }
}

export function extractProviderFailure(provider, stdoutTail, stderrTail = '') {
  const combined = (String(stdoutTail ?? '') + '\n' + String(stderrTail ?? '')).slice(-16_384)
  const normalized = combined.toLowerCase()
  if (/not logged in|please run \/login|unauthenticated|authentication required|401 unauthorized|authorization failed|invalid bearer|invalid api key|credentials (?:are )?invalid/.test(normalized)) {
    return { code: 'not-authenticated', message: 'The local provider CLI is not authenticated in the filtered execution environment.' }
  }
  if (/max(?:imum)? budget|budget (?:has been )?exceeded|cost limit/.test(normalized)) {
    return { code: 'budget-exhausted', message: 'The provider stopped at its configured cost budget.' }
  }
  if (/rate.?limit|too many requests|quota exceeded/.test(normalized)) {
    return { code: 'rate-limited', message: 'The provider reported a rate or quota limit.' }
  }
  if (/unknown (?:argument|option)|unexpected argument|cannot be used with/.test(normalized)) {
    return { code: 'cli-incompatible', message: 'The installed provider CLI rejected the configured arguments.' }
  }
  return provider
    ? { code: 'provider-failed', message: 'The provider exited unsuccessfully; inspect the recorded output digests.' }
    : null
}

export async function probeImplementationProvider(provider, options = {}) {
  const executable = await resolveProviderExecutable(provider, options)
  const result = await (options.processRunner ?? runProcess)({
    program: executable.path,
    args: ['--version'],
    cwd: options.cwd,
    timeoutMs: 10_000,
    env: buildSafeEnvironment(options.env ?? process.env)
  })
  const available = result.exitCode === 0 && !result.signal && !result.timedOut && !result.stdioDrainTimedOut
  return {
    provider,
    available,
    executable: executable.display,
    version: available ? result.stdout.tail.trim().slice(0, 256) || result.stderr.tail.trim().slice(0, 256) : null,
    process: result
  }
}

export async function runImplementationProvider(adapter, input, options = {}) {
  const executable = await resolveProviderExecutable(adapter.provider, options)
  const invocation = buildProviderInvocation(adapter, executable, input.requestPath, input.profile)
  const result = await (options.processRunner ?? runProcess)({
    program: invocation.program,
    args: invocation.args,
    cwd: input.cwd,
    timeoutMs: adapter.timeoutMs,
    tailBytes: 64 * 1024,
    env: input.env
  })
  const passed = result.exitCode === 0 && !result.signal && !result.timedOut && !result.stdioDrainTimedOut
  const providerUsage = extractProviderUsage(result.stdout.tail)
  return {
    process: result,
    metadata: {
      kind: 'provider',
      provider: adapter.provider,
      executable: executable.display,
      version: options.version ?? null,
      model: adapter.model,
      profile: input.profile,
      usage: normalizeProviderUsage(adapter.provider, providerUsage, result.durationMs),
      failure: passed ? null : extractProviderFailure(adapter.provider, result.stdout.tail, result.stderr.tail)
    }
  }
}
