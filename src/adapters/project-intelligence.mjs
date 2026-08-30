import { spawn } from 'node:child_process'
import { relative, sep } from 'node:path'
import { loadProjectFacts, mergeProjectFacts } from '../config/project-facts.mjs'
import { loadProjectRules } from '../config/project-rules.mjs'
import { evaluateProjectRules } from '../core/constraint-engine.mjs'
import { loadJvmIndexCache, writeJvmIndexCache } from '../core/jvm-index-cache.mjs'
import { inspectJvmProject } from '../core/jvm-project-index.mjs'
import { inspectKnowledgeDocuments } from '../core/knowledge-index.mjs'
import { compileProjectConventions } from '../core/convention-compiler.mjs'
import { inspectMysqlMigrationIndexes } from '../core/mysql-migration-index.mjs'
import { inspectPortableProject } from '../core/portable-project-index.mjs'
import { inspectPortableTestBuild } from '../core/portable-test-discovery.mjs'
import { buildSafeEnvironment } from '../core/process-runner.mjs'
import { PROJECT_MANIFEST, scanProjectManifest } from '../core/project-manifest.mjs'
import { withProjectVerificationLock } from '../core/project-lock.mjs'
import { resolveReadableRoot } from '../fs-safety.mjs'
import { captureProjectContextSourceBinding, inspectProjectContext } from './project-context.mjs'

const MAX_GIT_STATUS_BYTES = 16 * 1024 * 1024
const MAX_EXPOSED_CHANGED_PATHS = 2048

function portable(path) {
  return path.split(sep).join('/')
}

function isJvmPath(path) {
  return typeof path === 'string' && /\.(?:java|kt)$/.test(path)
}

function runGit(root, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', ['-C', root, ...args], {
      env: buildSafeEnvironment(),
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const stdout = []
    const stderr = []
    let bytes = 0
    let overflow = false
    child.stdout.on('data', (chunk) => {
      bytes += chunk.length
      if (bytes > MAX_GIT_STATUS_BYTES) {
        overflow = true
        child.kill('SIGTERM')
      } else {
        stdout.push(chunk)
      }
    })
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.once('error', reject)
    child.once('close', (code) => {
      if (overflow) {
        reject(new Error('Git change inspection exceeded the ' + MAX_GIT_STATUS_BYTES + '-byte limit.'))
      } else if (code !== 0) {
        reject(new Error('Git change inspection failed: ' + (Buffer.concat(stderr).toString('utf8').trim() || 'exit ' + code)))
      } else {
        resolvePromise(Buffer.concat(stdout).toString('utf8'))
      }
    })
  })
}

function changeKind(code) {
  if (code === '??' || code.includes('A')) return 'added'
  if (code.includes('D')) return 'deleted'
  if (code.includes('R')) return 'renamed'
  if (code.includes('C')) return 'copied'
  return 'modified'
}

function projectRelativePath(path, projectPath) {
  const portablePath = portable(path)
  if (!projectPath || projectPath === '.') {
    return portablePath
  }
  const prefix = portable(projectPath).replace(/\/$/, '') + '/'
  return portablePath.startsWith(prefix) ? portablePath.slice(prefix.length) : portablePath
}

function parseGitStatus(text, projectPath = '.') {
  const records = text.split('\0').filter(Boolean)
  const changes = []
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (record.length < 4) {
      throw new Error('Git returned a malformed status entry.')
    }
    const code = record.slice(0, 2)
    const path = projectRelativePath(record.slice(3), projectPath)
    const entry = { code, kind: changeKind(code), path }
    if (code.includes('R') || code.includes('C')) {
      entry.previousPath = projectRelativePath(records[index + 1] ?? '', projectPath)
      index += 1
    }
    changes.push(entry)
  }
  return changes
}

async function inspectGitChanges(root, projectPath = '.') {
  const changes = parseGitStatus(await runGit(root, [
    '-c', 'status.relativePaths=true', 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.',
    ':(exclude).backend-harness/tasks/**',
    ':(exclude).backend-harness/local/**',
    ':(exclude).backend-harness/generated/**'
  ]), projectPath)
  const exposed = changes.slice(0, MAX_EXPOSED_CHANGED_PATHS)
  return {
    schemaVersion: 1,
    count: changes.length,
    truncated: changes.length > exposed.length,
    changes: exposed,
    counts: Object.fromEntries(['added', 'modified', 'deleted', 'renamed', 'copied'].map((kind) => [kind, changes.filter((entry) => entry.kind === kind).length]))
  }
}

