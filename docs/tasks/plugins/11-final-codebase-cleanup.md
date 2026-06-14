# Final Codebase Cleanup

**Parent Plan:** [User-Owned Plugins](./README.md)

**Status:** done

## What to build

Perform the mandatory final cleanup after Tasks 01 through 10 are complete. Load and follow the `codebase-cleanup` skill. Review all files changed by this plan and directly affected plugin, definition, sandbox, lifecycle, import, integration, backup, migration, contract, schema, and test modules.

Remove verified dead global-plugin assumptions, obsolete backup version 1 code, temporary transition helpers, duplicate scoped lookup logic, stale comments, speculative abstractions, and tests that assert removed behavior. Preserve required Rust V1 migration code and version 2 backup behavior. This task must improve the completed implementation without adding new product functionality or changing the approved design.

## Acceptance criteria

- [x] The `codebase-cleanup` skill is loaded and its full workflow is applied to the touched files and directly affected modules.
- [x] No ordinary runtime lookup still relies on a globally unique private plugin, provider, script, definition, import-source, integration-provider, or operation slug.
- [x] No administrator-token ordinary plugin installation path or backup version 1 compatibility code remains.
- [x] No temporary adapters, duplicate registries, unused schema fields, stale migration helpers, dead fixtures, or obsolete tests remain unless a concrete persisted or Rust V1 requirement justifies them.
- [x] Package, installation, definition, execution, and archive identities use consistent names across contracts, services, repositories, logs, errors, and tests.
- [x] Secret values remain absent from API output, logs, diagnostics, backup fixtures, and test snapshots.
- [x] Comments and documentation describe current non-obvious invariants and do not restate code or preserve superseded design notes.
- [x] Focused tests, backend checks, complete backend tests, affected shared-package tests, and relevant end-to-end tests pass after cleanup.
- [x] Rust V1 dump migration validation remains successful after cleanup when the required fixtures or dumps are available.
- [x] The parent task tracker and implementor notes accurately reflect completed work and any documented residual validation limitation.

## User stories addressed

- User story 1
- User story 58

## Implementor Notes

This task is intentionally separate and must not be merged into an earlier implementation task. Do not use cleanup as an opportunity to add marketplace, sharing, compatibility, or secret-vault features that are out of scope.

## Implementation Notes

- Applied the cleanup workflow to all 310 files changed by Tasks 01 through 10 and their directly affected call sites. Independent audits covered plugin runtime and lifecycle, domain modules, persistence and migration, contracts, tests, and documentation.
- Removed the redundant persisted `integration.plugin_slug` and `saved_view.plugin_slug` fields. Public slugs are derived through exact installation and plugin identities. Plugin-scoped custom saved views now persist the owner's installation identity, and the greenfield Drizzle baseline was regenerated.
- Completed qualified persistence identity by including nullable plugin ownership in entity, relationship, and notification-subscription uniqueness and repository conflict paths. Saved views now enforce installation ownership with a composite database foreign key.
- Removed dead global operation resolvers, the unused `script-unavailable` error variant, obsolete tests and fixtures, duplicate schema fields, stale exports, slug-only adapters, and resolved `TODO(plugins)` comments. Integration-provider resolution now reuses one user-scoped catalog without adding caching.
- Test-support system ingestion, inspection, uninstall, and reconciliation endpoints remain because they exercise trusted system-only behavior that normal user plugin endpoints cannot replace. They remain administrator-gated and are not ordinary plugin management paths.
- Backup export now derives archive ownership from persisted plugin IDs. Unavailable historical private definitions fall back only to the exact persisted private package manifest; wrong-owner same-slug definitions are rejected, system definitions receive no unsafe fallback, and secret redaction plus embedded dependency discovery remain intact.
- Custom installation-scoped saved views now produce the typed `saved-view-referenced` uninstall conflict. Generated plugin views retain transactional removal behavior.
- Private `httpRateLimits` remain rejected. Implementing installation-aware Redis admission would add product behavior to this cleanup task, so the stale Task 11 TODO was removed without adding that feature.
- Review found and fixed two blockers: historical backup provenance could use a current same-slug definition, and custom saved views could reach a raw installation foreign-key failure during uninstall. Re-review found no remaining code defects or out-of-scope expansion.
- Focused backend and contract tests, complete backend tests, backend and contract checks, and relevant e2e suites passed. Sixteen selected e2e files passed; one existing operational-gate test remained skipped behind its opt-in gate. Rust V1 dump migration was not rerun because no dump fixture was supplied during this task; Task 10's normal and larger dump validations remain the latest runbook results.
