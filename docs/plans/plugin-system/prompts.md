# Prompts to use

Here are the four prompts, parameterized with {N} — swap the phase number and file names each cycle.

1. PRD (fresh agent, start of phase)

Read docs/plans/plugin-system/00-overview.md fully, then
docs/plans/plugin-system/01-phase-1-\*.md. Then use the write-a-prd skill to
produce a PRD for Phase 1 at docs/tasks/plugin-system-phase-1/README.md.

The design phase is already complete: the two plan files are the authoritative
spec. Do not re-interview me, do not redesign, do not contradict [DECIDED]
items. Skip the skill's interview and exploration steps except to verify facts
you rely on. Write the PRD as a thin framing layer (problem statement,
solution, user stories, testing decisions) that references the plan files for
all technical decisions instead of restating them. Where the skill's template
conflicts with the plan (e.g. its "no file paths" rule), the plan wins.

2. Issues (same agent, immediately after)

Now use the prd-to-issues skill on docs/tasks/plugin-system-phase-1/README.md.

Slicing constraints: prefer honest slices over thin ones — a slice must
compile and pass gates on its own (e.g. Phase 1's FK→slug cutover is one
atomic task; do not fake-split it). Order tasks so registry/infrastructure
lands before its consumers. Every task file must instruct its implementer to
first read docs/plans/plugin-system/00-overview.md and the Phase 1 plan
file, and must derive acceptance criteria from the phase file's done criteria
where they apply.

3. Task implementation (fresh agent per task)

Read, in order: docs/plans/plugin-system/00-overview.md,
docs/plans/plugin-system/01-phase-1-\*.md,
docs/tasks/plugin-system-phase-1/README.md, and
docs/tasks/plugin-system-phase-1/01-\*.md. Then implement that task.

Rules:

- [DECIDED] items are settled. If implementation evidence contradicts one,
  stop and report; never silently deviate.
- If you exercise an [IMPLEMENTER-DECIDES] or deviate from a [RECOMMENDED],
  record the choice and rationale in the relevant file under
  docs/plans/plugin-system/ as part of this task — later phases are
  implemented by fresh agents who read only those plan files.
- E2e tests: re-plumb, never weaken. Assertions are preserved behavior; a
  behavioral change requires my sign-off.
- Gates before claiming done: bun turbo --filter=@ryot/app-backend check;
  cd apps/app-backend && bun run test; cd tests && bun run test (affected
  suites at minimum).
- Update the task file status and the PRD tracking table, then commit this
  task's changes with a message explaining why, not what.

Phase 3 variant

Same four prompts run per step, with two substitutions: in prompts 1–3, scope to "Phase 3 step {S}" and name the step's section of 03-phase-3-capability-migrations.md as the spec; and in prompt 2 for step 3 add: "The replay-determinism spike is its own HITL task ordered before every workflow-engine task; its findings get recorded in the plan file before those tasks start."

Two usage notes: keep prompt 2's quiz interactive — the granularity check is where you catch bad slicing cheaply. And for prompt 4, capture {start-ref} by tagging the commit at each phase start (git tag phase-{N}-start), so the review diff is exact.
