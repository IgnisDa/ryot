# Media Translations

## Problem Statement

Ryot users consume media that originates in many languages and regions. A user who
prefers Spanish, Japanese, German, etc. wants media titles, descriptions, and poster
artwork shown in their language rather than always in English.

V1 (the legacy Rust backend) supported this: the user set a language preference per
data provider, and the app fetched and cached translated overlays of media on demand.

V2 (the new entity-based TypeScript backend) has no translation support. Every provider
script hardcodes English (e.g. the TMDB scripts request `en-US`), so every user sees
English regardless of preference. Two scripts (Anilist, Audible) read a language
preference at population time, but because V2 entities are **globally shared** across all
users, this approach is both incomplete and incorrect: the first user to surface an item
permanently fixes its language for everyone (first-writer-wins), and a user's tracking
history is tied to a specific shared entity, so language can never fork the entity itself.

Users need their configured per-provider language reflected on media detail pages
(title, description, image) without breaking the shared/global nature of entities or
their tracking history.

## Solution

- A user keeps a **per-provider language preference** (keyed by a provider "source"
  string). This preference already exists in the user preferences structure and is
  already migrated from V1.
- When a user opens a media item's detail page, if their preferred language for that
  item's provider differs from the item's canonical (default) language, Ryot shows the
  **title, description, and poster image** in their language.
- The first time a translation is needed, the detail page returns the canonical text
  immediately together with a status indicating a translation is being fetched in the
  background. On a subsequent read the translated content appears. Once fetched, it is
  instant and **shared across all users** who prefer that same language.
- **People** (actors, directors, authors) and **media groups** (movie collections, music
  groups, etc.) translate the same way on their own detail pages, for the providers and
  entity kinds that supported translation in V1.
- **Episodic items** (show seasons/episodes, podcast episodes) are first-class entities in
  V2 and translate independently on their own detail pages.
- If a provider has no translation for an item, the canonical text is shown and the system
  does not keep retrying (negative caching).
- **Audiobooks (Audible)** continue to work via marketplace selection. For Audible the
  region changes the item's identity (different marketplace = different ASIN = different
  entity), so it is intentionally **not** modeled as a translation overlay; its existing
  search-time behavior is unchanged. This exclusion is documented in the legacy-bootstrap
  module notes.

## User Stories

1. As a user who prefers Spanish, I want a movie's title and description on its detail page
   shown in Spanish, so that I can understand them in my language.
2. As a user, I want my language preference applied per provider ("source"), so that all
   media from the same provider (e.g. every TMDB-sourced item) use my chosen language
   consistently.
3. As a user, I want the localized poster/image shown when the provider has one, so that
   artwork matches my language/region.
4. As a user, when a translation has not been fetched yet, I want the canonical text shown
   immediately with an indication that translation is in progress, so that the page is
   never blocked.
5. As a user, I want the translated content to appear on a subsequent read/refresh, so that
   I eventually see my language without taking any manual action.
6. As a user, I want translations to load instantly once fetched, so that repeat visits are
   fast.
7. As a user, I want a person's (actor/director/author) name and biography translated on
   their detail page when the provider supports it, so that people pages match my language.
8. As a user, I want media groups (movie collections, music groups, etc.) translated on
   their detail pages, so that grouped media is consistent with my language.
9. As a user viewing a show, I want each season's and episode's title/description translated
   on its own detail page, so that episodic content is localized too.
10. As a podcast user, I want podcast and episode titles/descriptions localized, so that
    podcast pages match my language.
11. As a YouTube Music user, I want track, album, and artist names localized when available,
    so that music metadata matches my language.
12. As an Anilist user, I want to choose how titles are displayed (romaji, native, english,
    or user_preferred), so that titles match my romanization preference.
13. As a user, if the provider has no translation for an item, I want the canonical text
    shown, so that I always see something meaningful.
14. As a user, I do not want the system to repeatedly re-fetch a translation the provider
    does not have, so that performance is not wasted.
15. As a user whose preferred language equals the canonical language, I want no extra
    fetching or storage, so that the common case stays fast.
16. As a user with no language preference for a provider, I want the canonical language
    shown, so that defaults are sensible.
17. As a second user who prefers the same language as someone who already viewed an item, I
    want the translation to appear instantly (shared), so that I benefit from prior fetches.
18. As a user, I want my tracking history, collections, and library to remain intact
    regardless of language, so that changing language never orphans my data.
19. As a migrated V1 user, I want my existing per-provider language preferences carried over,
    so that I do not have to reconfigure them.
