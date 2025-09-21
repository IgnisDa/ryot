# App Backend Effect Migration

## Problem Statement

The current app backend is a Hono and Zod-OpenAPI service that has grown a large amount of framework-specific route, schema, service-result, queue, generated OpenAPI, and shared utility coupling. A smaller reference backend now demonstrates the desired architecture: Effect `HttpApi` contracts, Effect Schema, Better Auth bridged through Effect middleware, Drizzle repositories wrapped in typed Effects, Redis and database infrastructure as layers, and Effect Workflow replacing BullMQ-style background orchestration.

The project is greenfield, so breaking changes are acceptable when all affected consumers are updated. The migration should replace the backend completely rather than layering Effect onto the old implementation. The E2E suite should continue to test a real server, but it should move from generated OpenAPI and `openapi-fetch` to Effect `HttpApiClient`. The app client may be broken during the backend migration, but it must eventually migrate away from the generated OpenAPI stack before the old backend, reference backend, and generated OpenAPI artifacts are removed.

The end state is a clean Effect backend with pure public contract exports, typed Effect HTTP clients in tests and app-client, real existing database schema and migrations, no BullMQ in the new backend, no backend dependency on `@ryot/ts-utils`, no legacy response envelopes, and no leftover temporary scaffolding.

## Solution

Replace the current backend with a new Effect implementation that keeps the product's public route surface where intentionally preserved, but changes the internal architecture and typed client contract. The old backend is renamed temporarily so it can be consulted during migration without conflicting with the new workspace package name. The new backend exports a pure `AppContract` and pure query-language helpers from public subpaths that can be imported by tests and app-client without starting configuration, database, Redis, auth, migrations, or the server.

The new backend uses Effect-native direct success responses and `Schema.TaggedError` failures instead of the old `{ data }` and `{ error }` response envelopes. During the skeleton phase, all route handlers decode path, query, payload, and auth middleware first, then return a temporary typed `NotImplemented` error with status `501`. The `NotImplemented` error is removed module by module as behavior is migrated.

Every implementation task in this plan MUST follow the rules and migration guidance in `apps/app-backend-reference/README.md`. That reference README is the pattern authority for services, layers, HTTP contracts, repositories, transactions, workflows, sandbox execution, schema definitions, E2E client migration, Effect Schema migration, service-layer migration, and dependency-injection migration. Each implementor should also use the necessary code in the legacy backend as the starting point for current product behavior, route semantics, database schema, seed data, validation rules, and edge cases to port. Legacy backend code is source material for what behavior exists; it must not override the architectural and migration decisions in the reference README. If this PRD, the reference README, and the legacy backend appear to conflict, stop and resolve the conflict before implementing the task.

E2E tests keep spawning a real backend process and keep using raw fetch or Better Auth clients for Better Auth endpoints and intentionally malformed HTTP cases. For contract-valid app-owned routes, E2E tests use `HttpApiClient` against the exported `AppContract`. Backend unit tests migrate with modules and use Vitest plus `@effect/vitest`.

The module migration proceeds from infrastructure and leaf modules toward highly coupled modules. Static builtins, seed data, and the real Drizzle schema come early. The user bootstrap path is migrated early because Better Auth user creation depends on it, but the full builtins, saved-views, query-engine, collection, import, and integration behavior is migrated in later slices. The `saved-views` and `query-engine` cycle is handled together. The `imports` and `integrations` cycle is handled together near the end. App-client then migrates to the Effect client so generated OpenAPI and old backend artifacts can be removed.

## User Stories

