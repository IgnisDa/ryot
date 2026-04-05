# OpenScale Import Tracer Bullet

**Parent Plan:** [V2 Importing Infrastructure](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Build the smallest complete V2 import pipeline using OpenScale as the tracer bullet. This slice should prove the new import module, queue, run/failure tables, import API, source-specific validation, safe temporary file reading, status/progress updates, item-level failures, cleanup, and user-owned measurement entity creation.

Implement the uniform measurement schema from the parent PRD section "Measurements" before importing OpenScale rows. Measurements are user-owned `measurement` entities with `recordedAt`, optional `comment`, and required `statistics` array. There is no special first-class `weight`; OpenScale maps every non-empty statistic, including weight, into `statistics` with normalized `snake_case` keys and stored labels.

This slice should not add app-client import UI. It should update measurement schema tests, saved-view defaults, and E2E fixtures/tests under `tests/src` as required by the new measurement contract.

## Acceptance criteria

- [ ] New `import_run` and `import_run_failure` tables exist with the columns, indexes, cascade behavior, and app-level text enum typing described in the parent PRD.
- [ ] A dedicated `import` BullMQ queue and worker are registered in queue setup, worker lifecycle, and runtime startup/shutdown.
- [ ] Import routes exist: `POST /imports/runs`, `GET /imports/runs`, `GET /imports/runs/:id`, `GET /imports/runs/:id/failures`, and `DELETE /imports/runs/:id`.
- [ ] `POST /imports/runs` validates a discriminated OpenScale input, creates a pending run row, enqueues the job, and returns `{ id }`.
- [ ] The worker moves runs through `pending` to `running` to `completed` or `failed`, with `createdAt`, `startedAt`, `finishedAt`, progress, and counters updated according to the parent PRD.
- [ ] Source/auth/file-level catastrophic failures mark the run `failed`; item parse failures create failure rows and allow the run to complete.
- [ ] Failure rows include user-facing `sourceLabel`/`sourceIdentifier`/`message`/`stage`/`context` suitable for manual recovery without raw file rows, secrets, or temp paths.
- [ ] Temporary upload paths are validated inside the configured temp upload directory, extension checks are enforced, file reads go through import file helpers, and worker-owned cleanup runs best-effort in `finally`.
- [ ] The measurement built-in schema uses `statistics` uniformly and no longer has special `weight` behavior.
- [ ] The All Measurements saved view sorts by `recordedAt desc` and uses `recordedAt`/`comment` defaults rather than `weight`.
- [ ] OpenScale CSV rows create user-owned measurement entities named from `recordedAt`, preserving every non-empty source statistic in `statistics`.
- [ ] Measurement E2E tests and fixtures under `tests/src` are updated for the uniform statistics schema and saved-view defaults.
- [ ] Backend unit tests cover import run status transitions, counters, failure rows, file helper path safety, extension validation, read limits, and cleanup behavior.
- [ ] An E2E test covers the full OpenScale import flow through public API routes.

## User stories addressed

Reference by number from the parent PRD:

- User story 1
- User story 2
- User story 3
- User story 4
- User story 5
- User story 15
- User story 16
- User story 17
- User story 22
- User story 23
- User story 24
- User story 29
