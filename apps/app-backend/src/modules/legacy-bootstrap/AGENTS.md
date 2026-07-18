# Legacy Bootstrap

- Read `README.md` before changing migration scope, field mappings, or intentional omissions.
- Fail on unexpected state with `Error` in TypeScript or `RAISE EXCEPTION` in PL/pgSQL. Silent skips are limited to restart-safe guards and omissions documented in `README.md`.
- Keep bootstrap logic in this module. Do not edit `src/lib/infrastructure/db/migrate.ts` without prior discussion.
- Rename legacy tables before Drizzle migrations; copy data after new tables exist.
- Prefer SQL for set-based work and TypeScript for orchestration.
- Never hardcode `public.` in legacy SQL; use quoted bare table names so PostgreSQL `search_path` selects schema.
- Inline only controlled values through `quoteSqlString`; never inline user input.
- Normal e2e does not cover this path. Verify changes by restoring legacy dumps and running `bun run run-migration` as documented in `README.md`.