1. As a backend maintainer, I want the old backend renamed without duplicate workspace package names, so that the new backend can own `@ryot/app-backend`.
2. As a backend maintainer, I want a new Effect backend shell, so that future module work starts from the target runtime architecture.
3. As a deployer, I want the new backend to serve static client assets from the production client directory, so that Docker runtime behavior remains compatible.
4. As a backend maintainer, I want `AppContract` exported from a pure subpath, so that tests and app-client can build typed clients without importing server runtime code.
5. As an E2E maintainer, I want tests to import only pure public contract exports, so that E2E remains a real-server test suite rather than a backend-internals test suite.
6. As an API consumer, I want successful responses to return direct typed values, so that clients do not unwrap legacy `{ data }` envelopes.
7. As an API consumer, I want expected failures to be typed tagged errors, so that failure handling is explicit and schema documented.
8. As a backend maintainer, I want temporary unimplemented handlers to return a typed `501` error, so that route contracts can compile before business logic exists.
9. As an E2E maintainer, I want `/api/system/health` implemented immediately, so that test setup can wait for a running server.
10. As an app-client developer, I want `/api/system/config` available early, so that auth configuration and onboarding can be migrated predictably.
11. As a user, I want Better Auth sign-up and sign-in to keep working, so that authenticated routes can be tested during migration.
12. As an API user, I want cookie sessions and API keys to authenticate app-owned routes, so that browser and programmatic access both work.
13. As an administrator, I want the existing admin access token header preserved, so that admin-only operations remain protected.
14. As a new user, I want account bootstrap to run after user creation, so that default trackers, schema links, saved views, and library records exist.
15. As a backend maintainer, I want the real current Drizzle schema and migrations migrated, so that the reference schema is not accidentally used.
16. As a deployer, I want the migration folder convention to remain compatible with the production image, so that database migrations run after build.
17. As a backend maintainer, I want static builtin definitions and seed manifests migrated early, so that built-in schemas, scripts, triggers, and relationships exist before modules need them.
18. As a backend maintainer, I want new backend code not to depend on `@ryot/ts-utils`, so that backend runtime and contract code are not coupled to legacy Zod, UI, or generated OpenAPI utilities.
19. As a test and client maintainer, I want public query-language builders exposed from the backend package, so that query tests and app-client can construct valid queries without importing legacy utilities.
20. As an API maintainer, I want route-level validation to happen before `NotImplemented`, so that typed clients and validation errors are meaningful before logic is migrated.
21. As an E2E maintainer, I want tests to continue spawning a real server, so that integration behavior is verified through HTTP.
22. As an E2E maintainer, I want tests to use Effect internally where useful, so that contract-valid requests use the same `HttpApiClient` model as app-client.
23. As a maintainer, I want filtered Turbo checks during migration, so that backend and tests can move forward while app-client and Docker builds are temporarily broken.
24. As a deployer, I want the backend to keep serving the built app client with SPA fallback, so that the final combined image still works.
25. As an integration user, I want the short integration webhook path preserved, so that existing external webhook URLs have a migration target.
26. As a backend maintainer, I want the metrics endpoint skipped for now, so that migration effort focuses on currently tested and used behavior.
27. As a backend maintainer, I want BullMQ avoided in the new backend, so that new async work uses Effect Workflow patterns.
28. As a backend maintainer, I want durable workflow orchestration for background work, so that imports, sandbox work, and triggers survive restarts without queue-specific state machines.
29. As a user, I want tracker listing, creation, update, and reorder behavior migrated, so that the first domain module works through the new stack.
30. As a user, I want entity schema listing, creation, and lookup behavior migrated, so that custom tracking definitions can be created.
31. As a user, I want event schema listing and creation migrated, so that events can be defined for entities.
32. As a user, I want entity creation, retrieval, and user-state clearing migrated, so that tracked items can be stored and managed.
33. As a user, I want event creation and listing migrated, so that tracked activity can be recorded and queried.
34. As a user, I want collections and library membership migrated, so that entities can be grouped and added to the library.
35. As a user, I want uploads migrated, so that temporary files and S3 presigned URLs work in the new backend.
36. As a user, I want sandbox script creation, execution, and result polling migrated, so that custom/provider code can run safely.
37. As a user, I want provider-backed entity search and import migrated, so that provider data can populate global entities.
38. As a user, I want event triggers migrated, so that before-create and after-create automation continues to work.
39. As a user, I want saved-view CRUD migrated, so that saved query views can be listed, opened, cloned, updated, reordered, and deleted.
40. As a user, I want the query engine migrated, so that saved views and media pages can retrieve dynamic data.
41. As an administrator, I want god-mode user listing, provisioning, reset, and ban operations migrated, so that administrative recovery still works.
42. As a user, I want one-time import runs migrated, so that external source imports still work.
43. As an integration user, I want integrations, scheduled runs, and webhooks migrated, so that external service sync still works.
44. As an app-client developer, I want an Effect HTTP client foundation, so that the app no longer depends on generated OpenAPI or `openapi-fetch`.
45. As an app-client developer, I want Better Auth client usage preserved for auth endpoints, so that auth remains delegated to Better Auth rather than the app contract.
46. As an app user, I want navigation data to load through the Effect client, so that trackers and saved views populate the app shell.
47. As an app user, I want media overview and saved-view screens to use the Effect query engine client, so that dynamic content still renders.
48. As an administrator using app-client, I want god-mode screens migrated to the Effect client, so that admin workflows still work.
49. As an app user, I want entity detail screens migrated to the Effect client, so that entity-specific sections still render real data.
50. As an app user, I want image upload/download helpers migrated to the Effect client, so that entity images still load.
51. As a maintainer, I want generated OpenAPI consumers removed, so that generated API types no longer define the application contract.
52. As a maintainer, I want the old backend and reference backend removed after migration, so that the repository has one backend implementation.
53. As a deployer, I want the final Docker build to use the new backend and migrated app-client, so that the combined image can be built again.
54. As an E2E maintainer, I want tests not to import backend services, repositories, or runtime modules, so that tests remain black-box integration tests.
55. As a backend maintainer, I want module unit tests to use Vitest and `@effect/vitest`, so that Effect code is tested with the intended test framework.
56. As an E2E maintainer, I want raw fetch preserved for Better Auth and malformed HTTP cases, so that non-contract behavior remains testable.
57. As a typed-client user, I want stable endpoint method names, so that tests and app-client read clearly after moving away from path-string calls.
58. As an API consumer, I want public route paths preserved where intentionally supported, so that migration does not create unnecessary URL churn.
59. As an API consumer, I want expected errors mapped to deliberate HTTP statuses, so that clients can distinguish auth, validation, not-found, conflict, timeout, and server failures.
60. As a backend maintainer, I want modules migrated in dependency order, so that partial migrations do not create avoidable cycles.
61. As a backend maintainer, I want user bootstrap migrated early enough for auth tests, so that sign-up tests can verify real domain setup.
62. As a maintainer, I want temporary scaffolding removed at the end, so that the final backend has no lingering migration-only code.
63. As a backend maintainer, I want app-owned validation to use Effect Schema, so that Zod does not remain in the new backend application code.
64. As a maintainer, I want final backend, tests, and app-client checks to pass through the intended filtered and full commands, so that the migration is verifiable.

