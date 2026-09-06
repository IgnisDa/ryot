# Remove Fitness Exercise Preload

## Goal

Replace startup exercise preloading with lazy provider-backed imports. Free Exercise DB exercises are
global entities created when a user adds them or when a fitness import resolves an exact catalog match.

## Product Decisions

- Provider exercise imports are global, matching media provider entities.
- Hevy and Strong resolve exercise names against Free Exercise DB.
- Resolution uses exact normalized names only; it does not guess synonyms or fuzzy matches.
- A catalog kind mismatch is unresolved for that import.
- Unresolved names and kind mismatches reuse or create user-owned custom exercises.
- Provider execution failures fail the import item instead of silently creating custom data.
- Existing provider entities remain in place; removal does not delete persisted exercises.

## Implementation

- [x] Add optional provider resolution metadata to generic import entity intents.
- [x] Resolve providers and compose the canonical provider entity import workflow.
- [x] Preserve generic user-entity fallback for unresolved and incompatible results.
- [x] Add exact normalized-name resolution to the Free Exercise DB provider.
- [x] Make Hevy and Strong exercise intents provider-aware.
- [x] Remove exercise preload scripts, configuration, boot declaration, and tests.
- [x] Remove the unused system plugin boot lifecycle surface.
- [x] Replace E2E seeded-exercise assumptions with explicit exercise fixtures.
- [x] Update import documentation and generated configuration documentation.
- [x] Complete affected E2E verification.
- [x] Complete repository checks and non-E2E tests.
- [x] Complete review and re-review.

## Acceptance Criteria

- A fresh server does not fetch or persist exercises during startup.
- Provider Add creates or reuses a global exercise.
- Known compatible Hevy and Strong exercises use global provider entities.
- Unknown or kind-incompatible imported exercises use user-owned custom entities.
- Workout events reference the selected exercise entity.
- No exercise preload setting or system plugin boot API remains.
- Normal E2E execution has no Free Exercise DB startup dependency.
