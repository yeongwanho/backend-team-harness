# Database policy

## Migration policy

- Migrations are append-only after release.
- Record data backfill and rollback expectations.
- Review transaction boundaries, indexes, and locking risk.

## Database dialect

- A project with migrations declares the database dialect used by executable verification.
- Never connect to production by default.