## Implementation Decisions

- The old backend is renamed to an obsolete package with a distinct workspace package name before the new backend takes over `@ryot/app-backend`.
- The old backend may break after being renamed. It exists only as temporary reference material until final cleanup.
- The new backend is a full rewrite using Effect patterns from the reference implementation.
- Every task in this plan must follow `apps/app-backend-reference/README.md` as mandatory migration guidance and pattern authority.
- Every task implementor should use the necessary legacy backend code as the starting point for behavior to port, while treating the reference README as authoritative for how that behavior is implemented in the new Effect backend.
- The new backend must not wrap old `ServiceResult` or `deps` patterns. Services return `Effect` values with typed success, failure, and dependency channels.
- The new backend must not introduce BullMQ. Background work should use Effect Workflow, durable queues, durable deferred signals, activities, and workflow-friendly service boundaries.
- The real current database schema and migration history are the source of truth. The reference backend schema must not be copied except as conceptual pattern material.
- The database migration folder convention must remain compatible with production packaging unless the production image is updated in the same slice.
- The backend exports a pure `AppContract` from a public subpath. Importing this subpath must not evaluate config, database, Redis, Better Auth, migrations, server startup, or layers.
- The backend exports pure public query-language helpers from a public subpath. Tests and app-client may import those helpers, but they must remain side-effect-free.
- The backend root entry point should remain responsible for starting the server. Tests and app-client should avoid importing from the root entry point.
- Contract endpoint method names are chosen for readability rather than copied from old route constants. Examples include names like list, create, get, update, delete, clone, reorder, execute, uploadTemporary, and createRun.
- Public route paths should be preserved where they represent real API surface. The short integration webhook path remains outside the `/api` contract surface if needed, but it must continue to be served.
- The metrics endpoint is intentionally not migrated in the initial migration. Health and config endpoints are migrated.
- `/api/auth/*` remains Better Auth's native handler and is not part of the app-owned Effect `HttpApi` contract.
- Tests and app-client should use Better Auth clients or raw fetch for Better Auth endpoints.
- App-owned route authentication uses Effect HTTP middleware that bridges to Better Auth session resolution.
- Authenticated routes should support cookie sessions and API keys.
- Admin routes should preserve the existing admin access token header name and expected authorization behavior.
- During the route-skeleton phase, all app-owned routes should validate path, query, payload, multipart, and auth middleware before returning `NotImplemented`.
- `NotImplemented` is a temporary tagged error with HTTP status `501`. It must be easy to grep and must be removed module by module.
- Successful app-owned routes return direct schema values. They do not return `{ data: value }` envelopes.
- Expected app-owned failures are `Schema.TaggedError` values added to the route contract with explicit HTTP statuses. They do not return `{ error: { code, message } }` envelopes.
- Unexpected defects should be treated as defects/internal failures rather than widened into every domain error type.
- New backend code should not depend on `@ryot/ts-utils`. Pure helpers may be reimplemented locally or exposed through pure backend subpaths when they are public API.
- `@ryot/ts-utils` remains a legacy/client utility during migration but should not define new backend runtime behavior.
- The persisted app-owned schema DSL should retain useful JSON shape compatibility where practical, but new validation should be implemented with Effect Schema rather than Zod.
- Static builtin definitions and seed manifests migrate early because many modules assume built-in entity schemas, event schemas, relationship schemas, sandbox scripts, and trigger links exist.
- User bootstrap is migrated early but can be implemented in a minimal tracer shape first, then expanded as modules become available.
- The user bootstrap path ultimately creates default trackers, tracker-to-entity-schema links, default saved views, and the library entity.
- The E2E package keeps testing a real spawned backend server. It may use Effect internally for client calls but must not call backend services, repositories, layers, or runtime programs directly.
- E2E tests may import pure public backend contract and query-language exports.
- E2E raw fetch remains appropriate for Better Auth endpoints, invalid payload tests, invalid multipart tests, missing/wrong auth header tests, and any test that intentionally sits outside the contract.
- Backend unit tests move with migrated modules and use Vitest plus `@effect/vitest`.
- The app client is allowed to be broken during backend migration, but it must migrate to the Effect client before generated OpenAPI and old backend artifacts are removed.
- The app client should preserve Better Auth client usage for auth endpoints and use the Effect app contract for app-owned backend routes.
- The app client currently has a limited set of backend route call sites: system health/config, trackers, saved views, entity schemas, entities, uploads, query-engine, and god-mode. These should be migrated in focused late slices.
- Static client serving must use the production client output directory and SPA fallback behavior expected by the final combined image.
- Filtered Turbo checks are the migration gate while root checks and Docker builds are expected to be broken by app-client migration work.
- The intended filtered gate during backend and E2E work is backend check plus tests check. Full checks become required again after app-client and cleanup are complete.
- The final cleanup removes old backend, reference backend, generated OpenAPI consumers, generated OpenAPI package exports that are no longer needed, temporary `NotImplemented` scaffolding, and any migration-only helpers.

