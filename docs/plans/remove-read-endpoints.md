# Remove User-Facing Read Endpoints

## Status

Proposed implementation plan.

## Summary

RyotQL is now the application's focused relational read API. The backend still exposes domain-specific HTTP read endpoints that select application rows, apply overlapping authorization rules, return broad domain objects, and maintain separate contracts and tests. These endpoints should be removed so authenticated callers execute application-owned RyotQL documents directly.

This change does not make RyotQL a universal RPC, metadata, workflow, streaming, file, administrative, or test API. Explicit endpoints remain for operations that are not ordinary user-facing relational reads.

The target invariant is:

> `POST /ryotql/execute` is the only authenticated HTTP endpoint for user-facing relational reads. Operational, metadata, streaming, administrative, test-support, and command APIs remain explicit.

Implementation must proceed in complete vertical slices. Each slice adds or updates the catalog and recipe, colocates the result schema and decoder, migrates production and test consumers, and deletes the replaced endpoint. Do not leave a domain GET endpoint as a backend wrapper around a RyotQL recipe.

## Why We Are Doing This

RyotQL already provides the relational behavior required by application reads:

- A backend-owned catalog of safe tables and fields.
- User and pinned-plugin visibility applied to every table occurrence.
- Named queries executed in one repeatable-read, read-only transaction.
- Focused projections instead of broad domain payloads.
- Filtering, joins, includes, aggregates, time series, ordering, and pagination.
- Localized entity fields and runtime field kinds.
- Plain serializable query documents and reusable application-owned recipes.

Keeping parallel read endpoints undermines those benefits:

- Authorization and filtering rules remain distributed across services and repositories.
- Every endpoint adds contract, route, service, response, client, and test maintenance.
- Broad response schemas couple clients to fields they do not use.
- Some endpoint implementations already invoke RyotQL internally, creating an unnecessary HTTP API over another read API.
- Unbounded list endpoints preserve semantics that conflict with RyotQL's explicit limits.
- New application tables could continue accumulating bespoke list and detail endpoints instead of using the catalog.

The project is greenfield. There is no compatibility period or persisted-client migration requirement. Old read contracts can be deleted after their active consumers move.

## Goals

- Make RyotQL the only authenticated HTTP surface for user-facing relational reads.
- Remove the selected list and detail operations from `@ryot/contract` and `app-backend`.
- Migrate active application and test consumers to expanded RyotQL documents.
- Add only the catalog tables and fields required by the removed behavior.
- Keep every catalog field independently safe for raw query documents.
- Standardize recipe-owned Effect Schema result codecs.
- Require explicit pagination for collection reads.
- Preserve explicit APIs for metadata, operations, streams, administration, and tests.
- Keep internal repository reads used by mutations, workflows, and transactions.

## Non-Goals

- Routing all backend database access through RyotQL.
- Replacing repository reads used by mutation validation or transactional business logic.
- Querying in-memory registries, runtime configuration, Redis, workflow state, files, or streams through RyotQL.
- Adding anonymous, admin, god-mode, kernel, or test-support RyotQL execution scopes.
- Exposing auth, account, API key, sandbox source, compiled source, workflow reference, or secret-bearing tables to normal users.
- Preserving old endpoint response envelopes or unbounded-list behavior.
- Adding server-registered recipe names.
- Adding compatibility endpoints that invoke recipes internally.
- Updating, deleting, or making repository-wide verification pass for `apps/app-client-backup`.
- Refactoring endpoint-only entity and event result decoders before deleting them.

## Endpoint Boundary

### Endpoints To Retain

These operations are outside the user-facing relational read boundary and remain explicit.

| Group | Operation | Reason |
| --- | --- | --- |
| `system` | `health` | Runtime database and Redis health probe. |
| `system` | `config` | Public in-memory application configuration. |
| `definitions` | `listEntities` | Definition registry metadata plus provider metadata. |
| `definitions` | `listRelationships` | Definition registry metadata. |
| `definitions` | `listPlugins` | Plugin metadata API with per-user configuration; retained as an explicit metadata exception. |
| `automations` | `listCatalog` | Signal-schema registry metadata. |
| `automations` | `getCatalog` | Signal-schema registry metadata. |
| `entityImport` | `getImportResult` | Durable workflow execution status. |
| `uploads` | `resolveDownloads` | Redis-backed metadata and signed URL generation. |
| `localUploads` | `download` | Signature-authorized file streaming. |
| `localUploads` | `downloadHead` | Signature-authorized file metadata. |
| `entityInterest` | `stream` | SSE over in-memory registration and Redis pub/sub. |
| `plugins` | `list` | Administrative plugin-management read. |
| `godMode` | `listUsers` | Administrative auth-table read. |
| `testSupport` | all read operations | Privileged integration-test inspection. |

