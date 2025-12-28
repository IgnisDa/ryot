# Trigger Migration

**Parent Plan:** [Database-Driven Automations, Signals, and Subscriptions](./README.md)

**Type:** AFK

**Status:** done

## What to build

Move every consumer of the `event_schema_trigger` table onto automation rules, then delete the
table, per the PRD's Existing Trigger Migration section. This completes Phase 2: automation rules
become the only trigger system.

- The Integration Progress Policy becomes an event-schema create policy (task 06 engine),
  preserving its minimum/maximum progress filtering behavior.
- Auto-Complete on Full Progress becomes an event-schema create subscription. Its
  inherited-properties configuration — copying the consumed-on date from the triggering event
  into the record it creates — moves from the trigger row into the rule's server-owned metadata
  and reaches the script as rule metadata.
- The Radarr, Sonarr, and Jellyfin pushes become subscriptions.
- Delete `event_schema_trigger`, its repository methods, and its execution path once no consumer
  remains; regenerate migrations.

The existing trigger sandbox scripts are already TypeScript built-ins; this slice rebinds them to
automation rules with the automation context, adjusting their entry-point typing as needed.
Writes performed by these subscriptions carry the automation origin with the creating execution's
ID. Update the documentation that presents the trigger model as current behavior (the builtins
module agent guide and the backend agent guide's schema-write-path wording, plus the pinned
workflow owners if ownership moves), per the PRD's Documentation Cutover section.

Builds on tasks 02, 03, 05, and 06. Verifiable by behavior parity: the same user flows that fire
triggers today produce identical records via rules.

## Acceptance criteria

- [x] Auto-complete fires on full progress with the consumed-on date inherited via rule metadata,
      matching pre-migration behavior
- [x] Integration progress events are filtered by the configured minimum/maximum through the
      policy chain, matching pre-migration behavior
- [x] Radarr, Sonarr, and Jellyfin pushes fire as subscriptions on the same occasions as before
- [x] Records created by these subscriptions carry the automation origin and do not re-trigger
      unbounded chains in existing flows
- [x] The trigger table, its repository methods, and its execution path are deleted; no
      production code references them
- [x] Documentation no longer presents the trigger model as current behavior

## Implementation notes

- Built-in event automation links now seed one global policy or subscription rule for every
  matching built-in event schema. Integration progress is the position-100 policy; auto-complete,
  Radarr, Sonarr, and Jellyfin are create subscriptions dispatched through the existing lifecycle
  and subscription-execution workflows.
- The five scripts moved to the automations built-in group and consume strict automation policy or
  event snapshot contexts. Auto-complete reads `inheritedProperties` from server-owned rule
  metadata and creates completion events through the existing sandbox host path, which assigns an
  automation origin using the creating execution ID.
- Removed the legacy table, repositories, services, event workflow branches, test-support API,
  contracts, fixtures, SDK entry point, manifest kind, compiler handling, and obsolete tests. The
  unreleased baseline migration was regenerated as `0000_lethal_shocker.sql`.
- Updated the built-ins/backend agent guides, workflow guide, decisions document, V1-to-V2 gap
  analysis, and Task 06 completion note to describe policies and subscriptions as current behavior.
- Verification covered the backend Turbo check, all 1,132 backend tests, and 34 end-to-end event
  automation and integration tests.

## Problems and deviations

- Drizzle generation initially failed because the retained empty `meta/` directory lacked its
  journal after baseline deletion. Adding the standard empty journal before regeneration resolved
  it; no schema workaround was required.
- The first full backend test run found a stale workflow-boundary assertion that still expected one
  direct event-trigger sandbox child. Updating the ownership pin to require zero direct event
  sandbox workflows fixed the test and records the new subscription workflow boundary.
- Legacy removal was broader than the table-only minimum: the now-unused trigger SDK/manifest and
  compiler support were deleted too. With all built-ins migrated and no independent consumer left,
  retaining that surface would have preserved an unusable second trigger model contrary to this
  task's single-system goal.

## User stories addressed

- User story 23
- User story 24
- User story 25
- User story 34
