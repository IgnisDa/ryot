# Step 0 — Sandbox Authoring Upgrades

**Parent Plan:** [Plugin System — Phase 3: Capability Migrations](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Before starting, read `docs/plans/plugin-system/00-overview.md` in full and then
`docs/plans/plugin-system/03-phase-3-capability-migrations.md` in full — they are the
authoritative spec; this file and the parent PRD only frame the slice.

This is the prerequisite infrastructure slice (plan §0). No domain code moves here; it upgrades
the sandbox authoring surface so the later steps' scripts are writable and debuggable. It lands
before any consumer:

- Vendor `effect` as an approved sandbox dependency at a single host-pinned version matching the
  host, wired through the import map / `PackageCacheManager` in `sandbox-runtime/dependencies.ts`
  — never bundled per script (Decision 11; overview target architecture).
- Extend `libs/sandbox-sdk` to expose host functions as typed `Effect` values with typed errors
  (thin wrappers), while keeping the raw promise API intact so every existing script keeps
  working unchanged.
- Add `log` and `span` host functions following the existing host-function contract pattern
  (`libs/sandbox-sdk` contract + `bridge-adapter.ts` validation + `host-functions.ts`
  implementation + limits entry), threading structured output into the execution's OTLP trace
  and `subscription_run`-style bookkeeping.

The mechanism established here (approved-dep vendoring, host-function-as-Effect wrappers) is
reused by later steps — `fflate` is added the same way in step 4. See the parent PRD "Step 0 —
sandbox authoring upgrades" user stories and the Implementation Decisions "Step 0" pointer.

## Acceptance criteria

- [ ] `effect` is available inside the sandbox as a single host-pinned approved dependency,
      resolved through the import map, not bundled per script (Decision 11)
- [ ] The SDK exposes host functions as typed `Effect` values with typed errors; the existing
      raw promise API still works and all existing sandbox scripts run unchanged
- [ ] `log` and `span` host functions exist, follow the full contract pattern (contract +
      `bridge-adapter.ts` validation + `host-functions.ts` + limits entry), and thread into the
      execution trace/bookkeeping
- [ ] The branch stays shippable (cross-phase invariant 1):
      `bun turbo --filter=@ryot/app-backend check`, `cd apps/app-backend && bun run test`, the
      full e2e suite (`cd tests && bun run test`), and the `app-client` check all pass

## User stories addressed

- User story 1
- User story 2
- User story 3
- User story 4
- User story 37
