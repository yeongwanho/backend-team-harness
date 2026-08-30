# Changelog

This project follows Semantic Versioning after 1.0. Before 1.0, every incompatible CLI or stored-contract change is called out explicitly.

## Unreleased

### Added

- `bth work` source-bound plan and isolated implementation flow.
- Explicit, sealed, rollback-capable `bth implement apply`.
- Source-cited convention compilation and MySQL/JPA review signals.
- Changed-path feedback Gates followed by conservative full verification.
- Normalized provider token, cost, duration, and turn telemetry.
- Coverage thresholds, mutation smoke, package install smoke, and CLI documentation contract tests.
- Explicit schema v1 to v2 implementation-config migration with backup.

### Changed

- Provider implementation now preserves observed adjacent project conventions even on small CRUD work.
- Shared records redact additional provider tokens, auth/cookie material, email addresses, and raw source-bearing fields.

### Compatibility

- Schema v1 command adapters remain readable.
- `--allow-network` remains a deprecated alias for `--acknowledge-network-risk` during the pre-1.0 compatibility window.
- No command in this release automatically commits, pushes, deploys, or accesses a production database.