async function changedJvmPathsSince(root, cachedHeadCommit, currentHeadCommit, projectPath, gitChanges) {
  if (!cachedHeadCommit || gitChanges.truncated) {
    return null
  }
  const changed = new Set()
  for (const entry of gitChanges.changes) {
    if (isJvmPath(entry.path)) changed.add(entry.path)
    if (isJvmPath(entry.previousPath)) changed.add(entry.previousPath)
  }
  if (cachedHeadCommit !== currentHeadCommit) {
    let commitDiff
    try {
      commitDiff = await runGit(root, ['diff', '--name-only', '-z', '--relative', cachedHeadCommit, currentHeadCommit, '--'])
    } catch {
      return null
    }
    for (const path of commitDiff.split('\0').filter(Boolean).map((entry) => projectRelativePath(entry, projectPath))) {
      if (isJvmPath(path)) changed.add(path)
    }
  }
  return changed
}

function fact(id, status, value, summary, evidence) {
  return { id, status, value, summary, evidence }
}

function contextFact(context, id) {
  return context.facts.find((entry) => entry.id === id)
}

function factStatus(entry) {
  return entry?.status === 'confirmed' ? 'confirmed' : entry?.status === 'conflict' ? 'conflict' : 'unknown'
}

function factsFrom(context, knowledge, code, gitChanges) {
  const build = contextFact(context, 'build.definition')
  const wrapper = contextFact(context, 'build.wrapper')
  const source = contextFact(context, 'source.production')
  const tests = contextFact(context, 'source.tests')
  const flyway = contextFact(context, 'database.flyway')
  const sharedContract = contextFact(context, 'contract.shared')
  const verification = contextFact(context, 'verification.contract')
  const quality = contextFact(context, 'policy.quality-gates')
  const dialect = context.verification.context.databaseDialect
  const gates = context.verification.gates.map((gate) => gate.id).sort()
  const isVersionedFlywayMigration = (path) => typeof path === 'string' && /(^|\/)db\/migration\/(?:[^/]+\/)*[VU][0-9]+(?:[._][0-9]+)*__[^/]+\.sql$/.test(path)
  const changedMigrations = gitChanges.changes.filter((entry) =>
    entry.kind !== 'added' && (isVersionedFlywayMigration(entry.path) || isVersionedFlywayMigration(entry.previousPath))
  )
  const migrationChangeStatus = changedMigrations.length > 0
    ? 'confirmed'
    : gitChanges.truncated
      ? 'unknown'
      : 'confirmed'
  const codeIndexComplete = code.metrics.oversizedFiles === 0 && code.metrics.skippedSymlinks === 0
  const codeFactStatus = codeIndexComplete ? 'confirmed' : 'unknown'
  const codeEvidence = {
    ...code.authority,
    complete: codeIndexComplete,
    oversizedFiles: code.metrics.oversizedFiles,
    skippedSymlinks: code.metrics.skippedSymlinks
  }
  return [
    fact('git.clean', 'confirmed', context.sourceBinding.clean, 'Whether the bound project source has no working changes.', { source: 'git source binding' }),
    fact('git.changed.count', 'confirmed', gitChanges.count, 'Number of changed project entries.', { source: 'git status', truncated: gitChanges.truncated }),
    fact('git.changed.paths', gitChanges.truncated ? 'unknown' : 'confirmed', gitChanges.changes.map((entry) => entry.path), 'Bounded changed project paths.', { source: 'git status', truncated: gitChanges.truncated }),
    fact('build.definition.present', factStatus(build), (build?.evidence?.valid?.length ?? 0) > 0, 'Recognizable build definition availability.', build?.evidence ?? {}),
    fact('build.wrapper.present', factStatus(wrapper), (wrapper?.evidence?.files?.length ?? 0) > 0, 'Project build-wrapper availability.', wrapper?.evidence ?? {}),
    fact('source.production.present', factStatus(source), (source?.evidence?.count ?? 0) > 0, 'Conventional production-source availability.', source?.evidence ?? {}),
    fact('source.tests.present', factStatus(tests), (tests?.evidence?.count ?? 0) > 0, 'Conventional test-source availability.', tests?.evidence ?? {}),
    fact('database.dialect', dialect ? 'confirmed' : 'unknown', dialect ?? null, 'Declared verification database dialect.', { source: context.verification.path }),
    fact('database.flyway.present', factStatus(flyway), (flyway?.evidence?.files?.length ?? 0) > 0, 'Conventional Flyway migration availability.', flyway?.evidence ?? {}),
    fact('database.flyway.modified-existing', migrationChangeStatus, migrationChangeStatus === 'confirmed' ? changedMigrations.length > 0 : null, 'Whether an existing versioned migration is modified, deleted, copied, or renamed.', { source: 'git status', paths: changedMigrations.map((entry) => entry.path), truncated: gitChanges.truncated }),
    fact('database.tables', codeFactStatus, code.tables, 'Table names explicitly declared by indexed JPA @Table annotations.', codeEvidence),
    fact('contract.shared.present', factStatus(sharedContract), (sharedContract?.evidence?.missing?.length ?? 0) === 0, 'Required repository knowledge documents are present.', sharedContract?.evidence ?? {}),
    fact('knowledge.documents.complete', 'confirmed', knowledge.complete, 'Required knowledge documents are present.', { missing: knowledge.missing }),
    fact('knowledge.documents.count', 'confirmed', knowledge.documents.length, 'Number of bounded indexed knowledge documents.', { paths: knowledge.documents.map((entry) => entry.path) }),
    fact('policy.review-checklists.valid', factStatus(quality), factStatus(quality) === 'confirmed', 'Human review checklist schema status.', quality?.evidence ?? {}),
    fact('policy.review-checklists', factStatus(quality), context.policyGates.map((gate) => gate.name).sort(), 'Declared human review checklists.', { source: '.backend-harness/quality-gates/' }),
    fact('verification.config.present', factStatus(verification), factStatus(verification) === 'confirmed', 'Executable verification contract availability.', verification?.evidence ?? {}),
    fact('verification.gates', factStatus(verification), gates, 'Configured executable Gate ids.', { source: context.verification.path }),
    fact('verification.required-junit-gate.present', factStatus(verification), context.verification.gates.some((gate) => gate.required && gate.resultType === 'junit'), 'Whether at least one required JUnit Gate exists.', { source: context.verification.path }),
    fact('code.jvm.files', codeFactStatus, code.metrics.files, 'Indexed Java/Kotlin source files.', codeEvidence),
    fact('code.declarations.count', codeFactStatus, code.metrics.declarations, 'Indexed Java/Kotlin declarations.', codeEvidence),
    fact('code.routes.count', codeFactStatus, code.metrics.routes, 'Explicit Spring mapping annotations.', codeEvidence),
    fact('code.entities.count', codeFactStatus, code.metrics.entities, 'Files carrying an explicit JPA @Entity annotation.', codeEvidence),
    fact('code.tests.count', codeFactStatus, code.metrics.tests, 'Indexed conventional JVM test files.', codeEvidence),
    fact('code.roles', codeFactStatus, code.roles, 'Observed JVM architectural roles.', codeEvidence),
    fact('code.packages', codeFactStatus, code.packages, 'Observed Java/Kotlin package names.', codeEvidence)
  ]
}

