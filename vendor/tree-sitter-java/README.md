# Pinned Java grammar (WASM only)

Unmodified `tree-sitter-java.wasm` from npm `tree-sitter-java@0.23.5`.
Source: [tree-sitter/tree-sitter-java at 94703d5](https://github.com/tree-sitter/tree-sitter-java/tree/94703d5a6bed02b98e438d7cad1136c01a60ba2c).
The adjacent MIT license is reproduced unchanged.

- WASM bytes: 414641
- WASM SHA-256: `4fdeac4ca6ca089f06c6f7e562abcac1733cd465728cc7031ebb73c2019122c4`
- npm tarball integrity: `sha512-Yju7oQ0Xx7GcUT01mUglPP+bYfvqjNCGdxqigTnew9nLGoII42PNVP3bHrYeMxswiCRM0yubWmN5qk+zsg0zMA==`

Only the portable grammar is vendored. BTH uses pinned `web-tree-sitter` to load
it; no native addon, C++ compiler, Java compiler, Docker or install hook is used.
The runtime checks this hash before loading. Installation smoke tests execute a
real parse from the packed installation and run its dependency audit.

To update, download the exact upstream npm tarball with `npm pack --ignore-scripts`,
verify its integrity, extract only the WASM and license into a task-owned temp
directory, compare the source/version/license, then deliberately replace these
assets and update the pinned hash plus preservation tests. Never auto-download
grammar code during a user's implementation or inspection run.
