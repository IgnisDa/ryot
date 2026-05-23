# Integrations CRUD, Scheduling, and Webhook Infrastructure

**Parent Plan:** [Integrations](./README.md)

**Type:** AFK

**Status:** done

## What to build

The core integrations module: REST CRUD endpoints, BullMQ repeat-job scheduler, webhook route infrastructure, and user preference enforcement. No provider-specific adapter logic lives here — that is tasks 05 and 06. This task delivers a working integrations API that agents in tasks 05/06 can build on.

Refer to the **Integrations Module API**, **Validation Defaults and Rules**, **Yank Integrations — Scheduling**, **Integration Module File Structure**, and **Import Run Filtering** sections of the parent PRD.

**Prerequisite:** Task 01 (DB schema, config, user preferences schema).

---

### 1. Module scaffold

Create `src/modules/integrations/` with the following files:

```
index.ts
schemas.ts
repository.ts
service.ts
routes.ts
jobs.ts
worker.ts
scheduler.ts
providers/
  yank/       (empty placeholder directories for tasks 05/06)
  sink/
  shared/
```

Register the integrations routes in `src/app/api.ts` under `/api/integrations`. Register `/_i/:id` at root level in `src/app/server.ts`.

### 2. Provider specifics — discriminated union

In `schemas.ts`, define all 13 provider-specific Zod schemas as strict (`.strict()`) discriminated unions keyed on `kind`. Use camelCase field names. Exact field names and types are in the PRD's **Provider Specifics — Discriminated Union** section. Notable rules:

- `sonarr.tagIds` is `z.number().int().optional()` (single integer, not array — preserves V1 shape).
- `radarr.tagIds` is `z.array(z.number().int()).optional()`.
- All schemas use `.strict()` — no extra fields allowed.

Export `integrationProviderSpecifics = z.discriminatedUnion("kind", [...all 13 schemas...])`.

### 3. Integration request/response schemas

In `schemas.ts`:

- `createIntegrationBody`: `{ provider, name?, isDisabled?, syncOwnership?, minimumProgress?, maximumProgress?, extraSettings?, providerSpecifics }` — on create, `providerSpecifics.kind` must equal `provider`.
- `patchIntegrationBody`: all fields optional. On patch, if `providerSpecifics` is supplied it must be valid for the provider after merging with existing.
- `listedIntegration`: integration row including `webhookUrl?: string` derived for Sink providers, full `providerSpecifics`.
- `createIntegrationRunsResponse`: pagination of `import_run` rows.

### 4. Repository

In `repository.ts`, implement:

- `createIntegration(input)` → integration row
- `getIntegrationById(id, userId)` → integration | undefined
- `listIntegrationsByUser(userId, filters?: { provider?, isDisabled? })` → integration[]
- `updateIntegration(id, userId, patch)` → integration
- `deleteIntegration(id, userId)` → void
- `listIntegrationRuns(integrationId, userId)` → import_run rows ordered by `createdAt desc`
- `listAllEnabledYankIntegrations()` → all enabled yank integrations across all users (for scheduler reconciliation)

### 5. Service

In `service.ts`:

**Create:**
- Apply defaults: `minimumProgress = 2`, `maximumProgress = 95`, `isDisabled = false`, `syncOwnership = false`, `extraSettings.disableOnContinuousErrors = false`.
- Validate `0 <= minimumProgress <= maximumProgress <= 100`.
- Validate `providerSpecifics.kind === provider`.
- Validate strict per-provider schema.
- Insert row.
- If Yank integration and not disabled: add BullMQ repeat job (delegate to scheduler).

**Patch:**
- Load existing integration (404 if not found or not owned).
- Merge `providerSpecifics` fields: omitted fields preserve existing secrets. If providerSpecifics supplied, validate final merged object against strict provider schema.
- Re-validate progress thresholds.
- Update row.
- Reschedule: if Yank lot, update repeat job (remove and re-add if schedule or enabled state changes).

**Delete:**
- Delete row (cascade removes import_run history and repeat job via scheduler).
- Remove BullMQ repeat job if Yank.

**Derive webhook URL:**
- For Sink integrations: `${config.frontendUrl}/_i/${integration.id}`.

**Auto-disable check** (called by Yank/Sink workers after each run):
```ts
checkAndAutoDisable(integrationId: string, userId: string): Promise<void>
```
- Load the last 5 `import_run` rows for this integration ordered by `createdAt desc`.
- If `extraSettings.disableOnContinuousErrors === true` and all 5 are `status = "failed"`: set `isDisabled = true`, remove repeat job.
- Otherwise: no-op.

### 6. Routes

In `routes.ts`, register OpenAPI routes:

- `GET /api/integrations` — list user's integrations. Supports `?provider=` and `?isDisabled=` query params (for push trigger scripts). Returns full `providerSpecifics` including secrets. Auth required.
- `POST /api/integrations` — create integration.
- `GET /api/integrations/:id` — get single integration with `webhookUrl` for Sink.
- `PATCH /api/integrations/:id` — update integration.
- `DELETE /api/integrations/:id` — delete integration and history.
- `GET /api/integrations/:id/runs` — list import runs for this integration.

Webhook routes:
- `POST /api/webhooks/integrations/:integrationId` — OpenAPI route under the `/api` prefix.
- `POST /_i/:integrationId` — mounted at root in `server.ts`, delegates to same handler as above.

