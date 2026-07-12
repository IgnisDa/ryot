# Effect-Only Authoring Boundary

**Parent Plan:** [Plugin System - Phase 4](./README.md)

**Status:** todo

## What to build

Enforce the public Effect-only boundary described in "Effect boundary" without rewriting necessary
platform adapters. Read the overview, Phase 4 plan, parent PRD, and this task first.

Audit sandbox definitions, SDK exports, host contracts, backend implementations, bridge dispatch,
and compiler/runtime compatibility shims. Remove public Promise-returning authoring or legacy host
APIs, derive bridge types from canonical schemas where possible, and add focused static/type/runtime
checks. Keep Promise interop private when required by Deno, fetch, filesystem, Redis, or third-party
libraries and wrap it behind Effect.

## Acceptance criteria

- [ ] Sandbox definition run functions and public SDK host methods expose Effect values only
- [ ] Backend host implementations and typed bridge dispatch compose Effect without compatibility overloads
- [ ] No legacy Promise host API or dual authoring path remains exported
- [ ] Private Promise adapters are narrowly scoped and do not leak through plugin-facing types
- [ ] Workflow authoring remains deterministic and does not gain ambient async APIs
- [ ] Representative compiler/type tests reject raw Promise-authored sandbox definitions
- [ ] Existing filesystem, fetch, dependency-client, and runner behavior remains functional
- [ ] SDK, compiler, backend, media, and fitness checks/tests pass

## User stories addressed

- User story 51
- User story 52