20. As an Audible user, I want my marketplace/region selection to keep working, so that I get
    the correct catalog (even though this is not a translation).
21. As a user browsing lists and search results, I want those views to keep working in the
    canonical language even though detail pages are localized, so that browsing is not
    degraded.
22. As an operator, I want each provider to declare its canonical language, so that
    population is deterministic and the shared canonical entity is well-defined.
23. As a developer, I want the translation language-resolution and overlay-merge logic
    isolated in pure, testable modules, so that branching behavior is verified without
    external calls.

## Implementation Decisions

### Overlay storage model

Provider-backed entities in V2 are **global and shared** (one row per provider item, with
no owning user, deduplicated by external id + entity schema + provider script). A user's
localized fields therefore cannot live on the entity row, and the entity's identity must
remain language-independent because tracking events, relationships, collections, and
library membership all reference a specific entity id. Translations are modeled as
**language-keyed overlays** stored separately and shared across all users who prefer a
given language.

A new table, **`entity_translation`**, holds one row per (entity, language):

- `id` — primary key.
- `entityId` — foreign key to the entity, cascade on delete.
- `language` — the provider-native language string, stored verbatim as it appears in the
  user's preference (e.g. `es-ES`, `english`, `ja`). Not normalized to any universal
  taxonomy.
- `name` — nullable translated title.
- `description` — nullable translated description.
- `image` — nullable translated primary image, using the same stored-image structure as the
  entity's image field.
- `populatedAt` — timestamp (timezone-aware) recording when the overlay was fetched. A row
  exists only after a fetch completes; a row whose `name`/`description`/`image` are all null
  is a **negative cache** ("provider had no translation"), so the system will not refetch.
- `createdAt` / `updatedAt` — timezone-aware timestamps.
- Unique constraint on (`entityId`, `language`).

Rejected alternatives, for the record: storing a per-language map inside the shared entity
row (bloats the hot row, complicates lazy/partial fill, and impedes future localized
indexing); and forking entities per language (would fork the entire relationship/event
graph and break entity identity).

### Module layout (generic → specific gradient, via an inverted hook)

- The generic **entities** module defines a `TranslationOverlay` context tag (an interface
  with a no-op default implementation). The entity detail read path calls this hook; the
  entities module does not depend on the translations module.
- A new **specific `translations` module** owns the `entity_translation` table, its
  repository, the overlay-resolution service, and the background translate workflow. It
  provides the live implementation of the `TranslationOverlay` hook.
- The application composition layer wires the translations live implementation into the
  entities hook. This mirrors the existing inverted-hook pattern used for entity population
  (population trigger defined in the generic module, live implementation provided by the
  specific population module, wired at the composition layer).

### Two extracted pure (deep) modules

Both are pure, perform no I/O, and have small, stable interfaces:

1. **Language resolution** — given the user's preferences, the entity's provider source, and
   the provider's canonical language, returns either a "render canonical" instruction
   (meaning: no overlay, no fetch) or a "translate" instruction carrying the resolved
   provider-native language string. Rules: if there is no preference for the source, or the
   resolved preference equals the canonical language, the result is "render canonical";
   otherwise it is "translate" with that language.
2. **Overlay merge** — given the canonical entity and either an overlay row or nothing,
   returns the merged entity plus a translation status. Rules: no row → status `pending`
   (the caller should trigger a fill); a row with at least one non-null field → merge
   `name` over the entity name, `image` over the entity image, and `description` over the
   entity's description property, status `ready`; a row whose fields are all null → status
   `none` (render canonical, do not refetch).

### Entity detail read integration

The entity detail read path, after building the entity from storage, invokes the
`TranslationOverlay` hook with the entity and the current user. The hook applies language
resolution and overlay merge. On a `pending` result it requests a background translate fill
(fire-and-forget) and returns the canonical entity. The read response carries a
`translationStatus` field with one of: `pending`, `ready`, `none`. List and search/query
views are unchanged and continue to render the canonical language.

### Provider/source identity and canonical language

The sandbox script metadata gains an optional `providerInformation` object with:

- `source` — the provider key. Declared on all provider scripts; it is the grouping key for
  language preferences, so multiple scripts that share a provider (e.g. all TMDB scripts)
  share one preference.
- `canonicalLanguage` — optional; present only on scripts that support translation. Its
  presence signals translatability, and its value is the language the canonical (shared)
  entity is populated in.

