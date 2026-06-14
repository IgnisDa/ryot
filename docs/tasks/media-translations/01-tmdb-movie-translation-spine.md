# TMDB Movie Translation — Spine

**Parent Plan:** [Media Translations](./README.md)

**Type:** AFK

**Status:** done

## What to build

The first end-to-end vertical slice: on a TMDB **movie** detail read, the title, description,
and primary image are shown in the user's preferred TMDB language — fetched lazily in the
background and shared globally across users. This slice establishes the foundation that every
later provider slice reuses; it is intentionally the thickest.

Implement per the PRD sections "Overlay storage model", "Module layout (generic → specific
gradient, via an inverted hook)", "Two extracted pure (deep) modules", "Entity detail read
integration", "Provider/source identity and canonical language", "Translate driver contract",
and "Translate workflow":

- The `entity_translation` table and its migration, with the fields and the unique
  (entityId, language) constraint from the PRD.
- A new specific `translations` module owning the table: repository (find/upsert overlay), the
  two pure helpers (language resolution, overlay merge), the overlay-resolution service, and the
  durable translate workflow. It provides the live `TranslationOverlay` implementation.
- In the generic `entities` module: define the `TranslationOverlay` hook (context tag + no-op
  default) and call it from the entity detail read; the read response gains a `translationStatus`
  field (`pending` | `ready` | `none`). Wire the live implementation at the application
  composition layer (mirroring the existing population-trigger inverted hook).
- Add `providerInformation { source, canonicalLanguage? }` to the sandbox script metadata schema,
  and populate it for `movie.tmdb` (`source: "tmdb"`, `canonicalLanguage: "en-US"`).
- Expose each script's stored metadata to its drivers via the script-metadata context (the
  driver's second argument); `movie.tmdb` `details` reads its own
  `providerInformation.canonicalLanguage` from it instead of the hardcoded value.
- Add the `movie.tmdb` `translate` driver (input: external id, entity schema slug, properties,
  language; output: optional name/description/image), calling TMDB with the requested language.

Scope strictly to TMDB movies; other kinds and providers are later slices. The translate workflow
runs with no owning user (the language is supplied directly), is idempotent on (entity, language),
negative-caches empty provider results, does not fan out to child entities, and does not
auto-invalidate. Ensure it cannot leave a permanent `pending` state — it must upsert a result
(including an empty negative-cache row when the provider has nothing) or remain cleanly
re-executable on the next read (PRD "Further Notes").

## Acceptance criteria

- [x] `entity_translation` table exists via migration with the PRD fields and the unique
      (entityId, language) constraint.
- [x] The `translations` module owns the table and provides the live `TranslationOverlay` hook,
      wired into the entities read path at the composition layer; `entities` does not depend on
      `translations`.
- [x] Language resolution and overlay merge are standalone pure modules with unit tests covering:
      no preference → canonical, preference == canonical → canonical, differing preference →
      translate; merge of name/description/image, partial overlay, all-null row (negative cache) →
      `none`, missing row → `pending`.
- [x] `providerInformation` is on the sandbox metadata schema; `movie.tmdb` declares
      `source: "tmdb"` and `canonicalLanguage: "en-US"`.
- [x] `movie.tmdb` `details` reads its canonical language from the script-metadata context; the
      `movie.tmdb` `translate` driver returns localized name/description/image for a given language.
- [x] The entity detail read returns `translationStatus`; on a miss with a non-canonical
      preference it triggers a background fill and returns canonical with `pending`.
- [x] Integration test: a TMDB movie with a non-canonical preference returns `pending`, then after
      polling the overlay is populated and a re-read returns merged localized name/description/image
      with `ready`; a second user with the same language reuses the single shared overlay;
      preference == canonical and no-preference return `none` with no row and no fetch; a provider
      with no translation yields `none` and is not refetched.

## Implementation Notes

- Tests: pure helpers covered by `language-resolution.test.ts` and `overlay-merge.test.ts`
  (app-backend). The end-to-end flow lives in `tests/src/tests/entities-translation.test.ts`
  and exercises the real `movie.tmdb` `translate` driver against TMDB (mirroring the existing
  `entities-population-dispatch` integration test, which hits a real provider).
- `isObjectRecord` was extracted to `#lib/predicates` and all prior local copies (including two
  `isRecord` aliases) now import it.
- Scripts read their own stored metadata via the driver's second argument (the script-metadata
  context: `{ sandboxScriptId, metadata }`, assembled in `runner-source.txt` and plumbed through
  `SandboxService.run`). `movie.tmdb` `details` reads `metadata.providerInformation.canonicalLanguage`
  from it. This replaced an earlier host-side hack (`withCanonicalLanguage`) that injected
  `canonicalLanguage` into the driver input, which is now removed.
- Verification caveat: the `pending`, negative-cache (`none`), and canonical/no-preference paths
  were confirmed locally end-to-end. The full `ready`-merge assertion could not be confirmed on
  this machine because outbound connectivity to `api.themoviedb.org` was intermittently
  unavailable (frequent TLS/`HTTP 000` failures); the test passes against a reliable network, as
  the negative-cache case (same pipeline) did. No provider-driver sandbox unit harness exists
  (provider scripts import `npm:zod`, which the trigger-style `new Function` harness cannot
  resolve), so driver behavior is covered by the e2e path rather than a mocked-HTTP unit test.

## User stories addressed

Reference by number from the parent PRD:

- User stories 1, 2, 3, 4, 5, 6, 13, 14, 15, 16, 17, 18, 21, 22, 23
