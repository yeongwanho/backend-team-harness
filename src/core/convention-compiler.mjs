const MAX_EXAMPLES = 8
const MAX_PAIR_CANDIDATES = 128
const ROLE_SUFFIXES = Object.freeze({
  configuration: ['Configuration', 'Config'],
  controller: ['Controller', 'Resource'],
  dto: ['Request', 'Response', 'Dto'],
  entity: ['Entity'],
  error: ['Exception', 'Error'],
  repository: ['Repository', 'Dao'],
  service: ['Service'],
  test: ['IntegrationTest', 'Tests', 'Test', 'IT']
})

function moduleForPath(path) {
  const normalized = String(path ?? '').replaceAll('\\', '/')
  const parts = normalized.split('/').filter(Boolean)
  if (['src', 'app', 'test', 'tests'].includes(parts[0])) return 'root'
  const marker = parts.findIndex((part) => ['src', 'app', 'test', 'tests'].includes(part))
  return marker <= 0 ? 'root' : parts.slice(0, marker).join('/')
}

function fileStem(path, isTest) {
  let stem = String(path).replaceAll('\\', '/').split('/').at(-1)
    .replace(/\.(?:ts|tsx|js|jsx|mjs|cjs|py|java|kt)$/, '')
  if (isTest) {
    stem = stem.replace(/(?:[.-](?:spec|test)|_test|IntegrationTests|IntegrationTest|Tests|Test|IT)$/, '')
    if (path.endsWith('.py')) stem = stem.replace(/^test_/, '')
  }
  return ['__init__', 'index', 'conftest'].includes(stem) ? '' : stem
}

function citation(file) {
  return {
    path: file.path,
    contentSha256: file.contentSha256 ?? null,
    packageName: file.packageName ?? '',
    declarations: (file.declarations ?? []).map((declaration) => declaration.name).filter(Boolean).slice(0, 8)
  }
}

function suffixFor(name, role) {
  return (ROLE_SUFFIXES[role] ?? []).find((suffix) => name.endsWith(suffix)) ?? null
}

function layerObservation(role, files) {
  const matching = files.filter((file) => (file.roles ?? []).includes(role))
  const suffixCounts = new Map()
  for (const file of matching) {
    for (const declaration of file.declarations ?? []) {
      const suffix = suffixFor(declaration.name, role)
      if (suffix) suffixCounts.set(suffix, (suffixCounts.get(suffix) ?? 0) + 1)
    }
  }
  return {
    role,
    count: matching.length,
    packages: [...new Set(matching.map((file) => file.packageName).filter(Boolean))].sort().slice(0, 32),
    naming: [...suffixCounts.entries()]
      .map(([suffix, occurrences]) => ({ suffix, occurrences, status: occurrences >= 2 ? 'repeated' : 'single-example' }))
      .sort((left, right) => right.occurrences - left.occurrences || left.suffix.localeCompare(right.suffix)),
    examples: matching.slice(0, MAX_EXAMPLES).map(citation)
  }
}

