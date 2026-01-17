# Step 5 — media-monitoring + Remaining Media Logic + Phase Gate

**Parent Plan:** [Plugin System — Phase 3: Capability Migrations](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Before starting, read `docs/plans/plugin-system/00-overview.md` in full and then
`docs/plans/plugin-system/03-phase-3-capability-migrations.md` in full. Do not begin until Step 4
is complete — that is tasks 07, 08, 09, and 10, all gated. This slice is composition — it uses only
capabilities the earlier steps already landed — plus the phase gate (plan §5 and "Phase gate").

Step 4 absorbed all of the imports and integrations work, so this task is narrower than earlier
drafts implied: `media-monitoring` plus residual media branches, then the gate.

Migration:

- Rewrite `modules/media-monitoring` as composition: monitoring sweeps = cron +
  `executeQueryEngine` pushdown + signals; refresh flows compose the step-3 workflows;
  notification fan-out uses the existing signal/subscription machinery.
- The `media-monitoring` contract group's user-facing surface (status/enable/disable) becomes
  direct plugin operations (step 2's capability) using `user` or `integration` auth as appropriate;
  do not add an admin operation mode.
- Migrate and delete any leftover media references in `signals`, `events`, and `entity-interest`
  (the interest/translation machinery itself is kernel — only media-specific branches move).
- Move the media resolution provider-to-activity-script map into manifest/registry metadata and
  remove the kernel import of `@ryot/plugin-media/workflows/schemas`.
- Before closing the phase gate, run concurrent full-size media imports through the real workflow
  pool, Redis projection, and sandbox process; record pool/lock pressure and completion results.

Phase gate (this task closes it): after the migration, grep the kernel for media/fitness
vocabulary (an informal preview of Phase 4's enforced check) and triage every hit — each is
either deleted, generalized, or explicitly justified in the Phase 3 plan file. The temporary
step-2 `invokeOperation` scaffolding should be gone by now (its internal callers moved into the
plugin in steps 3–4); flag any residue for the cleanup task.

See the parent PRD "Step 5 — media-monitoring + remaining media logic" and "Cross-cutting" user
stories and the Implementation Decisions "Step 5" / "Phase gate" pointers for the full spec.

## Acceptance criteria

Derived from the plan §5 done criteria, the phase gate, and cross-phase invariants:

- [ ] `modules/media-monitoring` is migrated (sweeps = cron + query-engine pushdown + signals;
      refresh = step-3 workflows; user-facing surface = direct step-2 operations) and deleted;
      scheduler execution uses trusted system authority rather than an executable name
- [ ] Leftover media references in `signals`, `events`, and `entity-interest` are migrated or
      removed; the generic interest/translation machinery stays in the kernel
- [ ] **No module under `apps/app-backend/src/modules/` is media- or fitness-specific**
- [ ] The `media-monitoring/` e2e suites (association detectors + cron-refresh coverage) pass
      with assertions unchanged — the acceptance test that the syscall surface is sufficient
- [ ] The phase-gate grep for media/fitness vocabulary is run and every hit is triaged (deleted,
      generalized, or justified in the plan file); each touched `AGENTS.md`/`README.md` is
      updated where conventions changed (cross-phase invariant 7)
- [ ] The branch stays shippable and the full e2e suite is green: backend `check` + unit tests,
      `cd tests && bun run test`, and the `app-client` check all pass (cross-phase invariant 1)

## User stories addressed

- User story 33
- User story 34
- User story 35
- User story 36
- User story 38
- User story 39
- User story 40
- User story 41