Plugin invocation, entity-interest declaration, webhooks, mutations, and workflows also remain explicit commands even when they read data while executing.

### Endpoints To Remove

| Group | Operation | Replacement |
| --- | --- | --- |
| `entities` | `get` | Direct entity RyotQL document. |
| `events` | `list` | Paginated event RyotQL document. |
| `savedViews` | `list` | Saved-view record recipe and decoder. |
| `savedViews` | `get` | Saved-view-by-slug recipe and decoder. |
| `notifications` | `listChannels` | Safe notification-channel recipe and decoder. |
| `integrations` | `list` | Paginated integration recipe and decoder. |
| `integrations` | `get` | Integration-by-id recipe and decoder. |
| `integrations` | `getRuns` | Import-run recipe filtered by integration ID. |
| `imports` | `listRuns` | Paginated import-run recipe and decoder. |
| `imports` | `getRun` | Named run and paginated failure queries. |
| `automations` | `listRules` | Notification-subscription-state recipe plus retained catalog metadata. |
| `automations` | `getRule` | Notification-subscription-state-by-id recipe plus retained catalog metadata. |

Removing a read operation does not imply deleting its complete contract group. Mutation and command operations in the group remain.

## Architectural Rules

### Direct HTTP Execution

Production HTTP callers send expanded documents to `ryotql.execute`. Do not retain a domain GET route whose handler invokes `RyotQLService` with a recipe. That would preserve two HTTP read APIs and an unnecessary internal hop.

Backend-owned RyotQL execution remains valid for internal workflows with a concrete need, including entity-interest reconciliation and pinned-plugin sandbox execution.

### Recipe Ownership

Application-owned fixed queries belong in `@ryot/ryotql-recipes`. Each fixed recipe must colocate:

- Its document builder.
- Its wire result Effect Schema.
- Its decoded application type derived from the schema.
- Its decoder or mapping function.
- Focused recipe and decoder tests.

Consumers must not inspect generic `RowItem` values or manually test field kinds. Reusable wire codecs remain in `@ryot/contract`. Presentation-only transformations remain with the presentation consumer.

Persisted saved-view documents are dynamic documents rather than fixed recipes. Their generic result rendering remains consumer-owned and is not forced into a fixed result schema.

Do not introduce a recipe registration framework, generic recipe interface, universal decoder abstraction, or mirrored result type hierarchy.

### Catalog Safety

Recipes are not a security boundary. The HTTP contract accepts raw structurally valid documents, so every registered table and field must be safe when queried directly.

For every new table:

- Define user visibility before adding fields.
- Apply visibility to every root, join, include, and correlated query occurrence.
- Omit ownership columns unless a concrete user-facing query needs them.
- Omit credentials, hashes, internal claims, private configuration, and unrestricted JSON containing secrets.
- Add backend-derived safe fields when callers need a sanitized representation.
- Test unknown and hidden field rejection.
- Test isolation from another user's rows through roots, joins, includes, and correlated queries.

Never expose a secret-bearing physical JSON column and rely on a recipe to avoid selecting it.

### Pagination

Collection recipes require explicit `page` and `limit` inputs. Do not recreate unbounded array endpoints by looping through every RyotQL page in a service or client helper.

Detail recipes use a limit of one and represent absence as an empty rows result. Callers that need domain-specific not-found presentation derive it from that result. RyotQL does not recreate endpoint-specific `NotFound` responses.

The root limit remains capped at 100. Includes remain capped at 100. A consumer that needs more data requests subsequent pages.

### Metadata Composition

Definition and automation catalog data remain explicit metadata APIs. Relational recipes return discriminator slugs and state. Consumers combine those values with retained metadata when names, icons, property schemas, or catalog descriptions are needed.

