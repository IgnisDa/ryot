# Typed Trigger Migration

**Parent Plan:** [TypeScript Sandbox SDK and Compilation](./README.md)

**Type:** AFK

**Status:** done

## What to build

Implement the trigger authoring and execution path from the Static Manifest, Driver Contracts, Built-In Compilation, and End-to-End Test Package Migration sections. Add typed before-create and after-create definitions, migrate all five built-in triggers, convert integration-push helpers to ordinary TypeScript imports, and preserve event workflow behavior through direct, compiled, and E2E tests.

Before-create definitions must validate allow, skip with reason, and replacement-body outputs. After-create definitions must validate no result while retaining side effects. Trigger manifests declare their mode, exact capabilities, and configuration needs, and registration/seeding must agree with that declaration. Convert auto-complete, integration progress policy, Jellyfin push, Radarr push, and Sonarr push without changing their product semantics.

## Acceptance criteria

- [x] The SDK exposes distinct before-create and after-create trigger definitions with inferred input and output types
- [x] Before-create output validation accepts allow, skip, and replace and rejects malformed actions
- [x] After-create output validation accepts no value and rejects incompatible result contracts
- [x] All five built-in trigger sources are TypeScript modules compiled through the trusted pipeline
- [x] Shared integration-push helpers use ordinary imports and are bundled into consuming modules
- [x] Trigger manifests declare mode and exact capabilities, and seeding or registration matches those declarations
- [x] Auto-complete behavior remains correct for non-episodic, anime, manga, repeated completion, and inherited-property cases
- [x] Integration progress policy preserves minimum filtering, maximum replacement, duplicate suppression, and completion debounce
- [x] Jellyfin, Radarr, and Sonarr push behavior and expected non-fatal integration failures remain unchanged
- [x] Direct trigger tests use SDK test hosts rather than evaluating source strings
- [x] Compiled Deno tests cover one before-create and one after-create trigger
- [x] End-to-end trigger tests use typed TypeScript source and structured execution errors
- [x] Check, tests, and build pass

## Implementation notes

- Added the explicit `@ryot/sandbox-sdk/trigger` surface with mode-specific manifests, typed before-create and after-create contexts, allow/skip/replace and void result schemas, capability-narrowed hosts, and definitions that expose the runtime `trigger` driver.
- Extended user and trusted compilation to allow the trigger SDK entry point, statically recognize both trigger definition helpers, verify manifest kind and mode, and bundle the definition runtime into format-1 modules.
- Converted auto-complete, integration progress policy, Jellyfin push, Radarr push, and Sonarr push to `.sandbox.ts` modules. The integration-push fragment is now an ordinary typed helper import shared by the three push triggers.
- Generated registry entries now provide source, compiled code, format, and manifests for all five triggers. Event-schema trigger links derive their phase, script slug, and name from those manifests so registration cannot drift from the compiled declaration.
- Added `after_create` to the dispatched after-trigger context so both SDK trigger inputs have an explicit runtime phase discriminant. The backend Effect before-trigger decoder is constrained to the SDK JSON result contract, and public script contracts now preserve trigger manifests and modes.
- Replaced direct source evaluation in trigger unit tests with SDK test hosts and driver validation. Added direct auto-complete coverage, compiler and manifest coverage, before/after Deno loading, and SDK-based before-create E2E source fixtures.

## Problems and deviations

- The first E2E fixture source embedded one concrete behavior as a typed constant, so TypeScript correctly narrowed away the fixture's throwing branch. The builder now serializes the controlled behavior as JSON and parses it inside the generated module, keeping one valid typed source template without interpolating executable test input.
- One combined E2E run had a transient timeout in the `consumedOn` auto-complete case after all neighboring trigger cases passed. The case passed alone, and the complete 13-case built-in trigger suite passed on rerun; no product change was needed.
- The plan did not explicitly require adding `phase: "after_create"` to the existing after-trigger context. It was added because the distinct typed input schemas need the same authoritative phase discriminator already present for before-create triggers; existing fields and trigger behavior remain unchanged.
- No blocker remained. Suppression-based negative type fixtures were intentionally not used; positive type assertions and runtime schema rejection cover the contracts using the repository's established test style.

## Verification

- `bun run check && bun run test` in `libs/sandbox-sdk`: check passed and 10 tests passed.
- Focused backend trigger, compiler, registry, Effect-parity, and Deno integration coverage passed.
- `bun run test` in `apps/app-backend`: 145 files and 880 tests passed.
- `bun run test -- src/events/triggers-before-create.test.ts` in `tests`: 4 tests passed.
- `bun run test -- src/events/triggers.test.ts` in `tests`: 13 tests passed.
- `bun turbo --filter=@ryot/app-backend check` passed without warnings.
- `bun turbo --filter=@ryot/app-backend build` passed and embedded all six generated format-1 modules.

## User stories addressed

- User story 5
- User story 31
- User story 32
- User story 33
- User story 34
- User story 35
- User story 36
- User story 44
- User story 45
