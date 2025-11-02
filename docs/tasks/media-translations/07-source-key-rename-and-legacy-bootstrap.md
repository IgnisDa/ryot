# Source-Key Rename and Legacy-Bootstrap

**Parent Plan:** [Media Translations](./README.md)

**Type:** HITL

**Status:** todo

## What to build

Cross-cutting source-key consistency and the migration changes that depend on it. See PRD
"Source key rename (mechanical V1 → V2 mapping)" and "Legacy-bootstrap".

- Rename the only two mismatched provider sources so the V1 → V2 mapping is a pure
  underscore-to-hyphen transform: `musicbrainz` → `music-brainz` and `google-book` →
  `google-books`. Each rename updates the script slug, the declared `providerInformation.source`,
  the script asset, and the provider-to-slug mapping used by legacy-bootstrap entity migration.
- Declare `providerInformation.source` on all remaining provider scripts (non-translatable
  providers get `source` only, with no `canonicalLanguage`).
- In legacy-bootstrap: apply the underscore-to-hyphen normalization to each migrated preference
  `source` so migrated keys match V2 source keys; update the entity provider-to-slug mapping for the
  two renamed sources; and document in the module notes that Audible language is a
  marketplace/identity concern (different marketplace = different ASIN = different entity),
  intentionally excluded from translation overlays.

**HITL rationale:** per the legacy-bootstrap module policy, these changes are validated manually —
restore a V1 dump, run the migration, and inspect the migrated rows — rather than via automated
tests. A human must perform and confirm that validation before this slice is considered done.

## Acceptance criteria

- [ ] `musicbrainz` → `music-brainz` and `google-book` → `google-books` are renamed across slug,
      `providerInformation.source`, script asset, and legacy-bootstrap mapping target.
- [ ] All provider scripts declare `providerInformation.source`; translatable providers additionally
      declare `canonicalLanguage`.
- [ ] Legacy-bootstrap normalizes migrated preference sources with the underscore-to-hyphen
      transform so they match V2 source keys.
- [ ] The Audible exclusion rationale is documented in the legacy-bootstrap module notes.
- [ ] Manual validation performed: a restored V1 dump run through the migration yields preferences
      whose `source` keys match V2 and entities mapped to the renamed slugs; results inspected and
      confirmed.

## User stories addressed

Reference by number from the parent PRD:

- User story 19
- User story 20
