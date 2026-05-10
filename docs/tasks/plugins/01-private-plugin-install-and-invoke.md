# Private Plugin Install And Invoke

**Parent Plan:** [User-Owned Plugins](./README.md)

**Status:** done

## What to build

Deliver the first complete user-owned plugin path described in the parent plan's Terminology And Core Invariants, Persistence Model, Plugin Ingestion And Installation, User-Scoped Registries And Definitions, Runtime Authority And Lifecycle, and HTTP Contract sections. An authenticated user must be able to upload a valid private plugin with initial config, list the resulting installation, and invoke one declared user-authenticated operation. A second user must be able to install unrelated code under the same slug without collision or data exposure.

This slice establishes stable plugin IDs, explicit system/user scope, private ownership, plugin installations, owner-scoped uniqueness, persisted source packages, and user-effective runtime lookup. Reuse the existing canonical manifest decoder, source validator, compiler, compiled-manifest verifier, source hasher, script persistence, and sandbox authority checks. Replace administrator authorization for ordinary install and list behavior with normal user authentication. Do not add compatibility behavior for the old global installation contract.

The installation path in this slice may use a fixture with no boot, cron, bootstrap, provider, import, integration, or automation entries. It must still persist the complete canonical manifest so later slices can activate those surfaces without changing package identity. Initial config must be fully schema-valid. API output must not expose source files, compiled code, or secret values.

## Acceptance criteria

- [x] The database represents stable plugin identity, explicit scope and owner, current source package, and per-user installation with enforced ownership constraints.
- [x] Two users can install different private packages with the same slug and version without database, compiler-registry, or runtime collisions.
- [x] One user cannot list, inspect, invoke, update, or otherwise resolve another user's private plugin or installation.
- [x] Authenticated install validates package limits, manifest, source paths, compilation, compiled metadata, source hash, effective-registry collisions, and complete initial config before activation.
- [x] Ordinary install and list endpoints use user authentication and no longer require or accept administrator ownership semantics.
- [x] Listing returns safe installation metadata, scope, lifecycle state, disabled state, order, source hash, version, and secret-safe config information.
- [x] A declared user-authenticated operation resolves through the caller's exact installation and runs with that user's authority and config.
- [x] A slug that exists only in another user's registry returns not found rather than leaking its existence.
- [x] Existing system plugin startup remains functional while the explicit system provisioning behavior is completed in Task 02.
- [x] Repository, service, registry, contract, operation, and end-to-end tests cover the complete private install/list/invoke path and same-slug isolation.

## User stories addressed

- User story 1
- User story 2
- User story 3
- User story 4
- User story 5
- User story 6
- User story 7
- User story 8
- User story 13
- User story 14
- User story 26
- User story 57
- User story 58

## Implementor Notes

Keep plugin ID, installation ID, and script content identity separate. Route handlers stay thin; ownership checks and transaction boundaries belong to services, and repositories remain the only table writers.

## Implementation Notes

- The process-wide `PluginLoader` snapshot holds system plugins only. Private plugins resolve from the
  database on demand, so `PluginRepository.list`, `listActiveManifests`, and `listPortablePluginMetadata`
  are system-scoped. Script garbage-collection liveness therefore no longer derives from `list` and
  instead reads content hashes for every active plugin, kernel scripts, and workflow-referenced scripts.
- Private manifests may declare only `metadata`, `configSchema`, `scripts` of kind `operation`, and
  `operations` with `auth: "user"`. Every other surface is rejected with `unsupported-manifest-surface`.
  Tasks 05-07 shorten that list as they activate each surface; `boot` stays rejected permanently.
- Trusted system ingestion moved off `POST /plugins` to admin-gated `testSupport.installSystemPlugin`,
  `listSystemPlugins`, and `uninstallSystemPlugin`. Task 11 should consider gating that module behind
  configuration.
- The plugin-owned foreign-key subtree cascades on delete so a user owning a private plugin, its
  scripts, and live workflow references can still be deleted.
- System-slug reservation was pulled forward from Task 02 because a user holding both a system and a
  private plugin under one slug makes listing and invocation ambiguous.
- The baseline migration was regenerated rather than extended, per the parent plan's allowance.

## Known Follow-Ups

- Slug shadowing is checked in one direction only. Private install rejects an existing system slug, but
  system ingestion does not reject a slug already used by a private plugin. Because operation
  resolution is system-first, a later system plugin would silently shadow an owner's private operation
  and misattribute its installation state. Reassigned from Task 02 to Task 08: closing it by rejecting
  system ingestion would contradict user story 37, which requires a shipped plugin to stay authoritative
  and forbids user code from blocking startup or upgrades. Task 08 already owns the correct resolution --
  the system plugin wins and the conflicting private installation becomes `incompatible` with a safe
  diagnostic reason.
- `PluginRepository.hasIntegrationReferences` still matches `integration.plugin_slug` across all users.
  Unreachable while private plugins cannot declare integration providers; Task 06 must make it
  owner-scoped when it lifts that restriction, otherwise one user's integration could block another's
  uninstall.
- Duplicate-slug detection happens before the install transaction, so two concurrent installs of one
  slug by the same user upsert instead of returning `already-installed`. Data stays consistent; only
  the error contract is lossy.
- Private scripts may declare `httpCall` but cannot declare `httpRateLimits`, and an undeclared origin
  is currently unthrottled. Accepted deliberately.
- Uninstall deactivates the plugin but leaves the installation row, and backup restore requires a clean
  account, so a user who has ever installed a private plugin cannot restore into that account until
  Task 04 lands the real delete. The same already applies to any user who has patched per-user plugin
  state, so this is not new behaviour, but Task 04 should close it.
