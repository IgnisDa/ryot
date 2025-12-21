# Catalog and Rule Management API with Default Installs

**Parent Plan:** [Database-Driven Automations, Signals, and Subscriptions](./README.md)

**Type:** AFK

**Status:** done

## What to build

The user-facing subscription surface, per the PRD's Public API, Notification Model, and Legacy
Bootstrap sections.

Add the contract-library schemas and endpoint group plus the backend handlers for: listing and
getting active built-in signal schemas (the catalog; hidden schemas are internal), listing,
getting, and deleting the authenticated user's installed notification rules, activating and
deactivating an installed rule, and installing or reinstalling an active catalog signal. Catalog
installation is the only rule-creation path: the client supplies only the active built-in
signal-schema target; the server selects the shared notification script and server-owned rule
metadata. Reinstalling recreates the same user-owned rule row after deletion. The endpoints
accept no arbitrary script IDs, lifecycle targets, rule kinds, operations, or configuration;
there is no generic rule update; a get for an inaccessible or nonexistent record returns the same
404.

Wire default installs into user bootstrap: one notification rule per active built-in signal
schema, inside the existing transactional, idempotent, session-gated flow, for auth-created and
migrated users alike. Activating a catalog schema later does not backfill existing users, and
bootstrap never recreates a rule the user deleted. For legacy migration, order startup so global
built-in schemas, scripts, and rules are seeded before users migrate; a migrated user's bootstrap
failure aborts migration.

Builds on tasks 02 and 08. Verifiable end-to-end: sign up a user, see default subscriptions,
manage them through the endpoints, and receive a notification for a subscribed signal.

## Acceptance criteria

- [x] All listed endpoints exist in the contract library and backend with Effect
      Schema-validated payloads
- [x] Catalog listing offers only active built-in schemas; installation rejects hidden schemas,
      arbitrary scripts, lifecycle targets, operations, and generic updates
- [x] Install/delete/reinstall round-trips recreate the same rule shape; activate/deactivate
      toggles matching without deleting history
- [x] New and migrated users receive one rule per active schema through bootstrap; reruns are
      idempotent and never resurrect deleted rules; later activations do not backfill
- [x] Inaccessible and nonexistent records return identical 404s
- [x] Rule reads and mutations verify ownership; another user's rules are never visible

## Implementation notes

- Added an authenticated `automations` contract group and backend handlers for active catalog
  list/get, installed-rule list/get/delete, install, activate, and deactivate operations. The
  install body is strict and accepts only a signal-schema ID.
- Added a notification-subscription service that resolves the seeded `automation.notification`
  script server-side, restricts installation to active global built-in signal schemas, and exposes
  only notification-specific rule views rather than the generic automation-rule model.
- Added repository queries for active catalog schemas and ownership-filtered notification rules.
  Installed rules remain readable and manageable if their catalog schema is later hidden, while
  hidden schemas cannot be newly installed.
- User bootstrap now installs one rule per currently active built-in signal schema before setting
  the existing completion marker. Conflict-do-nothing inserts make an interrupted rerun
  idempotent; the completion marker prevents later catalog activations or deleted rules from being
  backfilled. Auth-created users, god-mode resets, and migrated users all use this same path.
- Added focused service and bootstrap tests for strict payloads, active/hidden catalog behavior,
  server-owned rule shape, ownership-safe not-found results, activation/deactivation,
  delete/reinstall, idempotent defaults, and completion-marker short-circuiting.
- Added public-contract E2E coverage proving signup defaults match the active catalog, rule
  ownership and management behavior, strict install input, delete/reinstall, and an API-created
  workout reaching Apprise through its default subscription. The integration-disable E2E now uses
  the signup-installed default instead of the former admin-only manual install helper.
- Removed the Task 08 admin-only test-support installer after its final consumer moved to signup
  defaults, leaving the notification-specific service as the single rule-installation owner.
- Verification passed `bun turbo --filter=@ryot/app-backend check` with no warnings and the full
  backend suite with 1,163 tests. The complete E2E suite passed all 510 tests across 73 files.

## Problems and deviations

- Adding the endpoint group exceeded Effect's direct `HttpApiBuilder` layer-argument overload.
  The automation and system route layers are merged before being provided, with no runtime
  behavior change.
- Bootstrap is also invoked from auth, god-mode reset, and migration-only startup contexts. Each
  context needed the new notification service supplied explicitly; migration startup already
  seeds built-ins before legacy migration, so no startup-order rewrite was necessary.
- The first complete E2E run had one unrelated suite-load timeout in the media-trending cron test
  after 509 tests passed. That file passed immediately in isolation, and a second complete run
  passed all 510 tests.
- The public behavior was implemented in a dedicated `NotificationSubscriptionsService` rather
  than adding HTTP-shaped operations to the generic `AutomationsService`. This is a deliberate
  boundary refinement: public callers cannot reach generic scripts, lifecycle targets, kinds,
  operations, metadata, or update methods.
- No blocker or substantive behavioral deviation occurred.

## User stories addressed

- User story 14
- User story 15
- User story 16
- User story 17
- User story 18
- User story 19
- User story 26
