# Shared Entity Population Refactor

**Parent Plan:** [V2 Importing Infrastructure](./README.md)

**Type:** AFK

**Status:** done

## What to build

Extract provider-backed entity population from `apps/app-backend/src/modules/entities/worker.ts` into reusable domain code used by both `/entities/import` and the new import processor. This is a prerequisite for provider-backed media source imports.

The shared function should preserve the current entity import behavior: dedupe populated global entities by provenance, run sandbox details scripts through child jobs from worker context, validate details results against entity schemas, process related entities, update global entity properties/image/populated timestamp, and optionally link the entity into the user's library. Do not refactor or delete `modules/media/worker.ts` unless type errors or checks require it.

## Acceptance criteria

- [x] Entity population logic currently embedded in `processEntityImportJob` is available through a shared function usable by both the entity worker and import processor.
- [x] `/entities/import` behavior remains intact and uses the shared function.
- [x] The shared function executes provider scripts through sandbox child jobs when called from worker context; no direct non-job sandbox execution path is introduced.
- [x] Existing populated global entities with `populatedAt != null` skip provider work while still supporting optional library linking.
- [x] Existing unpopulated global entities can be populated by the shared function.
- [x] Related entities returned by provider scripts are processed with the existing generic related-entity behavior.
- [x] Library linking is parameterized and import callers can request it before writing events.
- [x] Provider script failures and invalid details results surface as typed/domain errors the import processor can map to `provider_details` failure rows.
- [x] Incomplete details are detectable as `populatedAt === null` after attempted population.
- [x] Existing entity worker tests are updated to cover the shared function without regressing `/entities/import` polling/import behavior.

## User stories addressed

Reference by number from the parent PRD:

- User story 13
- User story 14
- User story 21