## Testing Decisions

- Tests should verify externally observable behavior and durable persisted effects, not private implementation details.
- E2E tests remain black-box HTTP tests against a spawned server and provisioned database, Redis, and S3-compatible storage.
- E2E tests should migrate from generated OpenAPI and `openapi-fetch` to Effect `HttpApiClient` for contract-valid app-owned routes.
- E2E tests should import only pure public backend exports needed to construct clients and query expressions.
- E2E setup should not globally seed module-specific data that prevents a mostly stubbed backend from booting. Module-specific seed work should move closer to the tests that need it.
- Better Auth flows in E2E may continue using Better Auth clients or raw fetch.
- Negative tests for malformed requests may use raw fetch when typed clients cannot construct invalid requests.
- Backend unit tests should be added or migrated with each module slice using Vitest and `@effect/vitest`.
- Module tests should focus on app-owned branching, access rules, schema validation, transaction failure mapping, durable workflow behavior, and repository error translation.
- Tests should not merely prove TypeScript, Effect, Effect Schema, Better Auth, Drizzle, or library behavior.
- Prior art for Effect backend tests is the reference backend's co-located service, repository, and pure-helper tests.
- Prior art for E2E provisioning is the existing E2E package that starts PostgreSQL, Redis, S3-compatible storage, and a real backend process.
- The health endpoint is the first E2E smoke test.
- Auth and bootstrap tests should follow quickly because most domain tests require an authenticated user.
- Tests should be re-enabled in dependency order: health, auth, trackers, entity/event schemas, entities/events/collections, uploads, sandbox, saved-views/query-engine, god-mode, imports/integrations, app-client checks.
- While app-client is intentionally broken, filtered checks are acceptable. The final plan requires app-client checks and full cleanup to pass.
- Any task that touches tests or public contract typing must review nearby tests-only `TODO(Task 11)`, `TODO(Task 22)`, and similar migration markers, then remove the ones that are now in scope instead of carrying them forward.