export async function inspectProjectIntelligence(inputPath, options = {}) {
  const root = await resolveReadableRoot(inputPath)
  const manifestOptions = {
    maxDepth: Infinity,
    maxEntries: 500_000,
    onLimit: 'throw',
    onReadError: 'throw',
    ...(options.manifestOptions ?? {})
  }
  const context = options.context ?? await inspectProjectContext(root, { ...options, manifestOptions })
  const manifest = options.manifest ?? context[PROJECT_MANIFEST] ?? await scanProjectManifest(root, manifestOptions)
  const portableDetection = await inspectPortableTestBuild(root, manifest)
  const gitChangesPromise = inspectGitChanges(root, context.sourceBinding.projectPath)
  let cache = { root, path: '.backend-harness/local/cache/jvm-index.json', status: 'disabled', diagnostic: null }
  if (options.useCache !== false) {
    cache = await loadJvmIndexCache(root, context.sourceBinding.fingerprint, manifest)
  }
  let codePromise
  if (cache.status === 'hit') {
    codePromise = Promise.resolve({
      ...cache.index,
      metrics: {
        ...cache.index.metrics,
        readBytes: 0,
        parsedFiles: 0,
        reusedFiles: cache.index.metrics.files
      }
    })
  } else if (cache.status === 'stale') {
    const changedPaths = await changedJvmPathsSince(
      root,
      cache.cachedHeadCommit,
      context.sourceBinding.headCommit,
      context.sourceBinding.projectPath,
      await gitChangesPromise
    )
    if (changedPaths) {
      codePromise = inspectJvmProject(root, {
        ...(options.jvm ?? {}),
        manifest,
        cachedIndex: cache.index,
        changedPaths
      })
      cache = {
        ...cache,
        status: 'incremental',
        diagnostic: 'source changed; unchanged JVM files were reused from the previous source-bound cache.'
      }
    } else {
      codePromise = inspectJvmProject(root, { ...(options.jvm ?? {}), manifest })
    }
  } else {
    codePromise = inspectJvmProject(root, { ...(options.jvm ?? {}), manifest })
  }
  const [knowledge, indexedCode, portableCode, gitChanges, ruleContract, projectFactContract, mysqlMigrationIndex] = await Promise.all([
    inspectKnowledgeDocuments(root),
    codePromise,
    inspectPortableProject(root, manifest, {
      enabled: portableDetection.status === 'confirmed',
      projectPath: portableDetection.projectPath ?? '.'
    }),
    gitChangesPromise,
    loadProjectRules(root),
    loadProjectFacts(root),
    inspectMysqlMigrationIndexes(root, manifest)
  ])
  const { index: _cachedIndex, root: _cacheRoot, ...cacheMetadata } = cache
  const code = { ...indexedCode, cache: cacheMetadata }
  const portableFiles = indexedCode.files.length === 0 ? portableCode.files : []
  const conventions = compileProjectConventions({ files: [...indexedCode.files, ...portableFiles] }, mysqlMigrationIndex)
  const builtInFacts = factsFrom(context, knowledge, code, gitChanges)
  const projectFacts = mergeProjectFacts(builtInFacts, projectFactContract.facts)
  const facts = [...builtInFacts, ...projectFacts]
  const evaluation = evaluateProjectRules(facts, ruleContract.rules)
  const overallStatus = evaluation.blocking
    ? 'conflict'
    : context.structuralReadiness && context.verification.status === 'configured'
      ? evaluation.status
      : 'unknown'
  const result = {
    ...context,
    intelligence: {
      schemaVersion: 1,
      overallStatus,
      sourceFingerprint: context.sourceBinding.fingerprint,
      authority: {
        deterministic: true,
        modelGenerated: false,
        compilerSemanticIndex: false,
        verdictAuthority: false,
        projectFacts: 'source-bound-project-declared'
      },
      facts,
      projectFacts: {
        source: projectFactContract.source,
        providers: projectFactContract.providers,
        count: projectFacts.length,
        diagnostics: projectFactContract.diagnostics
      },
      rules: {
        source: ruleContract.source,
        count: ruleContract.rules.length,
        diagnostics: ruleContract.diagnostics,
        definitions: ruleContract.rules
      },
      evaluation,
      knowledge,
      code,
      conventions,
      gitChanges
    }
  }
  Object.defineProperty(result, PROJECT_MANIFEST, { value: manifest })
  return result
}

