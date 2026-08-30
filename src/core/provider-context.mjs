const LIMITS = Object.freeze({
  fast: { examples: 1, pairs: 2, impactPaths: 2, packages: 2 },
  balanced: { examples: 2, pairs: 4, impactPaths: 4, packages: 4 },
  deep: { examples: 4, pairs: 8, impactPaths: 8, packages: 8 }
})

function rankedSelection(values, maximum, score) {
  return (values ?? []).map((value, index) => ({ value, index, score: score(value) }))
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .slice(0, maximum).map((entry) => entry.value)
}

function pathRanker(entries) {
  const ranks = new Map((entries ?? []).map((entry, index) => [entry.path, index]))
  return (path) => ranks.get(path) ?? Number.MAX_SAFE_INTEGER
}

function compactExamples(group, limit, rank, omissions) {
  if (!group || !Array.isArray(group.examples)) return group
  const selected = rankedSelection(group.examples, limit, (example) => rank(example.path))
  omissions.examples += group.examples.length - selected.length
  return { ...group, examples: selected, omittedProviderExampleCount: group.examples.length - selected.length }
}

function compactImpact(impact, maximum) {
  if (!impact) return impact
  const boundedPaths = (group) => group && ({
    ...group,
    paths: (group.paths ?? []).slice(0, maximum),
    omitted: (group.omitted ?? 0) + Math.max(0, (group.paths ?? []).length - maximum)
  })
  return {
    ...impact,
    seedPaths: (impact.seedPaths ?? []).slice(0, maximum),
    omittedProviderSeedPaths: Math.max(0, (impact.seedPaths ?? []).length - maximum),
    dependencies: boundedPaths(impact.dependencies),
    dependents: boundedPaths(impact.dependents)
  }
}

// This is a model-facing projection, not a new source of policy. It retains all
// declared rules, approval text, entry ranking, and authority boundaries while
// limiting redundant source-pattern examples. Full observations remain in the
// source-bound interview snapshot used to construct projectConventions.
export function selectProviderContext(codeContext, projectConventions, mode) {
  const limits = LIMITS[mode]
  if (!limits) throw new Error('Unknown provider context mode: ' + mode)
  const rank = pathRanker(codeContext?.entries)
  const omissions = { examples: 0, testPairs: 0, packages: 0 }
  const conventions = projectConventions ? structuredClone(projectConventions) : projectConventions
  if (conventions?.discovered) {
    const observed = conventions.discovered
    const neighborhoods = (codeContext?.entries ?? []).map(entry => '.' + entry.path.replaceAll('/', '.') + '.')
    observed.layers = (observed.layers ?? []).map((layer) => {
      const compacted = compactExamples(layer, limits.examples, rank, omissions)
      if (!Array.isArray(layer.packages)) return compacted
      const packages = rankedSelection(layer.packages, limits.packages, pkg => {
        const index = neighborhoods.findIndex(path => path.includes('.' + pkg + '.'))
        return index < 0 ? Number.MAX_SAFE_INTEGER : index
      })
      const omitted = layer.packages.length - packages.length
      omissions.packages += omitted
      return { ...compacted, packages, omittedProviderPackageCount: omitted }
    })
    for (const key of ['transactions', 'persistence', 'database']) {
      observed[key] = compactExamples(observed[key], limits.examples, rank, omissions)
    }
    for (const key of ['routes', 'tables']) {
      if (observed.contracts?.[key]) {
        observed.contracts[key] = compactExamples(observed.contracts[key], limits.examples, rank, omissions)
      }
    }
    if (observed.tests) {
      const pairs = observed.tests.pairs ?? []
      const selected = rankedSelection(pairs, limits.pairs, (pair) => Math.min(rank(pair.production), rank(pair.test)))
      omissions.testPairs = pairs.length - selected.length
      observed.tests = {
        ...observed.tests,
        pairs: selected,
        omittedPairCount: (observed.tests.omittedPairCount ?? 0) + omissions.testPairs
      }
    }
  }
  const context = codeContext ? structuredClone(codeContext) : codeContext
  if (context) {
    // Convergence telemetry and global graph sizes help algorithm audits, not
    // implementation. Ranked entries and their source provenance stay intact.
    delete context.algorithm
    delete context.graph
    delete context.query
    if (context.impact) context.impact = compactImpact(context.impact, limits.impactPaths)
  }
  if (conventions) {
    conventions.providerProjection = {
      schemaVersion: 1,
      mode,
      declaredRulesPreserved: true,
      examplesPerGroup: limits.examples,
      testPairLimit: limits.pairs,
      omittedExamples: omissions.examples,
      omittedTestPairs: omissions.testPairs,
      packagesPerLayer: limits.packages,
      omittedPackages: omissions.packages,
      fullObservationSource: conventions.discovered?.status === 'observed' ? 'approved-interview-context-snapshot' : null
    }
  }
  return { codeContext: context, projectConventions: conventions }
}
