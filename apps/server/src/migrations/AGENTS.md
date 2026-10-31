# Legacy Bootstrap

This directory is a legacy exception.

- Read `README.md` before changing migration scope, mappings, omissions, reporting, or restart behavior.
- Fail unexpected state explicitly. Silent skips are limited to documented restart guards and omissions.
- Keep the migration here. Changes to `kernel/backend/src/platform/db/migrate.ts` require prior discussion.
- Use quoted bare legacy table names so `search_path` selects the schema. Never interpolate legacy user data into SQL.
- Keep anomaly reporting set-based or parameterized. Abort messages must explain the blocker and recovery because their SQL block rolls back.
- Validate with restored legacy dumps using the README runbook, not substitute tests or normal e2e coverage.