## Out of Scope

- Preserving the old response envelopes for app-owned routes.
- Preserving generated OpenAPI as the long-term app contract.
- Maintaining compatibility for old app-client code during intermediate backend slices.
- Migrating the metrics endpoint during the initial backend migration.
- Keeping BullMQ in the new backend.
- Keeping Zod as an application-code validation library in the new backend, except inside sandbox scripts if they need isolated validation.
- Rewriting unrelated website, docs, browser extension, or GraphQL packages beyond what is required to keep the final repository consistent.
- Opportunistically redesigning product behavior that is unrelated to the backend Effect migration.
- Removing legacy artifacts before app-client and tests no longer depend on them.

## Further Notes

- The most important sequencing constraint is user bootstrap. Static builtins and seed data can migrate early, but full bootstrap depends on trackers, entity schemas, saved views, and collections.
- The reference README is mandatory reading for every implementation task in this plan and must be treated as authoritative for the target Effect patterns.
- The legacy backend is mandatory source material for product behavior, data model details, route semantics, and edge cases, but not for architecture when it conflicts with the reference README.
- The `saved-views` and `query-engine` cycle should be handled deliberately by moving shared query-language concepts to pure exports and migrating saved-view validation and query execution together.
- The `imports` and `integrations` cycle should be handled late because those modules depend on most of the domain model and have the most complex background orchestration.
- App-client migration is intentionally late because the backend contract and domain modules should stabilize first.
- The cleanup task generated from this PRD is mandatory and must use the `codebase-cleanup` skill.

---

## Tasks

**Overall Progress:** 9 of 32 tasks completed

**Current Task:** [Task 10](./10-user-bootstrap-tracer.md) (todo)

### Task List