export function warmProjectIntelligenceCache(inputPath, options = {}) {
  return withProjectVerificationLock(inputPath, options.projectLock, async () => {
    const result = await inspectProjectIntelligence(inputPath, { ...options, useCache: false })
    const currentSource = await captureProjectContextSourceBinding(result.root ?? inputPath)
    if (currentSource.fingerprint !== result.intelligence.sourceFingerprint) {
      throw new Error('Project source changed while the JVM index cache was being prepared. Retry warm-cache on a stable worktree.')
    }
    const originalManifest = result[PROJECT_MANIFEST]
    const currentManifest = await scanProjectManifest(await resolveReadableRoot(inputPath), {
      maxDepth: Infinity,
      maxEntries: 500_000,
      onLimit: 'throw',
      onReadError: 'throw',
      ...(options.manifestOptions ?? {})
    })
    if (originalManifest.skippedJvmSymlinks !== currentManifest.skippedJvmSymlinks ||
        originalManifest.files.length !== currentManifest.files.length ||
        originalManifest.files.some((path, index) => path !== currentManifest.files[index])) {
      throw new Error('Project file manifest changed while the JVM index cache was being prepared. Retry warm-cache on a stable worktree.')
    }
    const { cache: _cacheMetadata, ...index } = result.intelligence.code
    return writeJvmIndexCache(
      inputPath,
      result.sourceBinding,
      index,
      currentManifest,
      { at: options.at }
    )
  })
}
