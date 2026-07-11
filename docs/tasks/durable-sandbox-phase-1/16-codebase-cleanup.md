# Codebase Cleanup

**Parent Plan:** [Durable Sandbox - Phase 1](./README.md)

**Status:** done

## What to build

Review every file touched during this plan and remove anything that is no longer needed or was
introduced as scaffolding. Follow the `codebase-cleanup` skill, with special attention to duplicate
code, duplicate or alias-only types, dead code, unnecessary exports, shallow wrappers, stale support
artifacts, obsolete activity/standard-runtime terminology, temporary compatibility, and speculative
abstractions. The cleanup is scoped to touched files and directly affected modules, not unrelated
opportunistic refactors.

## Acceptance criteria

- [x] The task is executed using the `codebase-cleanup` skill.
- [x] The cleanup pass covers all files touched by this plan and any directly affected modules.
- [x] Any removals or simplifications are reflected in the changed code before the plan is considered
      complete.
- [x] No temporary Phase 1 compatibility, tracer-only production branch, stale activity terminology,
      or duplicate execution path remains.
- [x] Relevant package checks/tests and affected E2E remain green after cleanup.

## Completion notes

- Reviewed the 205 files changed from Task 01 through Task 15 and their directly affected modules.
  Removal searches confirmed that remaining activity references belong to the durable workflow request
  protocol, and the surviving sandbox queue is the universal workflow replay worker boundary.
- Deleted the unused integration operations service and live layer after integration execution moved
  directly into `integration-workflow-live.ts`. No production registration or consumer remained.
- Removed the service's stale test mock, options, sample result helper, and workflow-boundary fixture
  entry. No compatibility path or replacement abstraction was added.
- Retained the durable tracer and benchmark suites because they cover Phase 1 replay and performance
  invariants rather than production scaffolding.
- Review and re-review were not run at the owner's request for this cleanup task.

## Verification

- `bun turbo --filter=@ryot/app-backend check`
- `bun turbo --filter=@ryot/app-backend test`
- `bun turbo --force --filter=@ryot/tests test --only -- 'src/tests/kernel/integrations/integrations.test.ts' 'src/tests/kernel/integrations/continuous-error-disable.test.ts' 'src/tests/plugins/media/integrations/integrations.test.ts'`