Do not persist registry data or add virtual in-memory RyotQL tables as part of this work.

### Internal Reads

Repositories continue to own persistence reads used by:

- Mutation validation.
- Authorization checks required before writes.
- Transactional locks and conflict checks.
- Workflow orchestration.
- Internal delivery and processing.
- Mutation response construction.

Only remove a repository or service method after a usage search proves it existed solely for a deleted read endpoint.

## Catalog Additions

The implementation agent must use existing catalog helpers and add no field without a concrete recipe or migrated test consumer.

### Notification Channel

Add a user-owned `notificationChannel` table entry.

Public fields:

- `id`
- `channel`
- `description`
- `isDisabled`
- `createdAt`
- `updatedAt`

`description` must be a backend-derived safe field with behavior equivalent to the current masked client description. The physical `channel_specifics` JSON must remain hidden because it contains credentials and endpoints. If reproducing a useful masked description safely in SQL is not reasonable, narrow the replacement result instead of exposing raw specifics. Update the current client presentation accordingly.

### Integration

Add a user-owned `integration` table entry only with client-safe fields.

Public fields:

- `id`
- `lot`
- `name`
- `provider`
- `pluginSlug`
- `isDisabled`
- `syncOwnership`
- `minimumProgress`
- `maximumProgress`
- `extraSettings`
- `lastFinishedAt`
- `createdAt`
- `updatedAt`

Do not expose `providerSpecifics`. Its secret redaction depends on dynamic provider schemas and cannot be delegated to recipes. Do not expose a source hash or internal ownership data.

The old computed `webhookUrl` does not need to remain a catalog field. A future concrete client can derive the stable webhook route from its configured server base URL and the integration ID, or request a separately justified safe derived field.

### Import Run

Add a user-owned `importRun` table entry.

Public fields:

- `id`
- `source`
- `status`
- `progress`
- `totalItems`
- `failedItems`
- `importedItems`
- `processedItems`
- `errorSummary`
- `inputSummary`
- `integrationId`
- `startedAt`
- `finishedAt`
- `createdAt`
- `updatedAt`

`inputSummary` remains public because the current authenticated response exposes it and ownership is enforced. If implementation discovers that credentials can be stored there, stop the slice and resolve the existing contract exposure before cataloging the field.

### Import Run Failure

Add `importRunFailure` only after implementing a policy that authorizes it through its owning `import_run` row. The table has no direct user ID.

Prefer the smallest catalog visibility extension that compiles an ownership `EXISTS` relation through `run_id` to `import_run.id` and `import_run.user_id`. Do not authorize failures only through caller joins, because visibility must apply before query predicates and joins.

Public fields:

- `id`
- `runId`
- `stage`
- `message`
- `context`
- `itemIndex`
- `sourceLabel`
- `sourceIdentifier`
- `eventSchemaSlug`
- `entitySchemaSlug`
- `createdAt`

`context` remains public because the current authenticated response exposes it and ownership is inherited from the run. If implementation discovers that credentials can be stored there, stop the slice and resolve the existing contract exposure before cataloging the field.

### Notification Subscription State

Add a user-owned `notificationSubscriptionState` table entry.

Public fields:

- `id`
- `signalSchemaSlug`
- `isActive`
- `createdAt`
- `updatedAt`

Do not expose internal metadata without a concrete consumer. Signal schema names and property schemas continue to come from the retained automation catalog API.

## Implementation Slices

Each slice must leave active packages compiling and focused tests passing. A slice is complete only after its replacement consumer uses RyotQL and its old read endpoint is deleted.

### Slice 1: Standardize A Surviving Internal Consumer

Use entity interest as the result-codec tracer because it remains an internal RyotQL consumer.

Work:

- Add an Effect Schema for the `buildEntityInterestDocument` response beside the recipe in `packages/ryotql-recipes/src/entities.ts`, or split the recipe into a focused file if that produces a clearer boundary.
- Derive the decoded entity-interest row type from the schema.
- Add a decoder that validates the named `entities` rows result and maps field values once.
- Update `apps/app-backend/src/modules/entity-interest/service.ts` to consume decoded values.
- Remove its imports of generic `RowItem` and backend RyotQL response helpers.
- Add recipe decoder tests for valid values, nullable values, missing fields, wrong field kinds, and the wrong named result type.