| #   | Task                                                                                                 | Type | Status |
| --- | ---------------------------------------------------------------------------------------------------- | ---- | ------ |
| 01  | [Workspace Rename And Effect Server Shell](./01-workspace-rename-and-effect-server-shell.md)         | AFK  | done   |
| 02  | [Pure Contract Exports And Stub Surface](./02-pure-contract-exports-and-stub-surface.md)             | AFK  | done   |
| 03  | [Effect E2E Client Harness](./03-effect-e2e-client-harness.md)                                       | AFK  | done   |
| 04  | [Config And System Endpoints](./04-config-and-system-endpoints.md)                                   | AFK  | done   |
| 05  | [Real Schema Migrations And Transaction Layer](./05-real-schema-migrations-and-transaction-layer.md) | AFK  | done   |
| 06  | [Static Builtins And Seed Manifests](./06-static-builtins-and-seed-manifests.md)                     | AFK  | done   |
| 07  | [Better Auth Email Sessions](./07-better-auth-email-sessions.md)                                     | AFK  | done   |
| 08  | [Auth Middleware And Security Schemes](./08-auth-middleware-and-security-schemes.md)                 | AFK  | done   |
| 09  | [Trackers Domain Slice](./09-trackers-domain-slice.md)                                               | AFK  | done   |
| 10  | [User Bootstrap Tracer](./10-user-bootstrap-tracer.md)                                               | AFK  | todo   |
| 11  | [Property Schema Effect DSL](./11-property-schema-effect-dsl.md)                                     | AFK  | todo   |
| 12  | [Relationship Schema Reads](./12-relationship-schema-reads.md)                                       | AFK  | todo   |
| 13  | [Entity Schema Basic CRUD](./13-entity-schema-basic-crud.md)                                         | AFK  | todo   |
| 14  | [Event Schema Basic CRUD](./14-event-schema-basic-crud.md)                                           | AFK  | todo   |
| 15  | [Entity Create Get Clear State](./15-entity-create-get-clear-state.md)                               | AFK  | todo   |
| 16  | [Event Create List Without Triggers](./16-event-create-list-without-triggers.md)                     | AFK  | todo   |
| 17  | [Collections And Library Membership](./17-collections-and-library-membership.md)                     | AFK  | todo   |
| 18  | [Uploads Temporary And Presigned](./18-uploads-temporary-and-presigned.md)                           | AFK  | todo   |
| 19  | [Sandbox Runtime And Direct Runs](./19-sandbox-runtime-and-direct-runs.md)                           | AFK  | todo   |
| 20  | [Entity Provider Search And Import](./20-entity-provider-search-and-import.md)                       | AFK  | todo   |
| 21  | [Event Trigger Workflows](./21-event-trigger-workflows.md)                                           | AFK  | todo   |
| 22  | [Saved View Query Language Exports](./22-saved-view-query-language-exports.md)                       | AFK  | todo   |
| 23  | [Saved Views CRUD](./23-saved-views-crud.md)                                                         | AFK  | todo   |
| 24  | [Query Engine Execute](./24-query-engine-execute.md)                                                 | AFK  | todo   |
| 25  | [God Mode Admin Operations](./25-god-mode-admin-operations.md)                                       | AFK  | todo   |
| 26  | [Imports One Time Runs](./26-imports-one-time-runs.md)                                               | AFK  | todo   |
| 27  | [Integrations And Webhooks](./27-integrations-and-webhooks.md)                                       | AFK  | todo   |
| 28  | [App Client Effect Client Foundation](./28-app-client-effect-client-foundation.md)                   | AFK  | todo   |
| 29  | [App Client Navigation And Media Queries](./29-app-client-navigation-and-media-queries.md)           | AFK  | todo   |
| 30  | [App Client Admin Detail Upload Saved Views](./30-app-client-admin-detail-upload-saved-views.md)     | AFK  | todo   |
| 31  | [Remove Legacy Contract Artifacts](./31-remove-legacy-contract-artifacts.md)                         | AFK  | todo   |
| 32  | [Codebase Cleanup](./32-codebase-cleanup.md)                                                         | AFK  | todo   |
