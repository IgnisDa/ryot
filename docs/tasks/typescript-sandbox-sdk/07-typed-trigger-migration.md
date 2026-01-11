# Typed Trigger Migration

**Parent Plan:** [TypeScript Sandbox SDK and Compilation](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Implement the trigger authoring and execution path from the Static Manifest, Driver Contracts, Built-In Compilation, and End-to-End Test Package Migration sections. Add typed before-create and after-create definitions, migrate all five built-in triggers, convert integration-push helpers to ordinary TypeScript imports, and preserve event workflow behavior through direct, compiled, and E2E tests.

Before-create definitions must validate allow, skip with reason, and replacement-body outputs. After-create definitions must validate no result while retaining side effects. Trigger manifests declare their mode, exact capabilities, and configuration needs, and registration/seeding must agree with that declaration. Convert auto-complete, integration progress policy, Jellyfin push, Radarr push, and Sonarr push without changing their product semantics.

## Acceptance criteria

- [ ] The SDK exposes distinct before-create and after-create trigger definitions with inferred input and output types
- [ ] Before-create output validation accepts allow, skip, and replace and rejects malformed actions
- [ ] After-create output validation accepts no value and rejects incompatible result contracts
- [ ] All five built-in trigger sources are TypeScript modules compiled through the trusted pipeline
- [ ] Shared integration-push helpers use ordinary imports and are bundled into consuming modules
- [ ] Trigger manifests declare mode and exact capabilities, and seeding or registration matches those declarations
- [ ] Auto-complete behavior remains correct for non-episodic, anime, manga, repeated completion, and inherited-property cases
- [ ] Integration progress policy preserves minimum filtering, maximum replacement, duplicate suppression, and completion debounce
- [ ] Jellyfin, Radarr, and Sonarr push behavior and expected non-fatal integration failures remain unchanged
- [ ] Direct trigger tests use SDK test hosts rather than evaluating source strings
- [ ] Compiled Deno tests cover one before-create and one after-create trigger
- [ ] End-to-end trigger tests use typed TypeScript source and structured execution errors
- [ ] Check, tests, and build pass

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