A script's own stored metadata is exposed back to its drivers as a second argument — the
**script-metadata context** (carrying `metadata` alongside `sandboxScriptId`) — so a
`details` driver reads its own `providerInformation.canonicalLanguage` directly (replacing
hardcoded English) rather than the host mutating the driver input. The Anilist canonical
title language is **english** (other modes become overlays); user-preferred cannot be
canonical because it is viewer-dependent and thus non-deterministic for a shared entity.

### Source key rename (mechanical V1 → V2 mapping)

V2 provider source keys use kebab-case matching V1's token structure, so the V1 → V2
mapping is a pure underscore-to-hyphen transform. Auditing all V1 `MediaSource` values
against V2 source keys, only **two** mismatch and must be renamed:

- `musicbrainz` → `music-brainz`
- `google-book` → `google-books`

Each rename updates the script slug, the declared `providerInformation.source`, the script
asset name, and the provider-to-slug mapping used by legacy-bootstrap entity migration. All
other sources (tmdb, tvdb, anilist, itunes, igdb, vndb, metron, spotify, hardcover,
myanimelist, listennotes, openlibrary, giant-bomb, manga-updates, youtube-music, audible)
already map cleanly.

### Translate driver contract

Translation-capable provider scripts implement a new `translate` driver:

- Input: the entity's external id, its entity schema slug, its stored properties, and the
  target language.
- Output: an object with optional `name`, `description`, and `image` fields (image using the
  stored-image structure). Missing fields are treated as "provider has nothing for this
  field."

The properties are passed because some kinds need more than the external id to address the
provider. In particular, show seasons/episodes use a flat provider id as their external id
but require the parent series id plus season/episode numbers to fetch a translation, so the
episodic provider scripts must **store the parent reference** (e.g. the parent show's
external id, and the existing season/episode numbers) on child-entity properties during
population.

### Translate workflow

- A background durable workflow performs the fill. Its payload carries the entity id,
  external id, entity schema slug, entity properties, target language, and the provider
  script id.
- It runs with no owning user, because the target language is supplied directly and the
  resulting overlay is global/shared.
- Idempotency key is derived from the entity id and the language, so concurrent requests for
  the same (entity, language) coalesce into one execution and one provider call.
- It runs the provider's `translate` driver, then upserts a single `entity_translation` row
  for (entity, language), setting `populatedAt`. When the provider returns nothing, it still
  writes the row with null fields (negative cache).
- **No fan-out:** opening a show does not bulk-translate its seasons/episodes; each entity is
  translated when its own detail page is viewed (consistent with the detail-only read scope).
- **No automatic invalidation:** overlays persist; if the canonical entity is later
  re-populated, existing overlays are left as-is for now.

### Anilist and TMDB population refactor

Remove population-time user-language reads from the Anilist `details` flow; `details` now
produces the canonical (english) title, and per-user title modes are served as overlays via
the `translate` driver. The TMDB `details` flow reads its canonical language from the
script-metadata context instead of a hardcoded value. (Audible is **not** refactored — see Out of Scope.)

### Translation coverage matrix (the exact provider/kind pairs V1 supported, minus Audible)

- **tmdb** — movie, show, show season, show episode, person, movie group; fields: name,
  description, image.
- **tvdb** — movie, show, season/episode, person, movie group; fields: name, description,
  image.
- **anilist** — anime, manga; field: name (english canonical, other modes as overlays).
- **itunes** — podcast and podcast episode (episode-level); fields: name, description.
- **youtube-music** — music, music group, person; field: name.

Anilist person/company and all company entities are not translated (V1 had no such
implementation). For any (provider, kind) without a `translate` driver, the workflow records
a negative-cache row.

### Legacy-bootstrap

- The user-preferences migration applies the underscore-to-hyphen normalization to each
  preference `source` so migrated keys match V2 source keys.
- The entity provider-to-slug migration mapping is updated for the two renamed sources.
- The module notes document that Audible language is a marketplace/identity concern and is
  intentionally excluded from translation overlays.
- Per the legacy-bootstrap module policy, these changes are validated manually (restore dump,
  run migration, inspect rows), not via automated tests.

## Testing Decisions

Good tests assert externally observable behavior and branching owned by the application, not
implementation details or third-party library behavior. They avoid asserting that a schema
parses, that a value assigned equals itself, or that a framework works. Provider HTTP is not
hit directly; the sandbox host call is mocked.

Modules to be tested (planned for long-term health):

