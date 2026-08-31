# Advisory import graph Pack

This Pack creates a conservative Java/Kotlin/TypeScript/JavaScript/Python file import graph. JVM sources additionally record uniquely resolved declared type relationships. TypeScript, JavaScript, and Python edges are limited to explicit static module imports whose target resolves to exactly one project file. Backend-adjacent SQL, configuration, template, localization, and Markdown artifacts are represented as path-only nodes so impact ranking can find them without reading secret-prone configuration bodies such as `.env`.

It deliberately does **not** guess method calls, framework runtime wiring, reflection, SQL ownership, TypeScript path aliases that cannot be resolved uniquely, Python dynamic imports, or change-based test selection. Every import edge has `static-import-resolved` provenance. Unresolved imports, oversized sources, and ambiguous targets are disclosed as coverage gaps instead of being linked arbitrarily.

Test-name/path conventions also connect collocated tests and parallel nested
`<module>/tests/<relative>/test_name.py` ↔ `<module>/app/<relative>/name.py`
or `src`/module-root equivalents; ECMAScript `.test`/`.spec` names are supported.
The module prefix and relative directory must match, and exactly one existing
same-language production file must resolve. Multiple candidates remain unlinked
and appear in `ambiguousTestPaths`; no global basename matching is performed.
These `convention-test-path-resolved` edges help show production and its test
together. They are not measured runtime test coverage or a test-skipping rule.

The gate is an optional `observation`; graph success or failure never changes BTH PASS. Use it to navigate and ask better review questions, then prove behavior with required executed tests.

The on-demand graph uses the bundled indexer. An already installed project-owned
Pack and an older sealed graph are not silently replaced by a package upgrade.
Review the new Pack in a disposable project and regenerate the graph after the
team updates its declared Pack files; do not erase existing verification contracts.
