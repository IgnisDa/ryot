# Real Schema Migrations And Transaction Layer

**Parent Plan:** [App Backend Effect Migration](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Migrate the real current database schema, migration runner, Drizzle database layer, database error mapping, and transaction runner into the new Effect backend. The migrated schema must reflect the current product schema, not the reference backend schema. The migration path must remain compatible with production packaging.

Repositories should use Effect-returning database helpers that preserve PostgreSQL metadata and allow services to translate expected constraint failures into domain errors.

## Acceptance criteria

- [ ] The new backend uses the real current Drizzle schema and migration history
- [ ] The reference backend schema is not copied into the new app backend
- [ ] Migrations run from the production-compatible migration folder convention
- [ ] Database driver failures are mapped to typed database errors with useful PostgreSQL metadata
- [ ] A transaction runner supports short Effect transactions and preserves typed failures through rollback
- [ ] Backend check passes for the migrated database infrastructure

## User stories addressed

Reference by number from the parent PRD:

- User story 15
- User story 16
- User story 59
