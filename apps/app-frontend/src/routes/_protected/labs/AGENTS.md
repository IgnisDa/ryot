# Labs

This directory contains experimental UI prototypes. These are **not production code**.

## Rules

- Do not integrate real API calls. Interactive elements (buttons, actions) should `console.log` their intent.
- Mock data must align with backend schema shapes — match field names and types from the real models even if values are hardcoded. See `apps/app-backend/src/lib/db/schema/tables.ts` for the source of truth.
- Each prototype is a standalone route file. Do not extract shared components out of this directory.
- Files may exceed the normal 500-line limit — these are self-contained demos.

## Conventions

- Routes live at `/labs/<experiment>/<version>` (e.g. `/labs/media-overview/v6`).
- Versioned files (`v1.tsx`, `v2.tsx`, ...) are cumulative explorations. Do not delete old versions.
- Document any deliberate divergences from the real API contract in a comment block at the top of the file.
