# Advisory import graph Pack

This Pack creates a conservative Java/Kotlin file/type import graph. It records only explicit package and import statements that resolve to another indexed source type.

It deliberately does **not** guess method calls, Spring runtime wiring, reflection, SQL ownership, or change-based test selection. Every edge has `static-import-resolved` provenance. Unresolved imports, oversized sources, and imports made ambiguous by duplicate qualified type declarations are disclosed as coverage gaps instead of being linked arbitrarily.

The gate is an optional `observation`; graph success or failure never changes BTH PASS. Use it to navigate and ask better review questions, then prove behavior with required executed tests.