function testPairing(files) {
  const production = new Map()
  const tests = []
  for (const file of files) {
    const isTest = (file.roles ?? []).includes('test')
    const keys = new Set([fileStem(file.path, isTest)].filter(Boolean))
    for (const declaration of file.declarations ?? []) {
      if (isTest) {
        const base = declaration.name.replace(/(?:IntegrationTests|IntegrationTest|Tests|Test|IT)$/, '')
        if (base && base !== declaration.name) keys.add(base)
      } else if (declaration.name) keys.add(declaration.name)
    }
    if (isTest) tests.push({ file, keys })
    else for (const key of keys) {
      const scopedKey = pairingKey(file, key)
      if (!production.has(scopedKey)) production.set(scopedKey, new Map())
      production.get(scopedKey).set(file.path, file)
    }
  }
  const paired = new Map()
  let ambiguousTestFileCount = 0, unmatchedTestFileCount = 0, candidateLimitExceededTestFileCount = 0
  for (const { file: test, keys } of tests) {
    const candidates = new Map()
    collect: for (const key of keys) for (const [path, source] of production.get(pairingKey(test, key)) ?? []) {
      candidates.set(path, source)
      if (candidates.size > MAX_PAIR_CANDIDATES) break collect
    }
    if (candidates.size > MAX_PAIR_CANDIDATES) {
      ambiguousTestFileCount += 1
      candidateLimitExceededTestFileCount += 1
      continue
    }
    const ranked = [...candidates.values()].map(source => ({
      source,
      score: Number(Boolean(test.packageName) && source.packageName === test.packageName) +
        Number(pairingDirectory(source.path) === pairingDirectory(test.path))
    }))
    const maximum = Math.max(...ranked.map(entry => entry.score))
    const best = ranked.filter(entry => entry.score === maximum)
    if (best.length !== 1) {
      if (best.length) ambiguousTestFileCount += 1
      else unmatchedTestFileCount += 1
      continue
    }
    const source = best[0].source
    paired.set(source.path + '\0' + test.path, {
      production: source.path, productionSha256: source.contentSha256 ?? null,
      test: test.path, testSha256: test.contentSha256 ?? null
    })
  }
  const pairs = [...paired.values()].sort((left, right) => left.production.localeCompare(right.production) || left.test.localeCompare(right.test))
  return {
    status: tests.length > 0 ? 'observed' : 'not-observed',
    count: tests.length,
    pairs: pairs.slice(0, 32),
    omittedPairCount: Math.max(0, pairs.length - 32),
    ambiguousTestFileCount,
    unmatchedTestFileCount,
    candidateLimitExceededTestFileCount
  }
}

function pairingKey(file, name) {
  const extension = file.path.split('.').at(-1)
  const language = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(extension) ? 'javascript'
    : ['java', 'kt'].includes(extension) ? 'jvm' : extension
  return moduleForPath(file.path) + '\0' + language + '\0' + name
}

function pairingDirectory(path) {
  return String(path).replaceAll('\\', '/').split('/').slice(0, -1)
    .filter(part => !['src', 'main', 'test', 'tests', '__tests__', 'app'].includes(part)).join('/')
}

function contractObservations(files) {
  const routeFiles = files.filter((file) => (file.routes ?? []).length > 0)
  const tableFiles = files.filter((file) => (file.tables ?? []).length > 0)
  return {
    routes: {
      status: routeFiles.length ? 'observed' : 'not-observed',
      count: routeFiles.reduce((total, file) => total + file.routes.length, 0),
      methods: [...new Set(routeFiles.flatMap((file) => file.routes.map((route) => route.method)))].sort(),
      examples: routeFiles.slice(0, MAX_EXAMPLES).map((file) => ({
        ...citation(file),
        routes: file.routes.slice(0, 16).map((route) => ({ method: route.method, path: route.path }))
      }))
    },
    tables: {
      status: tableFiles.length ? 'observed' : 'not-observed',
      names: [...new Set(tableFiles.flatMap((file) => file.tables))].sort().slice(0, 64),
      examples: tableFiles.slice(0, MAX_EXAMPLES).map((file) => ({
        ...citation(file),
        tables: file.tables.slice(0, 16)
      }))
    }
  }
}