Do not refactor `EntitiesService.getById` or `EventsService.listForUser` result parsing in this slice. Those endpoint-only paths are deleted later.

Acceptance criteria:

- Entity interest no longer parses generic RyotQL rows.
- The builder, schema, decoded type, and decoder are colocated.
- Existing entity-interest behavior remains unchanged.

### Slice 2: Saved-View Read Tracer

This is the first complete HTTP endpoint replacement. The catalog already exposes `savedView`, so it validates the client, recipe, contract, route, service, and test migration without a catalog expansion.

Work:

- Add a clearly named recipe module for saved-view records, separate from the existing recipe that executes entity saved-view documents. Prefer a name such as `saved-view-records.ts` to avoid conflating records with persisted query execution.
- Add an explicitly paginated list builder with optional plugin and disabled-state filters.
- Add a by-slug builder with limit one.
- Select the complete safe record shape required by active saved-view creation and presentation, including `queryDocument` and `displayConfiguration`.
- Colocate response schemas, decoded types, and decoders.
- Migrate `apps/app-client/src/api/atoms.ts` and its consumer to call `ryotql.execute` and decode the result through the recipe-owned decoder.
- Preserve current refresh behavior after saved-view mutations.
- Migrate integration fixtures that need to list or get saved views.
- Remove `savedViews.list` and `savedViews.get` from the contract.
- Remove their route handlers.
- Remove service or repository read methods only when no mutation, clone, reorder, or validation path still needs them.
- Delete endpoint-specific tests while retaining mutation and saved-view lifecycle tests.

Acceptance criteria:

- The active app loads saved-view records only through RyotQL.
- Saved-view list and detail GET operations no longer exist in `AppContract`.
- Saved-view mutations continue to work.
- No replacement backend route wraps the recipes.

### Slice 3: Notification Channel Read

This is the first new application-table catalog tracer and the primary secret-safety slice.

Work:

- Add the safe `notificationChannel` catalog table and user visibility.
- Implement or deliberately narrow the safe derived description behavior.
- Add catalog, validator, execution, and cross-user authorization tests.
- Add a paginated recipe, response schema, decoded type, and decoder.
- Migrate the active app notification-channel atom and presentation.
- Migrate notification fixtures that list channels.
- Remove `notifications.listChannels` from the contract and routes.
- Keep internal repository methods used for delivery and notification mutations.
- Delete endpoint-only tests.

Acceptance criteria:

- Raw channel credentials cannot be selected by any RyotQL document.
- Another user's channels cannot be selected through roots or crafted nested queries.
- The active app loads notification channel summaries through RyotQL.
- The list-channels GET operation is deleted.

### Slice 4: Entity And Event Read Endpoints

The main entity and event payload reads already use RyotQL internally. Delete the redundant HTTP and service layers instead of polishing them.

Work:

- Migrate remaining active test fixtures from `entities.get` to direct RyotQL execution.
- Query entity details by visible entity ID; do not require a repository pre-read solely to discover `entitySchemaSlug`.
- Migrate event fixtures from `events.list` to explicitly paginated RyotQL documents.
- Require callers to provide `page` and `limit` for event collections.
- Return discriminator slugs in relational results. Resolve event schema names through retained definition metadata only where a consumer needs names.
- Remove `entities.get` and `events.list` from the contract and routes.
- Remove `EntitiesService.getById`, `EventsService.listForUser`, their endpoint-only pre-reads, full-page accumulation loop, response mapping, and tests when usage searches permit.
- Remove `buildEntityDetailDocument` and `buildEventHistoryDocument` if they have no surviving concrete consumer. Do not preserve unused recipes for compatibility.
- Keep entity-interest and sandbox recipes that still have production consumers.

Acceptance criteria:

- No entity or event domain GET endpoint remains.
- No service loops over every RyotQL event page to rebuild an unbounded array.
- Entity and event mutation, workflow, sandbox, and entity-interest behavior remains operational.

### Slice 5: Integration Reads

Work:

