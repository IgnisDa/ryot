# Removal and Reinstall

**Parent Plan:** [Plugin System - Phase 5: Minimal User-Level Plugins](./README.md)

**Status:** todo

## What to build

Complete the uploaded installation lifecycle using only the `active` and `removed` states defined by
the parent PRD. Add synchronous, idempotent removal and reinstall while preserving package rows,
scripts, domain data, saved-view state, caches, and execution history.

Removal and new entrypoint dispatch must share the existing package lifecycle fence. Removal changes
the owned installation to removed only when no nonterminal workflow, import, provider population, or
other exact execution reference remains. It does not add cancellation or draining; conflicts remain
retryable after work finishes. Reinstall reactivates the same installation and immutable uploaded
package without compilation or bootstrap.

Apply removed-state filtering consistently to catalogs, direct reads, queries, operations, providers,
data visibility, and queued entrypoint resolution. Keep retained packages in the global namespaced
snapshot; authorization comes from installation state rather than package unloading.

## Acceptance criteria

- [ ] `DELETE /plugin-installations/:installationId` removes only an active installation owned by the authenticated user and is idempotent for an already removed installation
- [ ] Removal takes the same lifecycle fence as new operation, provider, import, and workflow dispatch
- [ ] Removal returns conflict without changing installation state while a nonterminal exact execution reference exists
- [ ] Removal succeeds after references clear and preserves package rows, scripts, entities, events, relationships, saved-view state, caches, and run history
- [ ] Removed definitions, saved views, providers, operations, and domain rows are absent from ordinary catalogs, direct reads, and query execution for that user
- [ ] Physical IDs and retained database rows do not bypass removed-state authorization
- [ ] A removed installation cannot start or resume uploaded operation, provider, population, or import work
- [ ] `POST /plugin-installations/:installationId/reinstall` reactivates the same owned installation and immutable package synchronously without compilation
- [ ] Reinstall restores preserved definitions, saved views, providers, operations, data, and cache visibility without duplicating rows
- [ ] Another user cannot remove or reinstall the installation and receives no ownership information from the failure
- [ ] Removed packages remain safely loaded in the namespaced global snapshot; no package-unload or package-GC behavior is introduced
- [ ] Backend check, lifecycle/race/direct-read tests, and removal/reinstall e2e coverage pass

## User stories addressed

- User story 8
- User story 9
- User story 10
- User story 11
- User story 12
- User story 23
- User story 33
