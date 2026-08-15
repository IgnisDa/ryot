# Legacy Bootstrap

- Read `README.md` before changing scope, mappings, omissions, report behavior, or restart semantics.
- Unexpected state must fail with `Error` or `RAISE EXCEPTION`. Silent skips are limited to restart guards and omissions documented in `README.md`.
- Keep this migration here. Do not change `kernel/backend/src/lib/infrastructure/db/migrate.ts` without prior discussion.
- Rename legacy tables before Drizzle creates V2 tables; copy data afterward.
- Write progress to `migration_report`. Anomalies also carry a stable `code` and write one `migration_report_detail` row per offending record; any warning whose code is not in `allowedWarningCodes` fails startup.
- Emit per-record detail set-based through `buildAnomalyReportSql`, or as bound parameters through `insertAnomalyReport`. Never interpolate legacy values into SQL text, and use `jsonb_build_object` rather than `jsonb_strip_nulls` so nullable report fields keep their keys.
- Abort messages state what was found with a bounded identifier sample, why it blocks the migration, and what the operator should do. A `RAISE EXCEPTION` rolls back its own block, so the message is the only channel.
- Legacy SQL uses quoted bare table names so `search_path` selects the schema. Never hardcode `public.`.
- Inline only controlled values through `quoteSqlString`; never inline user input.
- Normal E2E does not cover this shipped path. Do not add substitute tests; restore legacy dumps and follow the [validation runbook](./README.md#validation-runbook).
