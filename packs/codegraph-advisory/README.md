# Advisory import graph Pack

This Pack creates a conservative Java/Kotlin/TypeScript/JavaScript/Python file import graph. JVM sources additionally record uniquely resolved declared type relationships. TypeScript, JavaScript, and Python edges are limited to explicit static module imports whose target resolves to exactly one project file. Backend-adjacent SQL, configuration, template, localization, and Markdown artifacts are represented as path-only nodes so impact ranking can find them without reading secret-prone configuration bodies such as `.env`.

It deliberately does **not** guess method calls, framework runtime wiring, reflection, SQL ownership, TypeScript path aliases that cannot be resolved uniquely, Python dynamic imports, or change-based test selection. Every import edge has `static-import-resolved` provenance. Unresolved imports, oversized sources, and ambiguous targets are disclosed as coverage gaps instead of being linked arbitrarily.

The gate is an optional `observation`; graph success or failure never changes BTH PASS. Use it to navigate and ask better review questions, then prove behavior with required executed tests.
