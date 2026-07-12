# Plugin-system workflow prompts

These templates are parameterized. Replace `{N}`, `{phase-file}`, `{task-dir}`, `{task-number}`, and
`{task-file}` before use. Completed phase-specific instructions belong in that phase's historical PRD,
not in this reusable file.

## 1. Write the PRD

Read `docs/plans/plugin-system/00-overview.md` and `{phase-file}` completely. Then use the
`write-a-prd` skill to produce `docs/tasks/{task-dir}/README.md` for Phase `{N}`.

The plan files are the authoritative architecture and decision record. Do not contradict `[DECIDED]`
items. Verify current code facts before relying on them. Resolve genuinely open owner decisions before
writing. The finished PRD must identify the phase boundary, implementation decisions, external
behavior, testing decisions, cleanup expectations, and explicit non-goals. If the PRD and plan appear
to conflict, stop and reconcile the plan rather than silently choosing one.

## 2. Convert the PRD to issues

Use the `prd-to-issues` skill on `docs/tasks/{task-dir}/README.md`.

Prefer honest vertical slices over thin infrastructure tasks. Every task must leave the branch
shippable and have exclusive or clearly coordinated ownership. Order shared contracts and generic
capabilities before consumers, correctness/liveness decisions before cleanup that depends on them,
and measurements before and after performance changes. Add the mandatory final `codebase-cleanup`
task over touched files and directly affected modules.

Every task file instructs its implementer to read, in order:

1. `docs/plans/plugin-system/00-overview.md`
2. `{phase-file}`
3. `docs/tasks/{task-dir}/README.md`
4. Its own task file

Acceptance criteria come from the phase plan and PRD. E2e assertions may be re-plumbed or moved but
never weakened without owner approval.

## 3. Implement one task

Read the four documents listed above, ending with `{task-file}`, then implement task `{task-number}`.

Rules:

- `[DECIDED]` items are settled. If implementation evidence contradicts one, stop and report it.
- Confirm `[IMPLEMENTER-DECIDES]` choices and deviations from `[RECOMMENDED]` with the owner, then
  record the result in the owning plan.
- Preserve behavior asserted by e2e tests unless the owner explicitly approves a change.
- Use Turbo for frontend/monorepo commands and run tests from the individual app/package directory.
- Run the task's focused checks plus the phase's required gates before marking it complete.
- Update the task status and PRD tracking table only after verification.
- Commit only when explicitly requested, with a message explaining why the change exists.

## 4. Review the completed phase

Review the complete diff from the captured phase start reference through the final task. Check every
phase acceptance criterion, decision record, task status, test gate, purity/cleanup search, and
documentation owner. Findings come first. Do not treat task completion checkboxes as proof when the
final code or tests disagree.
