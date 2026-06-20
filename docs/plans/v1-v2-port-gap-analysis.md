# V1 → V2 Port Gap Analysis

## Overview

This document captures what remains to port from V1 (`apps/backend`, Rust) to V2 (`apps/app-backend`, TypeScript), as of 2026-07-07. As items are completed they should be removed and added to the baseline.

It was produced by mapping V1's full API surface — 116 GraphQL operations across 18 resolver crates under `crates/resolvers/` — against V2's modules and routes under `apps/app-backend/src/modules/`. V1 is a behavior reference only; V2 deliberately replaces V1's domain-specific resolvers with a generic `entity_schema → entity → event → relationship` model queried through `modules/query-engine`.

The remaining backlog below is all user-confirmed in-scope. Items the rewrite intentionally drops or re-shapes are listed separately at the end.

## Already Ported (Baseline)

These V1 areas have a working home in V2 and are not part of the backlog.

| V1 area                                                                             | V2 home                                                                                                         |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 18 metadata providers (AniList, Audible, TMDB, IGDB, Hardcover, MusicBrainz, …)     | `lib/sandbox/scripts/providers/*`                                                                               |
| Provider search (`metadata_search`, `people_search`, `metadata_group_search`)       | 60 sandbox `search` drivers via `entity-schemas/search` + `entities/import`                                     |
| Integrations: sinks, yanks, pushes, webhook, sync scheduler                         | `modules/integrations` (+ push as sandbox triggers)                                                             |
| ~19 importers                                                                       | `modules/imports/sources/*`                                                                                     |
| Seen/progress history                                                               | Lifecycle events (`backlog`/`progress`/`complete`/`dropped`/`on_hold`/`review`); state derived via query-engine |
| Reviews & ratings                                                                   | Built-in `review` entity-schema                                                                                 |
| Collections                                                                         | `modules/collections`                                                                                           |
| Filter presets                                                                      | `modules/saved-views`                                                                                           |
| Custom metadata/person/group/exercise                                               | `modules/entities` (`createEntity`)                                                                             |
| Auth: register/login/2FA (TOTP)/OIDC/API keys                                       | `lib/auth` (Better Auth)                                                                                        |
| File storage                                                                        | `modules/uploads`                                                                                               |
| Admin user management                                                               | `modules/god-mode` (list/provision/ban/reset-password)                                                          |
| Core details / config                                                               | `modules/system` (config/health/metrics)                                                                        |
| User state operations (`merge_metadata`, `merge_exercise`, `disassociate_metadata`) | `modules/user-state` (`POST /user-state/merge`, `DELETE /user-state/clear/:entityId`)                           |
| Media translation (localized title/overview)                                        | `modules/entity-translation` (sandbox `translate` driver + `TranslateEntityWorkflow`); localized `name`/`properties` and a `translationStatus` field via `modules/query-engine`; filled on demand through client-declared interest (`modules/entity-interest`) rather than V1's periodic refresh job |

## Remaining Backlog (In-Scope)

### Tier 1 — Notification system

Foundational; three behaviors depend on it. Build first.

- **Notification platforms** — Apprise, Discord, Telegram, ntfy, Gotify, PushOver, PushBullet, PushSafer, Email/SMTP. Needs per-user platform CRUD, a `test` endpoint, a send abstraction, and SMTP config keys (none exist today).
  - V1: `create_user_notification_platform`, `update_user_notification_platform`, `delete_user_notification_platform`, `user_notification_platforms`, `test_user_notification_platforms` (`crates/resolvers/user/services`).
- **Monitoring** _(depends on notifications)_ — mark an entity/person as monitored → periodic provider-details diff → notify on change.
  - V1 events: `MetadataStatusChanged`, `PersonMetadataAssociated`. Shape in V2: a `monitoring` relationship plus a cron job comparing populated details.
- **Reminders** _(depends on notifications)_ — reminder on an entity → scheduled notification.
  - V1 event: `NotificationFromReminderCollection`.
- **Event-driven alerts** — wire integration-disabled, new-workout-created, and review-posted into the send path.
  - V1 events: `IntegrationDisabledDueToTooManyErrors`, `NewWorkoutCreated`, `ReviewPosted`.

### Tier 2 — Independent features (parallelizable)

- **Data export** — job serializing a user's entities/events/relationships/collections into a downloadable archive, plus a listing query and a download URL.
  - V1: `deploy_export_job`, `user_exports` (`crates/resolvers/exporter`); `PerformExport` job.
- **Trending metadata** — provider trending lists surfaced as a query or built-in saved view.
  - V1: `trending_metadata` (`crates/resolvers/miscellaneous/search`).
- **Recommendations** — media and collection recommendations (only fitness exercise recs exist today).
  - V1: `user_metadata_recommendations`, `collection_recommendations`.

### Tier 3 — Metadata-management ops

- **Metadata lookup** — single-best-match wrapper over the existing search/resolve drivers (distinct from paginated search).
  - V1: `metadata_lookup`.

## Open / Unverified

- **User self-service** — `update_user`, self account-delete, `reset_user` (data wipe), and impersonation link. `update_user_preference` is now covered by the `modules/user-preferences` update endpoint; the language model is a single global BCP-47 preference (replacing the earlier per-provider languages). Remaining account operations may be partly delegated to Better Auth `/auth/*`; needs a pass over `lib/auth` to confirm what Better Auth already provides before scoping the remainder.

## Deferred — Build On Query Engine

Not ported as-is; to be expressed on top of `modules/query-engine`.

- User analytics / statistics — V1: `user_analytics`, `user_analytics_parameters`; `RecalculateUserActivitiesAndSummary` job.
- Calendar events — V1: `user_calendar_events`, `user_upcoming_calendar_events`.
- Recently consumed — V1: `user_entity_recently_consumed`.

## Excluded From V2

Intentionally not ported.

- Collection collaborators.
- Mark as partial (`mark_entity_as_partial`) — obsolete under V2's on-demand population: `entity.populatedAt === null` is itself the partial state, and a partial entity is re-populated on demand when a client declares interest in it (`modules/entity-interest`), so no explicit partial flag or manual mark operation is needed.
- Access links — V1: `create_access_link`, `process_access_link`, `revoke_access_link`, `user_access_links`.
