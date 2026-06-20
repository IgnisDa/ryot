# Signal Persistence and Emission Service

**Parent Plan:** [Database-Driven Automations, Signals, and Subscriptions](./README.md)

**Type:** AFK

**Status:** todo

## What to build

The signal storage layer and the single emission service every producer will use. Implement the
`signal_schema`, `signal`, and `signal_recipient` tables exactly as specified in the PRD's
Persistence section, their owning repositories, the idempotent built-in seeding path with loud
contract-drift failure, and the emission service: schema load, property validation, actor
derivation from a hidden principal, subject authorization, the one generic audience resolver for
both policy kinds (actor and related-users), atomic signal-plus-recipient insertion, and the
duplicate-emission short-circuit.

Signal IDs are deterministic per the PRD's Deterministic Identity section: emitting execution ID,
schema slug, and a per-emission discriminator, with conflict-do-nothing insertion returning the
existing signal without re-resolving recipients.

No sandbox, rules, or dispatch yet — the service is exercised through service tests with test
signal schemas. Real built-in schemas are seeded in the slices that enable their producers. The
seeding infrastructure (contract check, name/catalog-state updates allowed, hard failure on
slug/properties/audience drift) is what this slice must deliver.

Follow the PRD's Persistence, Model (producers), Deterministic Identity, and Security sections.

## Acceptance criteria

- [ ] The three tables exist with the specified columns, FK behaviors (subject set-null,
      recipient/user cascades), uniqueness conventions, and regenerated migrations
- [ ] Seeding is idempotent across restarts, may update display name and catalog state, and fails
      loudly when a contract field (slug, properties schema, audience policy) differs
- [ ] Emission validates properties against the schema, derives the actor from the hidden
      principal, and rejects unauthorized or missing subjects per audience-policy prerequisites
- [ ] The related-users resolver returns relationship owners for the configured schema and
      subject side; a valid empty audience still persists the signal
- [ ] Recipients are snapshotted atomically with the signal; no caller can supply recipient IDs
- [ ] Duplicate emission returns the existing signal without re-resolving the audience; sibling
      emissions of one schema in one execution get distinct deterministic IDs via the
      discriminator
- [ ] Deleting a user removes their private actor-audience signals, recipient rows, and nothing
      of other recipients' shared history

## User stories addressed

- User story 27
- User story 28
- User story 29
- User story 31
- User story 32
