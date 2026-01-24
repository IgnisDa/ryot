# Catalog and Rule Management API with Default Installs

**Parent Plan:** [Database-Driven Automations, Signals, and Subscriptions](./README.md)

**Type:** AFK

**Status:** todo

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

- [ ] All listed endpoints exist in the contract library and backend with Effect
      Schema-validated payloads
- [ ] Catalog listing offers only active built-in schemas; installation rejects hidden schemas,
      arbitrary scripts, lifecycle targets, operations, and generic updates
- [ ] Install/delete/reinstall round-trips recreate the same rule shape; activate/deactivate
      toggles matching without deleting history
- [ ] New and migrated users receive one rule per active schema through bootstrap; reruns are
      idempotent and never resurrect deleted rules; later activations do not backfill
- [ ] Inaccessible and nonexistent records return identical 404s
- [ ] Rule reads and mutations verify ownership; another user's rules are never visible

## User stories addressed

- User story 14
- User story 15
- User story 16
- User story 17
- User story 18
- User story 19
- User story 26
