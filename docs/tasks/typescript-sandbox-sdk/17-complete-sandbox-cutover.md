# Complete Sandbox Cutover

**Parent Plan:** [TypeScript Sandbox SDK and Compilation](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Complete the integrated cutover after Tasks 01 through 16. Verify that every former JavaScript source has an authoritative TypeScript or generated compiled replacement, remove all remaining fragment loaders and compatibility scaffolding, update owned documentation, and run the complete SDK, backend, and end-to-end verification surface described by the Current-State Replacement, Built-In Compilation, End-to-End Test Package Migration, Testing Decisions, and Further Notes sections.

This slice must not perform another provider redesign. Its purpose is to close gaps between completed family migrations, ensure the generated registry contains all 52 providers and five triggers exactly once, ensure the Deno runner and three former helper fragments are represented correctly, and prove no runtime or test path can execute raw TypeScript or legacy JavaScript fragments. The intentionally gated live provider smoke suite may remain gated, but it must compile against the new contracts and its documented invocation must remain valid.

## Acceptance criteria

- [ ] All 61 former JavaScript sandbox sources have authoritative TypeScript-authored or generated compiled replacements as defined by the parent PRD
- [ ] The generated registry contains 52 providers and five triggers exactly once with validated manifests
- [ ] The Deno runner is TypeScript-authored, Deno-checked, compiled ahead of execution, and loaded with the approved runtime import map
- [ ] The three former helper fragments are ordinary TypeScript modules with no top-level fragment returns or string injection
- [ ] No sandbox runtime path uses dynamic function construction, raw TypeScript execution, legacy driver registration, direct npm specifiers, or unversioned package cache entries
- [ ] Obsolete raw-text declarations, Vitest loaders, import rewriters, helper injectors, JavaScript lint overrides, and unused vendoring code are removed
- [ ] Backend and test documentation describes SDK modules, compilation, persistence, capabilities, limits, ESM execution, E2E promotion, and structured errors accurately
- [ ] The end-to-end package contains no legacy `driver(...)` source generation and no uncompiled executable SQL fixture
- [ ] Built-in source and generated output freshness is enforced by check, test, build, and development workflows
- [ ] Every built-in compiles and loads in Deno under production permissions and limits
- [ ] SDK package check and tests pass
- [ ] Backend package check and tests pass
- [ ] End-to-end package check and full hermetic suite pass
- [ ] Repository-wide Turbo check and build pass
- [ ] The live smoke suite remains gated, type-checks, and documents any dependency/API adaptation made during migration
- [ ] No compatibility behavior outside the parent PRD's beta policy remains

## User stories addressed

- User story 1
- User story 23
- User story 32
- User story 33
- User story 35
- User story 36
- User story 41
- User story 42
- User story 43
- User story 44
- User story 45
