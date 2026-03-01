# Installation-Scoped Providers

**Parent Plan:** [Plugin System - Phase 5: Minimal User-Level Plugins](./README.md)

**Status:** todo

## What to build

Extend the user-install path with providers, provider scripts, and same-package schema-provider links.
This slice completes the executable uploaded manifest subset from the parent PRD without adding
networking, global catalogs, imports, integrations, or workflows.

Resolve logical providers through package-qualified provider identity and require an active
installation for the executing user before provider search, details, resolve, translate, or generic
entity import. Uploaded provider executions use the same installation-bound authority and safe host
surface established for operations. Any entity populated through an uploaded provider is user- and
installation-owned; global provider writes remain exclusive to trusted first-party packages.

Update provider-backed uniqueness, cache ownership, schema-provider listing, entity provenance, and
direct provider resolution together. Existing first-party providers keep trusted global data behavior
but must use the new physical package/provider identity from Task 01.

## Acceptance criteria

- [ ] Uploaded installation accepts provider declarations, matching provider scripts, and same-package schema-provider links
- [ ] Uploaded provider scripts are limited to the provider and capability subset approved by the parent PRD and cannot request `httpCall` or global-write capabilities
- [ ] Provider IDs and schema-provider links are package-qualified and do not depend on globally unique provider slugs
- [ ] Provider catalogs and schema-provider listings include an uploaded provider only for the user with an active owning installation
- [ ] Search, details, resolve, translate, and generic provider import prove the executing user's active installation before sandbox dispatch
- [ ] Uploaded provider population creates installation-owned user entities and relationships and never creates or mutates global rows
- [ ] Provider-backed uniqueness and provenance include the installation boundary needed to prevent cross-user or cross-package reuse
- [ ] Provider-scoped cache behavior remains shared across that installation's operation scripts but isolated from every other installation
- [ ] Two packages with identical provider, script, operation, and schema-link slugs resolve their own scripts and definitions without collision
- [ ] Existing trusted media and fitness providers retain their global catalog and exact-script behavior
- [ ] Backend check, provider/runtime/entity-import tests, and provider isolation e2e coverage pass

## User stories addressed

- User story 6
- User story 14
- User story 17
- User story 26
- User story 29
- User story 32
