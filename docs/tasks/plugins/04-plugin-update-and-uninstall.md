# Plugin Update And Uninstall

**Parent Plan:** [User-Owned Plugins](./README.md)

**Status:** done

## What to build

Deliver safe private source updates and uninstall behavior using the stable plugin and installation identities from earlier tasks. Follow the parent plan's Persistence Model and Plugin Ingestion And Installation decisions. A package update replaces the current source, manifest, version, source hash, providers, and current script hashes only after complete compilation, effective-registry validation, additive schema-evolution checks, existing-owner-data checks, and merged config validation succeed.

Updates retain the plugin and installation IDs and do not rerun installation bootstrap. Historical scripts remain content-addressed and executable only through exact durable pins. Uninstall is private-owner-only and must fence all exact installation dependencies before deactivation. Physical cleanup remains separate and cannot remove artifacts required by current state or nonterminal workflows.

## Acceptance criteria

- [x] An authenticated owner can replace a private package with a valid new source package while retaining stable plugin and installation IDs.
- [x] Update rejects scope changes, ownership changes, system plugins, cross-user targets, invalid compilation, registry collisions, incompatible schemas, and invalid merged config.
- [x] Omitted config preserves current values and secrets during source update, while provided replacements and explicit removals follow normal patch semantics.
- [x] Package update does not rerun user-bootstrap entries, including entries newly added by the release.
- [x] Durable workflow references pin installation ID, plugin ID, script ID, and content hash and continue resolving the historical script after update.
- [x] New execution resolves only the current content hash and cannot select historical code accidentally.
- [x] Uninstall rejects system installations and private installations owned by another user.
- [x] Uninstall reports conflicts for exact entities, integrations, dependent definitions, and running or suspended workflows that require the installation.
- [x] Successful uninstall removes the private installation from active and definition registries without deleting still-pinned historical artifacts.
- [x] Garbage collection removes only scripts, providers, and inactive private plugins with no current installation, domain provenance, or workflow liveness source.
- [x] Service, repository, schema-evolution, workflow-reference, resolver, uninstall, and garbage-collector tests cover update and removal end to end.

## User stories addressed

- User story 18
- User story 19
- User story 20
- User story 21
- User story 22
- User story 41

## Implementor Notes

Compilation and sandbox work must not occur inside the persistence transaction. Preserve the existing advisory-lock and process-lock guarantees while changing their authority from global slug to stable plugin and installation identity.

## Implementation Notes

- `PUT /plugins/:pluginSlug` compiles and validates the complete private package before entering the
  update transaction. The transaction locks and rechecks the stable plugin and installation, atomically
  replaces current package state, and applies the same preserve, replace, and explicit-unset config merge
  used by installation patches. It never dispatches installation bootstrap.
- User-authority workflow references now pin installation ID, plugin ID, script ID, and content hash.
  Registration rejects private scripts without an exact owner installation, while historical content hashes
  remain resolvable after a package update and new dispatch continues to select only current hashes.
- Private uninstall checks exact owner-scoped integration, provider-entity, and nonterminal workflow
  references before deleting the installation and deactivating the plugin. System and foreign-user targets
  retain conflict and not-found behavior without leaking ownership.
- Garbage collection now removes inactive private plugin subtrees only after installation, entity, and
  workflow liveness checks pass. Current and pinned historical scripts remain protected independently.
- Integration fences use the current `(user_id, plugin_slug)` identity because installation-backed
  integration persistence belongs to Task 06. Private definition provenance remains unavailable until Task
  05 enables those manifest surfaces, so its existing-data checks remain intentionally limited to currently
  supported private package surfaces.