- **Language resolution (pure unit tests):** per-source match; no preference for the source →
  render canonical; preference equal to canonical → render canonical; a differing preference
  → translate with the provider-native language; correct grouping of multiple scripts under
  one source. Prior art: existing app-backend unit tests for pure helpers.
- **Overlay merge (pure unit tests):** merge of name/description/image over canonical; partial
  overlays (some fields null); negative-cache row (all fields null, `populatedAt` set) →
  status `none`; missing row → status `pending`. Prior art: existing app-backend pure-helper
  unit tests.
- **Translate drivers (sandbox tests with mocked HTTP):** each in-scope provider's `translate`
  driver maps a representative provider response to the expected `name`/`description`/`image`
  for the requested language, including the episodic parent-reference path. Prior art: the
  existing sandbox host-function and provider sandbox tests that mock the host HTTP call.
- **End-to-end translation flow (integration tests):** a detail read with a non-canonical
  preference and no overlay returns canonical with status `pending`; polling until the overlay
  row is populated then re-reading returns merged localized fields with status `ready`; a
  second user with the same language reuses the single shared overlay (no second fetch); source
  resolution governs items from different scripts of the same provider (e.g. a movie script and
  a show script share the provider preference); an episode translates via its stored parent
  reference; a provider with no translation yields status `none` and no refetch; preference
  equal to canonical (and no preference) yields status `none` with no row and no fetch. Prior
  art: the existing entity population-dispatch integration test, which surfaces a partial
  entity and polls until it is populated.

## Out of Scope

- Localized list, search, and sort (translating query-engine list views). Lists render the
  canonical language; only detail reads are localized in this work.
- Treating Audible (or any marketplace/region-as-identity provider) as a translation overlay.
  Audible's existing search-time marketplace behavior is unchanged.
- Translating company entities, and translating Anilist person/company entities (V1 had no
  such translation).
- Automatic invalidation or TTL-based refresh of overlays when canonical data is re-populated.
- Migrating V1 `entity_translation` rows; overlays refill lazily on demand.
- A localized full-text/trigram search index for translated values.
- User-facing UI for editing the per-provider language preference; the preference structure is
  assumed to exist (and is already migrated). Frontend rendering of `translationStatus` is a
  client concern beyond this backend PRD.
- Translating user-created custom (non-provider) entities, which have no external provider.

## Further Notes

- The per-provider language preference shape already exists in V2 and is already migrated from
  V1; this work makes the provider `source` first-class on script metadata and adds the
  canonical language, rather than introducing a new preference shape.
- `translationStatus` enum values are `pending`, `ready`, and `none`. `pending` means a fill
  was (re)requested; `ready` means at least one localized field is shown; `none` means the
  canonical text is shown and no translation exists or is needed.
- The translate workflow's failure/retry policy should avoid a permanent `pending` state: it
  must either upsert a result (including an empty negative-cache row when the provider has no
  data) or remain cleanly re-executable on the next read. This is an operational consideration
  to confirm during implementation.
- Audible was originally grouped with Anilist as a "bake-at-populate" case; exploration showed
  the Audible marketplace changes the item's external id (ASIN), making it identity rather than
  a display overlay, hence its exclusion.

---

## Tasks

**Overall Progress:** 3 of 8 tasks completed

**Current Task:** [Task 04](./04-anilist-translation-and-details-refactor.md) (todo)

### Task List

| #   | Task                                                                                                   | Type | Status |
| --- | ------------------------------------------------------------------------------------------------------ | ---- | ------ |
| 01  | [TMDB Movie Translation — Spine](./01-tmdb-movie-translation-spine.md)                                 | AFK  | done   |
| 02  | [TMDB People and Movie Groups](./02-tmdb-people-and-movie-groups.md)                                   | AFK  | done   |
| 03  | [TMDB Shows, Seasons, and Episodes](./03-tmdb-shows-seasons-episodes.md)                               | AFK  | done   |
| 04  | [Anilist Translation and Canonical details Refactor](./04-anilist-translation-and-details-refactor.md) | AFK  | todo   |
| 05  | [iTunes Podcasts and YouTube Music](./05-itunes-podcasts-and-youtube-music.md)                         | AFK  | todo   |
| 06  | [TVDB Translation](./06-tvdb-translation.md)                                                           | AFK  | todo   |
| 07  | [Source-Key Rename and Legacy-Bootstrap](./07-source-key-rename-and-legacy-bootstrap.md)               | HITL | todo   |
| 08  | [Codebase Cleanup](./08-codebase-cleanup.md)                                                           | AFK  | todo   |