- Add the safe `integration` catalog entry and user policy.
- Add paginated list and by-id recipes with colocated result codecs.
- Support provider and disabled-state predicates in recipe inputs where tests or concrete consumers need them.
- Omit `providerSpecifics` and the computed webhook URL from the relational read surface.
- Update integration tests and fixtures to inspect safe integration state through RyotQL.
- Remove `integrations.list` and `integrations.get` from the contract and routes.
- Keep mutation and workflow reads that need full provider credentials.
- Keep client redaction code only if mutation responses still use it; otherwise delete it after a usage search.

Acceptance criteria:

- Integration credentials are unavailable through RyotQL.
- Users can query only their integrations.
- Integration list and detail GET operations are deleted.
- Integration create, update, delete, webhook, and processing workflows retain full internal configuration access.

### Slice 6: Import Run Reads

Work:

- Add `importRun` and `importRunFailure` catalog entries.
- Implement and test indirect ownership for import-run failures before exposing the table.
- Add a paginated manual-run list recipe.
- Add a paginated integration-run list recipe or a shared builder with a required mode discriminator.
- Add a detail document with independent named `run` and `failures` queries. Use root rows pagination for failures so callers receive the real total and page information; do not use an include when it would lose required total-count semantics.
- Colocate result schemas, decoded types, and decoders.
- Migrate import and integration-run fixtures.
- Remove `imports.listRuns`, `imports.getRun`, and `integrations.getRuns` from the contract and routes.
- Keep import mutation, deletion, workflow, and internal status-update paths.

Acceptance criteria:

- Run and failure queries share one RyotQL snapshot when requested together.
- A user cannot query another user's failure through a direct root, join, include, or correlated query.
- Run collections require explicit pagination.
- The three replaced GET operations are deleted.

### Slice 7: Automation Rule State Reads

Work:

- Add the safe `notificationSubscriptionState` catalog entry and user policy.
- Add paginated list and by-id recipes with colocated result codecs.
- Return `signalSchemaSlug` rather than embedding registry-owned signal schema definitions.
- Update consumers and fixtures to combine state with retained automation catalog metadata when they need names or property schemas.
- Remove `automations.listRules` and `automations.getRule` from the contract and routes.
- Keep catalog, install, activate, deactivate, delete, dispatch, and execution APIs and services.
- Remove service normalization functions only if no mutation response still uses them.

Acceptance criteria:

- Automation state is user-isolated through RyotQL.
- Signal-schema metadata still comes from the retained metadata API.
- Rule list and detail GET operations are deleted.
- Rule mutations continue returning valid results.

### Slice 8: Final Cleanup

Work:

- Remove generic backend response helpers after their final non-executor consumer disappears.
- Remove endpoint-only service methods, repository methods, contract schemas, imports, layers, mocks, and fixtures proven unused.
- Keep contract response schemas still used by mutation responses.
- Remove stale endpoint descriptions from OpenAPI documentation.
- Update backend and RyotQL guides to state the final read boundary and retained exceptions.
- Search active production packages, plugins, tests, and seed scripts for deleted contract operations.
- Do not include `apps/app-client-backup` in completion searches or verification.
- Run the codebase-cleanup skill over files changed by the implementation and directly affected modules.

Acceptance criteria:

- Active production code has no call to a deleted operation.
- Active tests and seed tooling have no call to a deleted operation.
- No backend route implements a user-facing relational list or detail endpoint from the removal table.
- No consumer outside the RyotQL executor parses generic `RowItem` values.
- Retained explicit endpoint groups remain functional.

## Testing Strategy

### Recipe Tests

Test each application-owned recipe for behavior the application owns:

- Selected fields.
- Required filters.
- Explicit ordering.
- Explicit pagination.
- Named-query keys.
- Important joins or correlated expressions.
- Decoder acceptance of the expected result.
- Decoder rejection of missing fields, wrong field kinds, wrong output types, and wrong query names.

Do not test Effect Schema itself, TypeScript assignments, or irrelevant complete-document snapshots.

### Catalog And Authorization Tests

For every new table test:

- Known-table resolution.
- Public field resolution.
- Hidden field rejection.
- Own-row visibility.
- Isolation from another user's rows.
- Crafted joins.
- Left joins that preserve the left row while hiding unauthorized right rows.
- Includes and correlated queries.
- Empty results rather than cross-user leakage.

Notification channels and integrations require explicit tests proving raw secret-bearing fields are unknown to the catalog.