function databaseObservations(files, migrationIndex) {
  const names = [
    'declaredQueries', 'nativeQueries', 'selectStarQueries', 'leadingWildcardLikes',
    'lockingQueries', 'pessimisticLocks', 'indexDeclarations', 'toOneAssociations',
    'defaultEagerToOneAssociations', 'collectionAssociations', 'joinFetches', 'entityGraphs',
    'transactionalAnnotations', 'readOnlyTransactions', 'modifyingQueries', 'bulkDmlQueries', 'paginatedFetchJoins'
  ]
  const totals = Object.fromEntries(names.map((name) => [
    name,
    files.reduce((sum, file) => sum + (Number.isSafeInteger(file.persistenceSignals?.[name]) ? file.persistenceSignals[name] : 0), 0)
  ]))
  const relevant = files.filter((file) => names.some((name) => (file.persistenceSignals?.[name] ?? 0) > 0))
  return {
    status: relevant.length ? 'observed' : 'not-observed',
    totals,
    reviewCandidates: {
      queryShape: totals.selectStarQueries + totals.leadingWildcardLikes,
      locking: totals.lockingQueries + totals.pessimisticLocks,
      nPlusOne: totals.defaultEagerToOneAssociations,
      indexCoverageUnknown: totals.declaredQueries > 0 && totals.indexDeclarations === 0 && (migrationIndex?.indexes?.length ?? 0) === 0,
      writeQueryWithoutObservedTransaction: Math.max(0, totals.modifyingQueries + totals.bulkDmlQueries - totals.transactionalAnnotations),
      lockWithoutObservedTransaction: Math.max(0, totals.lockingQueries + totals.pessimisticLocks - totals.transactionalAnnotations),
      paginationWithFetchJoin: totals.paginatedFetchJoins
    },
    examples: relevant.slice(0, MAX_EXAMPLES).map((file) => ({
      ...citation(file),
      signals: Object.fromEntries(names.filter((name) => (file.persistenceSignals?.[name] ?? 0) > 0).map((name) => [name, file.persistenceSignals[name]]))
    })),
    migrationIndex: migrationIndex ?? {
      status: 'not-observed', migrationFiles: 0, indexes: [], omittedIndexCount: 0,
      authority: { sourcePatternObservationOnly: true, databaseMetadataInspected: false, queryPlanExecuted: false }
    },
    authority: {
      sourcePatternObservationOnly: true,
      queryPlanExecuted: false,
      databaseMetadataInspected: false,
      nPlusOneConfirmed: false
    }
  }
}

export function compileProjectConventions(code = {}, migrationIndex = null) {
  const files = Array.isArray(code.files) ? code.files : []
  const production = files.filter(file => !(file.roles ?? []).includes('test'))
  const roles = [...new Set(files.flatMap(file => (file.roles ?? []).includes('test') ? ['test'] : file.roles ?? []))].sort()
  const transactionFiles = production.filter((file) => (file.annotations ?? []).includes('Transactional'))
  const persistenceFiles = production.filter((file) => (file.roles ?? []).some((role) => ['entity', 'repository'].includes(role)))
  return {
    schemaVersion: 1,
    status: files.length ? 'observed' : 'unknown',
    modules: [...new Set(files.map((file) => moduleForPath(file.path)))].sort(),
    layers: roles.map((role) => layerObservation(role, role === 'test' ? files : production)),
    transactions: {
      status: transactionFiles.length ? 'observed' : 'not-observed',
      roles: [...new Set(transactionFiles.flatMap((file) => file.roles ?? []).filter((role) => role !== 'test'))].sort(),
      examples: transactionFiles.slice(0, MAX_EXAMPLES).map(citation)
    },
    persistence: {
      status: persistenceFiles.length ? 'observed' : 'not-observed',
      roles: [...new Set(persistenceFiles.flatMap((file) => file.roles ?? []).filter((role) => ['entity', 'repository'].includes(role)))].sort(),
      examples: persistenceFiles.slice(0, MAX_EXAMPLES).map(citation)
    },
    contracts: contractObservations(production),
    database: databaseObservations(production, migrationIndex),
    tests: testPairing(files),
    authority: {
      deterministic: true,
      provenance: 'bounded-source-patterns',
      repeatedPatternIsDeclaredPolicy: false,
      providerClaimIsEvidence: false,
      verdictAuthority: false
    },
    limitations: files.length
      ? [
          'Observed patterns describe indexed source; they are not automatically team-declared blocker policy.',
          'Test pairs are unambiguous module/language/name hints, not proven coverage; ambiguous or over-128-candidate matches remain unpaired.',
          'Runtime wiring, reflection, generated code, dynamic SQL, and method-level semantics are not resolved.'
        ]
      : ['No indexed supported backend source was available; project conventions remain unknown.']
  }
}
