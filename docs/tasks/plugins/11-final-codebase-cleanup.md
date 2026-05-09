# Final Codebase Cleanup

**Parent Plan:** [User-Owned Plugins](./README.md)

**Status:** todo

## What to build

Perform the mandatory final cleanup after Tasks 01 through 10 are complete. Load and follow the `codebase-cleanup` skill. Review all files changed by this plan and directly affected plugin, definition, sandbox, lifecycle, import, integration, backup, migration, contract, schema, and test modules.

Remove verified dead global-plugin assumptions, obsolete backup version 1 code, temporary transition helpers, duplicate scoped lookup logic, stale comments, speculative abstractions, and tests that assert removed behavior. Preserve required Rust V1 migration code and version 2 backup behavior. This task must improve the completed implementation without adding new product functionality or changing the approved design.

## Acceptance criteria

- [ ] The `codebase-cleanup` skill is loaded and its full workflow is applied to the touched files and directly affected modules.
- [ ] No ordinary runtime lookup still relies on a globally unique private plugin, provider, script, definition, import-source, integration-provider, or operation slug.
- [ ] No administrator-token ordinary plugin installation path or backup version 1 compatibility code remains.
- [ ] No temporary adapters, duplicate registries, unused schema fields, stale migration helpers, dead fixtures, or obsolete tests remain unless a concrete persisted or Rust V1 requirement justifies them.
- [ ] Package, installation, definition, execution, and archive identities use consistent names across contracts, services, repositories, logs, errors, and tests.
- [ ] Secret values remain absent from API output, logs, diagnostics, backup fixtures, and test snapshots.
- [ ] Comments and documentation describe current non-obvious invariants and do not restate code or preserve superseded design notes.
- [ ] Focused tests, backend checks, complete backend tests, affected shared-package tests, and relevant end-to-end tests pass after cleanup.
- [ ] Rust V1 dump migration validation remains successful after cleanup when the required fixtures or dumps are available.
- [ ] The parent task tracker and implementor notes accurately reflect completed work and any documented residual validation limitation.

## User stories addressed

- User story 1
- User story 58

## Implementor Notes

This task is intentionally separate and must not be merged into an earlier implementation task. Do not use cleanup as an opportunity to add marketplace, sharing, compatibility, or secret-vault features that are out of scope.