Webhook handler (shared):
1. Look up integration by ID (no auth required — ID is the credential).
2. If not found: return `404`.
3. If integration is not Sink lot: return `400`.
4. Check `user.preferences.disableIntegrations`:
   - If true: create `import_run`, mark failed with `source_fetch` failure, return `202 { data: { runId } }`.
5. If integration `isDisabled`:
   - Create `import_run`, mark failed with `source_fetch = "Integration is disabled"`, return `202 { data: { runId } }`.
6. Create `import_run` with `integrationId`, `source = integration.provider`, `status = "pending"`.
7. Enqueue sink job on `import` queue.
8. Return `202 { data: { runId } }`.

The webhook handler reads raw request body as text and `Content-Type` header, storing both in job data for provider parsers to consume.

### 7. Jobs and worker scaffold

In `jobs.ts`, define the integration job schema:

```ts
integrationRunJobData = z.object({
  runId: z.string(),
  userId: z.string(),
  integrationId: z.string(),
  // Sink only:
  rawBody: z.string().optional(),
  contentType: z.string().optional(),
})
```

In `worker.ts`, create a worker on the existing `import` queue that processes `"integration-run"` job names. The worker validates job data and then delegates to:
- Yank adapter (task 05) if `integration.lot === "yank"`.
- Sink parser (task 06) if `integration.lot === "sink"`.

The worker skeleton for tasks 05/06 to fill in can be a switch or `match` on `integration.lot`. It should handle: load integration from DB, check `disableIntegrations` preference (no-op for yank), call the appropriate handler, update `import_run`, check auto-disable.

Register the integration worker in `src/lib/queue/workers.ts` alongside existing workers.

### 8. Scheduler

In `scheduler.ts`, implement `reconcileIntegrationScheduler()`:

1. Parse `config.scheduler.frequentCronJobsSchedule` using `english-to-cron` npm package to produce a standard cron expression.
2. List all BullMQ repeat jobs from the `import` queue whose job IDs start with `"yank-"`.
3. Load all enabled Yank integrations from DB via `listAllEnabledYankIntegrations()`.
4. For each enabled integration: if no matching repeat job exists (or schedule differs), add/replace repeat job with `jobId = "yank-{integrationId}"`.
5. For each existing repeat job: if integration is not found in enabled list (deleted, disabled, lot changed), remove the repeat job.

Call `reconcileIntegrationScheduler()` from `src/app/runtime.ts` after `initializeWorkers()` and before `dispatchBuiltinEntityPreloadJobs()`.

Add `english-to-cron` as an exact-version dependency: `bun add -E english-to-cron` in `apps/app-backend`.

### 9. Import run listing changes

In `src/modules/imports/repository.ts`, update `listImportRunsByUser` to filter `WHERE integrationId IS NULL` by default. This keeps integration runs out of the main imports list. `getImportRunById` remains unchanged — if the user owns the run, they can fetch it regardless of `integrationId`.

In `src/modules/imports/routes.ts`, ensure the list endpoint does not expose `integrationId IS NOT NULL` runs without a flag (no new query param needed — just enforce the default filter).

### 10. User preference enforcement in scheduler

In the Yank worker (when implemented in task 05), check `user.preferences.disableIntegrations` and no-op without creating an `import_run` if true.

In the webhook handler (this task), check preference and create a failed `import_run` if true (already described in step 6 above).

## Acceptance criteria

- [x] `GET /api/integrations` returns the authenticated user's integrations including derived `webhookUrl` for Sink providers.
- [x] `GET /api/integrations?provider=radarr&isDisabled=false` filters correctly.
- [x] `POST /api/integrations` creates an integration with defaults applied, validates progress thresholds, and validates `providerSpecifics.kind === provider`.
- [x] `PATCH /api/integrations/:id` preserves omitted secret fields, validates merged providerSpecifics.
- [x] `DELETE /api/integrations/:id` removes the integration and cascades to import_run rows.
- [x] `GET /api/integrations/:id/runs` returns only runs for that integration.
- [x] `POST /api/webhooks/integrations/:id` and `POST /_i/:id` both return `202 { data: { runId } }` for valid Sink integrations.
- [x] Both webhook routes return `404` for unknown integration IDs.
- [x] Both webhook routes return `202` with a failed run for disabled integrations.
- [x] Both webhook routes return `202` with a failed run when `user.preferences.disableIntegrations = true`.
- [x] `GET /imports` (main list) excludes integration-triggered runs by default.
- [x] `GET /imports/:id` allows fetching an integration-owned run if the user owns it.
- [x] `reconcileIntegrationScheduler()` is called at startup in the correct position.
- [x] Creating a Yank integration adds a BullMQ repeat job; disabling removes it; deleting removes it.
- [x] `english-to-cron` is a pinned dependency in `apps/app-backend/package.json`.
- [x] Integration service unit tests cover: defaults, threshold validation, kind/provider mismatch, auto-disable trigger (5 consecutive failures).

## User stories addressed

- User story 17 (see webhook URL for Sink integrations)
- User story 18 (short and full webhook URL forms)
- User story 19 (name integrations)
- User story 20 (pause integration without deleting)
- User story 21 (delete integration)
- User story 24 (auto-disable after 5 consecutive failures)
- User story 25 (run history per integration)
- User story 26 (manual imports list stays clean)
- User story 27 (fetch specific integration run by ID)
- User story 35 (disable all integrations via preference)
- User story 36 (preference disables both scheduling and webhook acceptance)
- User story 37 (configure Yank polling schedule via env)
