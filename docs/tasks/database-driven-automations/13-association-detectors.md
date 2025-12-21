# Association Detectors

**Parent Plan:** [Database-Driven Automations, Signals, and Subscriptions](./README.md)

**Type:** AFK

**Status:** done

## What to build

The four person/company association signals, per the PRD's Built-In Signal Catalog, Detection
Behavior (associations), and Deterministic Identity sections.

Seed `person.media.associated`, `person.media-group.associated`, `company.media.associated`, and
`company.media-group.associated` with the PRD's property contract (subject name, associated name,
role) and related-users audience policies resolving monitors of the person or company, plus one
detector script and its global rules on the credit relationship schemas.

Credit edges have two writers resolving one canonical identity: media-rooted detail population
additively writes incoming credit edges, and person/company-rooted population authoritatively
owns that subject's filmography. The detector runs on a canonical edge create regardless of which
root appears as the scope entity, using the person/company endpoint as the signal subject and the
other endpoint as the associated name. A material update emits only roles newly added relative to
the immediate before snapshot; identical writes, already-present roles, removed roles, and
deletions emit nothing. An authoritative delete followed by an additive re-create may notify
again — accepted churn.

Initial-population silence is asymmetric per the PRD: the detector stays silent only when the
unpopulated root is the person/company subject itself; first population of a media entity still
announces its credits to users monitoring those persons/companies. Per-role emissions rely on the
per-emission signal-ID discriminator (subject endpoint plus role), so one occurrence may emit
several distinct signals of one schema while replay still deduplicates.

Builds on task 12. Verifiable end-to-end: populating new media credits a monitored person and
their monitors are notified once per role.

## Acceptance criteria

- [x] All four schemas seed with the PRD's contract; the detector uses the person/company
      endpoint as subject regardless of scope entity
- [x] Media-first, person/company-first, and concurrent discovery of one canonical edge produce
      exactly one create classification and one emission; an identical second write is a noop
      emitting nothing
- [x] Updates emit once per newly added role and nothing for unchanged or removed roles; a real
      delete/re-create cycle may notify again
- [x] A monitored person/company's own first population emits no association signals; first
      population of a media entity still emits for monitored credit subjects
- [x] Replay of a multi-role emission produces no duplicate signals
- [x] The audience is exactly the monitors of the credited person/company

## Implementation notes

- Added one built-in credit-edge detector for create, update, and delete occurrences on every
  person/company credit relationship schema, including company-to-media-group schemas matching the
  existing person group scopes. It selects the canonical person/company source endpoint
  independently of the population root and emits one signal for each distinct new role using a
  stable subject-and-role discriminator.
- Added strict active contracts for all four association signal schemas and extended the shared
  notification formatter while retaining the media-monitoring relationship as the generic
  related-user audience resolver.
- Added synchronization coverage for media-first, subject-first, concurrent, and repeated writes;
  detector coverage for all four signal variants, asymmetric first-population behavior, role
  changes, deletion, and replay; and an offline E2E import proving two roles notify only the
  credited person's monitor.

## User stories addressed

- User story 8
- User story 9
- User story 10