Import-run failures require direct and nested tests for indirect parent ownership.

### Consumer Tests

Migrate tests that verify surviving application behavior. Delete tests whose only subject was a removed endpoint's HTTP envelope, domain mapping, unbounded list, or endpoint-specific `NotFound` behavior.

Mutation tests remain and may continue using internal services or mutation contracts. Tests that need to observe relational state should execute a named recipe through `ryotql.execute`.

### Verification Commands

Use targeted Turbo commands because `apps/app-client-backup` is intentionally ignored and repository-wide checks are not a completion requirement.

Run the relevant subset after each slice:

```sh
bun turbo --filter=@ryot/ryotql check
bun turbo --filter=@ryot/ryotql test
bun turbo --filter=@ryot/ryotql-recipes check
bun turbo --filter=@ryot/ryotql-recipes test
bun turbo --filter=@ryot/contract check
bun turbo --filter=@ryot/app-backend check
bun turbo --filter=@ryot/app-backend test
bun turbo --filter=@ryot/app-client check
bun turbo --filter=@ryot/app-client test
bun turbo --filter=@ryot/tests check
bun turbo --filter=@ryot/tests test
```

Run plugin checks and tests only when a migrated fixture or recipe affects them.

Completion searches should exclude the archival client and historical task documents. Search for the exact deleted group-operation pairs in active `apps`, `packages`, `plugins`, and `tests` paths.

## Behavioral Changes Accepted By This Plan

- Domain GET response envelopes are removed rather than preserved.
- Collection reads become explicitly paginated.
- Detail absence is represented by an empty rows result instead of endpoint-specific `NotFound` responses.
- Event results return discriminator slugs without embedded registry-owned names.
- Integration relational reads omit dynamically redacted provider settings and computed webhook URLs.
- Automation state results omit embedded signal-schema metadata.
- Clients may compose relational results with retained metadata endpoints.
- Old clients, including `apps/app-client-backup`, may no longer compile against `AppContract`.

## Risks And Mitigations

### Secret Exposure

Risk: Adding application tables can expose credential-bearing JSON to arbitrary raw documents.

Mitigation: Catalog only explicitly safe fields, use backend-derived sanitized fields, and test hidden-field rejection. Never rely on recipes for secrecy.

### Authorization Through Child Tables

Risk: `import_run_failure` has no direct user ID and could leak through direct roots or crafted joins.

Mitigation: Implement parent-derived visibility as a catalog policy applied before caller joins and predicates. Test every query occurrence form.

### Silent Truncation

Risk: Replacing unbounded endpoints with one page can silently lose records.

Mitigation: Require page and limit in collection recipe inputs, expose page information, and update consumers to request more pages deliberately.

### Metadata Coupling

Risk: Existing responses blend registry definitions with relational state.

Mitigation: Keep registry APIs explicit and make composition visible in consumers. Do not duplicate registry data into RyotQL.

### Accidental Mutation Breakage

Risk: Read and mutation paths share service normalization or repository methods.

Mitigation: Perform usage searches before deletion. Remove endpoint handlers first, then delete only unreachable service and repository code. Keep mutation response schemas that remain in contract use.

### Verification Noise From Archival Code

Risk: The archival client references deleted APIs and legacy query-engine surfaces.

Mitigation: Exclude `apps/app-client-backup` from scoped searches and verification. Do not modify it as part of this work.

## Completion Criteria

The project is complete when all of the following are true:

- The endpoint removal table contains no operations in `AppContract` or backend routes.
- Active production consumers execute their relational reads through `ryotql.execute`.
- Fixed application recipes colocate schemas, decoded types, and decoders.
- No application consumer parses generic `RowItem` values.
- New catalog tables expose only reviewed safe fields.
- New table policies pass root, join, include, correlated-query, and cross-user isolation tests.
- Collection recipes require explicit pagination.
- Metadata, operational, streaming, administrative, and test-support endpoints in the retain table still work.
- Internal mutation, workflow, and transaction reads continue through owning services and repositories where appropriate.
- Endpoint-only tests are removed and surviving behavior tests use RyotQL.
- Targeted checks and tests pass for all active affected packages.
- `apps/app-client-backup` remains intentionally ignored.
- A final cleanup pass removes verified dead compatibility and endpoint code.
