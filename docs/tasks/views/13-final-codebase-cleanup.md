# Final Codebase Cleanup

**Parent Plan:** [Composable Views Tracer](./tracer.md)

**System Design:** [Composable Views](./README.md)

**Status:** todo

**Depends On:** [12 - Replace Remaining Old Paths](./12-replace-remaining-old-paths.md)

## What To Build

Perform the mandatory final cleanup and acceptance pass for the completed tracer. This is a separate task and must not be merged with Task 12 or skipped because earlier tasks included local cleanup.

Load and explicitly follow the `codebase-cleanup` skill. Scope the pass to code changed for this plan and directly affected callers, manifests, generated outputs, tests, and documentation. Preserve unrelated work. Keep cleanup behaviour-preserving; functional cutover belongs to Task 12.

Use [Completion Checklist](./tracer.md#completion-checklist), [Testing And Validation](./tracer.md#testing-and-validation), and [Final Review Questions](./tracer.md#final-review-questions) as the acceptance record. All task files and both parent documents must describe the finished implementation accurately.

Verify suspected dead code against runtime registration, public exports, compiler allowlists, scripts, schema generation, backups, migrations, and external plugin-author contracts before deleting it. Remove only verified leftovers: redundant mirrors, duplicated helpers, obsolete comments, temporary logging, test-only shortcuts, completed transition paths, and unused configuration introduced or affected by this plan.

Do not use this pass to redesign the agreed architecture, add deferred features, or perform unrelated repository cleanup. If a suspected removal cannot be justified, retain it and record the evidence that is missing.

## Acceptance Criteria

- [ ] The `codebase-cleanup` skill has been followed explicitly and this task remains a separate completion step.
- [ ] Touched files and directly affected consumers have been checked for verified dead, duplicated, temporary, or speculative leftovers.
- [ ] Public exports, manifests, runtime entry points, backup/import obligations, and generated outputs have been checked before removals.
- [ ] No old-format adapter, parallel runtime, implicit-plugin compatibility default, stale-artifact fallback, or temporary bypass remains.
- [ ] No authenticated kernel screen acquires data through a route loader or a direct runtime call, verified by search across `kernel/client/src`, with every survivor matching a documented permanent exception rather than an undocumented remainder.
- [ ] Managed-asset batching and expiry resolve to one implementation with no kernel-side or plugin-side duplicate.
- [ ] No plugin `client/**` source imports the plugin kit, and the SDK Effect re-export, compiler shim, and pinned deep-import resolver still name one shared namespace set.
- [ ] Useful domain boundaries, schema-derived types, test seams, and distinct behaviour assertions remain intact.
- [ ] Formatter/linter changes are inspected and do not overwrite unrelated work.
- [ ] Relevant package tests/checks and affected standard E2E files pass using repository-prescribed commands and capacities.
- [ ] The full deterministic seed/demo journey still works through actual user renderer publication and public system/private exports.
- [ ] Mobile/native verification limits and any remaining failures are recorded accurately rather than marked passed by intent.
- [ ] The parent completion checklist and task index reflect actual implementation status.
- [ ] A concise completion record lists concrete cleanup, validation results, and justified retained candidates.

## Verification

Run the parent plan's final affected-package checks and standard E2E files separately. Do not enable live-provider smoke or large operational gates without a separate reason. Do not increase pools, concurrency, timeouts, or retries to force acceptance. Inspect the final diff and check whitespace after generated and formatting changes.

## User Stories Addressed

- [User story 20](./tracer.md#user-stories): one clean, documented implementation.
- User story 17: reproducible final acceptance without live provider dependencies.
- User story 19: accurate maintained documentation and no old-format leftovers.

## Implementor Notes

Record actual cleanup and commands/results here. If no further cleanup is justified after Task 12, state that explicitly and still complete the prescribed verification.
