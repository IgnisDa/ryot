# Step 4a — Kernel Capability: Manifest Sections, FS Grants, Approved Deps

**Parent Plan:** [Plugin System — Phase 3: Capability Migrations](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Before starting, read `docs/plans/plugin-system/00-overview.md` in full and then
`docs/plans/plugin-system/03-phase-3-capability-migrations.md` in full — §4 is the authoritative
spec for this task and every design question in it is settled. Do not begin until Step 3b
(task 06) is done.

This is the kernel capability slice of Step 4. It lands **before any consumer**: no adapter moves
in this task. Tasks 08–10 consume what this builds.

1. **`integrationProviders` manifest section**, lot-discriminated exactly as §4 specifies —
   `yank`/`sink` entries carry `scriptSlug`, `push` entries do not (push targets are already
   automation scripts dispatched through `bindings.eventAutomations`; registry entries exist only
   so the kernel can list the provider and validate its settings). Merge it into the registry
   snapshot alongside `providers`/`operations`/`crons`, and make the integrations framework list
   available providers from the registry.
2. **`settingsSchema` as a declarative `AppSchema`**, validated by the existing property-schema
   runtime (`apps/app-backend/src/lib/property-schema/`).
3. **`secret?: true` on `AppPropertyBase`** (`libs/contract/src/schema/property-schema.ts`), beside
   `translatable?: true` — validation-neutral, inherited by every property kind. The kernel
   **redacts marked fields when returning an integration**. This is an owner-signed-off behavioral
   change (§4); it must compose with the existing merge-preserve on update, which stays intact.
4. **`importSources` manifest section** and the **collapse of the two import orchestration paths
   into one**: the kernel resolves the run's `source` slug through the registry and dispatches the
   owning plugin's workflow with `{ runId, userId, artifactPath?, sourcePayloadRef? }`. The
   hardcoded source table in `imports/runtime/source-definitions.ts` is superseded by manifest data.
5. **Deny-by-default per-execution filesystem grants** next to the existing flag assembly in
   `sandbox-runtime/runtime.ts` (`makeSpawnDenoProcess`): artifact path appended to `--allow-read`,
   `--allow-write` on a per-execution scratch directory, requested through
   `capabilities: ["artifact-read", "scratch"]`. Grant-carrying executions run on a **dedicated,
   non-pooled process** (`[RECOMMENDED]` — measure before optimizing). Scratch quota is **5 MiB
   enforced post-execution** (Deno has no preventive quota); cleanup is unconditional and
   kernel-owned.
6. **Scratch-dir chunk harvest**: the kernel reads chunk files a script leaves in its scratch
   directory into run-scoped kernel-owned storage at execution end, before cleanup. The reader is
   always the kernel, never a second sandbox execution.
7. **Approved sandbox dependencies** `fflate`, `papaparse`, `fast-xml-parser` through the Step 0a
   vendoring mechanism.
8. **Credential scoping**: `getIntegration` resolves the integration from trusted execution state,
   not from an arbitrary id supplied by the script.

Do **not** build `putRunBlobs`, `getRunBlobs`, `recordImportFailures`, or `reportImportProgress` —
§4 records all four as withdrawn. The kernel keeps ownership of entity/event/relationship writes,
so it keeps ownership of counters and failure rows.

Because no adapter consumes these yet, this task's own coverage is kernel-side: focused tests for
grant assembly, quota enforcement, scratch harvest, chunk manifest handling, registry listing of
both new manifest sections, `secret` redaction, and credential scoping.

## Acceptance criteria

- [ ] `integrationProviders` (lot-discriminated) and `importSources` manifest sections exist,
      validate, and are served from the registry snapshot; the integrations framework lists
      providers generically
- [ ] `settingsSchema` is a declarative `AppSchema` validated by the property-schema runtime
- [ ] `secret?: true` exists on `AppPropertyBase`; marked fields are redacted when an integration is
      read; the merge-preserve-on-update behavior is unchanged and still asserted
- [ ] The media-vs-non-media import branch is gone: one registry-driven dispatch path resolves the
      run's source slug to its owning plugin's workflow
- [ ] Deny-by-default grants work: artifact `--allow-read`, scratch `--allow-write`, requested via
      `capabilities: ["artifact-read", "scratch"]`, on a dedicated non-pooled process, with a 5 MiB
      post-execution quota and unconditional kernel cleanup
- [ ] The kernel harvests scratch chunk files into run-scoped storage before cleanup
- [ ] `fflate`, `papaparse`, and `fast-xml-parser` are approved sandbox dependencies, resolved
      through the import map and not bundled per script
- [ ] `getIntegration` is scoped to the executing integration
- [ ] None of the four withdrawn host functions is introduced
- [ ] The branch stays shippable: backend `check` + unit tests, the full e2e suite, and the
      `app-client` check all pass (cross-phase invariant 1)

## User stories addressed

- User story 26
- User story 27
- User story 28
- User story 29
- User story 37
- User story 38
- User story 42
- User story 43
- User story 44
- User story 45
