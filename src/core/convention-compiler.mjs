const MAX_EXAMPLES = 8
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
  const marker = normalized.indexOf('/src/')
  return marker <= 0 ? 'root' : normalized.slice(0, marker)
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
    for (const declaration of file.declarations ?? []) {
      if (isTest) {
        const base = declaration.name.replace(/(?:IntegrationTest|Tests|Test|IT)$/, '')
        if (base && base !== declaration.name) tests.push({ base, path: file.path, contentSha256: file.contentSha256 ?? null })
      } else {
        production.set(declaration.name, { path: file.path, contentSha256: file.contentSha256 ?? null })
      }
    }
  }
  const pairs = tests.flatMap((test) => {
    const source = production.get(test.base)
    return source ? [{ production: source.path, productionSha256: source.contentSha256, test: test.path, testSha256: test.contentSha256 }] : []
  }).sort((left, right) => left.production.localeCompare(right.production) || left.test.localeCompare(right.test))
  return {
    status: pairs.length ? 'observed' : 'not-observed',
    pairs: pairs.slice(0, 32),
    omittedPairCount: Math.max(0, pairs.length - 32)
  }
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
  const roles = [...new Set(files.flatMap((file) => file.roles ?? []))].sort()
  const transactionFiles = files.filter((file) => (file.annotations ?? []).includes('Transactional'))
  const persistenceFiles = files.filter((file) => (file.roles ?? []).some((role) => ['entity', 'repository'].includes(role)))
  return {
    schemaVersion: 1,
    status: files.length ? 'observed' : 'unknown',
    modules: [...new Set(files.map((file) => moduleForPath(file.path)))].sort(),
    layers: roles.map((role) => layerObservation(role, files)),
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
    contracts: contractObservations(files),
    database: databaseObservations(files, migrationIndex),
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
          'Runtime wiring, reflection, generated code, dynamic SQL, and method-level semantics are not resolved.'
        ]
      : ['No indexed Java/Kotlin source was available; project conventions remain unknown.']
  }
}
