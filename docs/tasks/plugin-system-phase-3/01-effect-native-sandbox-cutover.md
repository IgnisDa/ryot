# Step 0a — Effect-Native Sandbox Cutover

**Parent Plan:** [Plugin System — Phase 3: Capability Migrations](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Before starting, read `docs/plans/plugin-system/00-overview.md` in full and then
`docs/plans/plugin-system/03-phase-3-capability-migrations.md` in full — they are the
authoritative spec; this file and the parent PRD only frame the slice.

This is Phase 3's first prerequisite (plan Step 0a). Cut the complete sandbox authoring and typed
host-function stack over to Effect before adding new capabilities:

- Vendor the host-pinned `effect` version as an approved sandbox dependency through
  `libs/sandbox-sdk` and the import map / `PackageCacheManager` mechanism in
  `sandbox-runtime/dependencies.ts`. Effect is runtime-provided and never bundled per script.
- Replace the sandbox SDK's Zod schemas with Effect Schema for manifests, driver input/output,
  and host-function wire contracts; update compiler and runner decoding and remove Zod from the
  approved sandbox dependency surface. Declarative `AppSchema` property metadata is unchanged.
- Make every script-facing host function return an `Effect` with a typed error. Remove the raw
  Promise host API rather than retaining wrappers or aliases.
- Make generic, provider, and automation driver `run` functions return `Effect` values. Update
  the Deno runner to execute drivers through the vendored Effect runtime.
- Make backend host-function implementations, `bridge-adapter.ts` validation/dispatch, and the
  typed bridge handler Effect-native. Promise-based platform operations such as loopback `fetch`
  stay private inside transport adapters and never appear in SDK or backend host contracts.
- Migrate every existing media, fitness, and kernel source-zero script together with compiler
  fixtures, SDK test helpers, and sandbox execution tests. This is an atomic authoring-model
  cutover, not a compatibility period.

No domain capability moves in this task. Step 0b observability and every later migration build
only on the Effect-native contract established here.

## Acceptance criteria

- [ ] `effect` is available inside the sandbox as one host-pinned approved dependency, resolved
      through the import map and never bundled per script
- [ ] Sandbox manifests, driver input/output, and host-function wire contracts use Effect Schema;
      no Zod sandbox SDK or approved runtime dependency remains
- [ ] All script-facing host functions return typed `Effect` values; no raw Promise authoring API,
      wrapper, or alias remains
- [ ] Generic, provider, and automation drivers return `Effect`; the Deno runner executes them
      through the vendored runtime
- [ ] Backend host implementations and typed bridge validation/dispatch are Effect-native;
      Promise use is confined to private platform transport adapters
- [ ] Every existing plugin and kernel script, compiler fixture, SDK test helper, and sandbox test
      is migrated with behavior unchanged
- [ ] Repository searches and type-level tests prove no Promise-based driver or host-function
      contract remains
- [ ] The branch stays shippable: `bun turbo --filter=@ryot/app-backend check`,
      `cd apps/app-backend && bun run test`, the full e2e suite (`cd tests && bun run test`), and
      the `app-client` check all pass

## User stories addressed

- User story 1
- User story 2
- User story 4
- User story 37
- User story 38
- User story 39
