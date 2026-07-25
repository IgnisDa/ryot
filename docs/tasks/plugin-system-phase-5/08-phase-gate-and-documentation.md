# Phase Gate and Documentation

**Parent Plan:** [Plugin System - Phase 5: Minimal User-Level Plugins](./README.md)

**Status:** todo

## What to build

Close the Phase 5 behavioral and documentation gate after Tasks 01-07. Complete any missing
cross-feature installation checks exposed by the full suite, run the complete approved backend/e2e
matrix, and make the minimal user-level model the documented source of truth.

The final e2e fixture must use the real authenticated synchronous install contract for uploaded
definitions, operations, and providers. It must exercise two users and colliding logical identities,
then prove ownership, package-scoped data, removal, and reinstall. Gated test support remains only for
trusted manifests that deliberately use capabilities unavailable to uploaded packages.

Remove stale production assumptions that installation is administrator-only, package slugs are
globally unique, plugin state is presentation-only, or uploaded packages can request the full trusted
manifest. Document the deliberately deferred systems so future contributors do not expand this
foundation accidentally.

## Acceptance criteria

- [ ] One real-contract e2e lifecycle installs an uploaded package with definitions, an operation, and a provider, executes package-scoped behavior, removes it, proves hidden preserved data, reinstalls it, and restores access
- [ ] Two-user e2e coverage proves independent package, installation, definition, operation, provider, cache, data, removal, and reinstall behavior for identical source
- [ ] One-user collision e2e coverage proves two structurally different packages can reuse all logical slugs without mixed definitions or execution
- [ ] E2e coverage proves cross-user ownership denial and same-user cross-package query/write denial
- [ ] E2e coverage proves every deferred uploaded manifest section and capability is rejected without partial persistence
- [ ] E2e coverage proves package-count, source-size, file-count, per-file, path, and cardinality limits
- [ ] E2e coverage proves media and fitness auto-installation, tombstone persistence, removal/reinstall, and active-only media monitoring
- [ ] Production administrator list/install/uninstall and slug-based invoke routes have no remaining contract, route, service entrypoint, or client-safe schema
- [ ] Production code contains no user-package dispatch that resolves a package by the first matching local slug or bypasses active installation state
- [ ] Plugin authoring documentation describes physical identity, the synchronous request shape, the exact uploaded manifest subset, simple limits, active/removed lifecycle, and deferred features
- [ ] Sandbox documentation describes installation authority, package-scoped host calls, cache isolation, and rejected uploaded capabilities
- [ ] Backend and e2e ownership documentation reflects the installation-aware resolver and real-install fixture
- [ ] Backend check and all backend tests pass
- [ ] Media and fitness package checks/tests pass
- [ ] The full standard e2e suite passes; standalone operational and live-network gates remain separate and are not added to the standard gate
- [ ] The Phase 5 plan record points to the completed PRD/task set and no longer presents resolved design questions as implementation blockers

## User stories addressed

- User story 27
- User story 28
- User story 31
- User story 32
- User story 33
- User story 34
