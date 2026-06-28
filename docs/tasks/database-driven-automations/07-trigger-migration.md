# Trigger Migration

**Parent Plan:** [Database-Driven Automations, Signals, and Subscriptions](./README.md)

**Type:** AFK

**Status:** todo

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

- [ ] Auto-complete fires on full progress with the consumed-on date inherited via rule metadata,
      matching pre-migration behavior
- [ ] Integration progress events are filtered by the configured minimum/maximum through the
      policy chain, matching pre-migration behavior
- [ ] Radarr, Sonarr, and Jellyfin pushes fire as subscriptions on the same occasions as before
- [ ] Records created by these subscriptions carry the automation origin and do not re-trigger
      unbounded chains in existing flows
- [ ] The trigger table, its repository methods, and its execution path are deleted; no
      production code references them
- [ ] Documentation no longer presents the trigger model as current behavior

## User stories addressed

- User story 23
- User story 24
- User story 25
- User story 34
