# E2E Tests

**Parent Plan:** [Integrations](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Write E2E tests for everything introduced by this plan that can be verified against a live backend without external services (no Audiobookshelf, Komga, Radarr, Sonarr, Jellyfin, etc.). The test suite runs a real backend process against real Docker containers; no mocking.

Refer to the full PRD for feature contracts. Tests live in the `tests/` workspace. Follow the patterns in the existing test files: `bun:test`, `openapi-fetch` typed client, `createAuthenticatedClient()` fixture, `requireResponseData()` / `requirePresent()` helpers.

**Prerequisites:** All prior tasks (01–08) must be complete since these tests exercise the fully integrated system.

---

### 1. `tests/src/tests/integrations.test.ts` — new file

Cover the integration CRUD and webhook infrastructure:

**Integration CRUD:**
- `POST /api/integrations` creates with defaults (`minimumProgress = 2`, `maximumProgress = 95`, `isDisabled = false`, `syncOwnership = false`, `extraSettings.disableOnContinuousErrors = false`).
- `POST /api/integrations` validates `minimumProgress <= maximumProgress`.
- `POST /api/integrations` rejects if `provider !== providerSpecifics.kind`.
- `GET /api/integrations` returns only the authenticated user's integrations.
- `GET /api/integrations?provider=kodi&isDisabled=false` filters correctly.
- `GET /api/integrations/:id` returns full providerSpecifics and `webhookUrl` for Sink providers.
- `GET /api/integrations/:id` returns no `webhookUrl` for Yank providers.
- `PATCH /api/integrations/:id` updates name; omitted secret fields are preserved.
- `PATCH /api/integrations/:id` rejects threshold violations on update.
- `DELETE /api/integrations/:id` removes the integration.

**Import run visibility:**
- Create a Sink integration, POST a webhook payload, confirm `GET /api/imports` does NOT include the resulting run.
- Confirm `GET /api/imports/:id` with the run's ID succeeds.
- Confirm `GET /api/integrations/:id/runs` lists the run.

**Webhook routes:**
- `POST /_i/{unknownId}` returns 404.
- `POST /api/webhooks/integrations/{unknownId}` returns 404.
- `POST /_i/{validKodiIntegrationId}` with valid JSON body returns `202 { data: { runId } }`.
- `POST /api/webhooks/integrations/{validKodiIntegrationId}` returns `202 { data: { runId } }` (same behavior, different path).
- POST to a disabled integration returns `202` with a run whose status is `"failed"`.
- POST when `user.preferences.disableIntegrations = true` returns `202` with a failed run.
- POST with a non-Sink integration ID (e.g., a Yank integration) returns `400`.

**WebhookUrl derivation:**
- `GET /api/integrations/:id` for a Kodi integration returns `webhookUrl` matching `{frontendUrl}/_i/{id}`.
- `GET /api/integrations/:id` for an Audiobookshelf integration returns no `webhookUrl`.

---

### 2. Extensions to `tests/src/tests/collections.test.ts`

Add new `describe("collection events")` block:

- After `addToCollection`: `GET /api/events?entityId={collectionId}&eventSchemaSlug=add-entity-to-collection` returns one event with correct `properties.entityId`, `properties.entitySchemaSlug`, `properties.relationshipId`.
- Adding the same entity again (upsert, not first insert): confirm a second `add-entity-to-collection` event is **not** created.
- After `removeFromCollection`: `GET /api/events?entityId={collectionId}&eventSchemaSlug=remove-entity-from-collection` returns one event with correct properties.
- Removing an entity that was not in the collection: no `remove-entity-from-collection` event is created.

---

### 3. Extensions to `tests/src/tests/event-triggers.test.ts`

Add new `describe("before_create triggers")` block (generic, not integration-specific):

**Skip behavior:**
- Create a user-owned `before_create` trigger (pointing to a sandbox script that always returns `{ action: "skip", reason: "test_skip" }`) on a custom event schema.
- Create an event matching that schema.
- Assert the event is **not** present in `GET /api/events`.
- Assert the `createEvents` API response reflects the skip (count = 0, skipped array has one entry with the reason).

**Replace behavior:**
- Create a `before_create` trigger with a script that replaces `properties.value` with `999`.
- Create an event with `properties.value = 1`.
- Assert the persisted event has `properties.value = 999`.

**Fail-closed behavior:**
- Create a `before_create` trigger with a script that throws an error.
- Attempt to create an event.
- Assert the event was not created.
- Assert the API returns an error (not a 200 success).

**Position ordering:**
- Create two `before_create` triggers: `position = 100` (replaces `x = 1` with `x = 2`) and `position = 200` (replaces `x = 2` with `x = 3`).
- Create an event with `x = 1`.
- Assert the persisted event has `x = 3` (both transforms applied in order).

---

### 4. Fixtures additions (`tests/src/fixtures/integrations.ts`)

Add a new fixture file for integration helpers:

```ts
createIntegration(client, cookies, body)   // returns created integration
createKodiIntegration(client, cookies)     // convenience for a Kodi Sink integration
createAudiobookshelfIntegration(client, cookies) // convenience Yank integration
listIntegrations(client, cookies)
getIntegration(client, cookies, id)
deleteIntegration(client, cookies, id)
postWebhook(id, body)                      // raw fetch to /_i/:id, returns { response, data }
```

Export from `tests/src/fixtures/index.ts`.

---

### Scope limits

Do **not** attempt to test:
- Actual Yank adapter execution (requires live Audiobookshelf/Komga/Plex/YoutubeMusic).
- Push trigger HTTP calls (requires live Radarr/Sonarr/Jellyfin).
- The integration progress policy script's min/max/dedupe behavior (requires `origin: "integration"` which is only set during Yank/Sink job execution, not via the public API).
- YoutubeMusic two-phase caching (requires live YoutubeMusic API).

These behaviors are already covered by unit tests in tasks 05–07.

## Acceptance criteria

- [ ] `tests/src/tests/integrations.test.ts` exists and all tests pass.
- [ ] Integration CRUD create/list/get/patch/delete all tested.
- [ ] Threshold validation (min > max) is tested and returns an error.
- [ ] Provider/kind mismatch is tested and returns an error.
- [ ] Webhook route 404 tested for both `/_i/:id` and `/api/webhooks/integrations/:id`.
- [ ] Webhook route 202 with runId tested for valid Sink integration.
- [ ] Disabled integration webhook returns 202 with failed run.
- [ ] `disableIntegrations` preference webhook returns 202 with failed run.
- [ ] `GET /api/imports` excludes integration runs by default.
- [ ] `GET /api/imports/:id` allows fetching an integration-owned run.
- [ ] `GET /api/integrations/:id/runs` returns integration runs.
- [ ] `webhookUrl` present for Sink integrations, absent for Yank integrations.
- [ ] Collection add/remove events visible via `GET /api/events`.
- [ ] Second add-to-collection upsert does not emit a second event.
- [ ] Before-trigger skip prevents event creation; response reflects skip.
- [ ] Before-trigger replace modifies persisted event properties.
- [ ] Before-trigger failure is fail-closed: event not created, error returned.
- [ ] Two before-triggers run in ascending position order.
- [ ] `tests/src/fixtures/integrations.ts` fixture file exists and is exported from `fixtures/index.ts`.
- [ ] All tests pass via `bun test` in the `tests/` workspace.

## User stories addressed

- User story 5–12 (Sink integration creation and webhook URL)
- User story 17–21 (integration management)
- User story 24 (auto-disable — run history visible)
- User story 25–27 (run history visibility)
- User story 35–36 (disableIntegrations preference)
- User story 46–48 (before-trigger behavior, EventWriteContext)
