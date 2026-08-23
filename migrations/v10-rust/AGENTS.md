# Legacy Bootstrap

- Read `README.md` before changing scope, mappings, omissions, report behavior, or restart semantics.
- Unexpected state must fail with `Error` or `RAISE EXCEPTION`. Silent skips are limited to restart guards and omissions documented in `README.md`.
- Keep this migration here. Do not change `kernel/backend/src/lib/infrastructure/db/migrate.ts` without prior discussion.
- Rename legacy tables before Drizzle creates V2 tables; copy data afterward.
- Write progress and anomalies to `migration_report`; any undocumented warning fails startup.
- Legacy SQL uses quoted bare table names so `search_path` selects the schema. Never hardcode `public.`.
- Inline only controlled values through `quoteSqlString`; never inline user input.
- Normal E2E does not cover this shipped path. Do not add substitute tests; restore legacy dumps and follow the [validation runbook](./README.md#validation-runbook).
