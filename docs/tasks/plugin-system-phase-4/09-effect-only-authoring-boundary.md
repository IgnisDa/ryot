# Effect-Only Authoring Boundary

**Parent Plan:** [Plugin System - Phase 4](./README.md)

**Status:** done

## What to build

Enforce the public Effect-only boundary described in "Effect boundary" without rewriting necessary
platform adapters. Read the overview, Phase 4 plan, parent PRD, and this task first.

Audit sandbox definitions, SDK exports, host contracts, backend implementations, bridge dispatch,
and compiler/runtime compatibility shims. Remove public Promise-returning authoring or legacy host
APIs, derive bridge types from canonical schemas where possible, and add focused static/type/runtime
checks. Keep Promise interop private when required by Deno, fetch, filesystem, Redis, or third-party
libraries and wrap it behind Effect.

## Acceptance criteria

- [x] Sandbox definition run functions and public SDK host methods expose Effect values only
- [x] Backend host implementations and typed bridge dispatch compose Effect without compatibility overloads
- [x] No legacy Promise host API or dual authoring path remains exported
- [x] Private Promise adapters are narrowly scoped and do not leak through plugin-facing types
- [x] Workflow authoring remains deterministic and does not gain ambient async APIs
- [x] Representative compiler/type tests reject raw Promise-authored sandbox definitions
- [x] Existing filesystem, fetch, dependency-client, and runner behavior remains functional
- [x] SDK, compiler, backend, media, and fitness checks/tests pass

## Implementation notes

The audit found the public boundary already complete from the plugin rewrite. Sandbox definition and
host types derive Effect-returning methods from canonical SDK contracts, and backend bridge dispatch
preserves those types through schema decoding and encoding. Existing static tests reject raw Promise
definitions and implementations; runtime bridge coverage verifies bound calls remain Effects.

Promise interop remains only in private compiler, runner, filesystem, Redis, third-party, and test
adapters, where it is wrapped with Effect. No compatibility API, dual authoring path, production
behavior, or e2e assertion changed in this task.

## User stories addressed

- User story 51
- User story 52
