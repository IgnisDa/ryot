# Private Plugin Install And Invoke

**Parent Plan:** [User-Owned Plugins](./README.md)

**Status:** todo

## What to build

Deliver the first complete user-owned plugin path described in the parent plan's Terminology And Core Invariants, Persistence Model, Plugin Ingestion And Installation, User-Scoped Registries And Definitions, Runtime Authority And Lifecycle, and HTTP Contract sections. An authenticated user must be able to upload a valid private plugin with initial config, list the resulting installation, and invoke one declared user-authenticated operation. A second user must be able to install unrelated code under the same slug without collision or data exposure.

This slice establishes stable plugin IDs, explicit system/user scope, private ownership, plugin installations, owner-scoped uniqueness, persisted source packages, and user-effective runtime lookup. Reuse the existing canonical manifest decoder, source validator, compiler, compiled-manifest verifier, source hasher, script persistence, and sandbox authority checks. Replace administrator authorization for ordinary install and list behavior with normal user authentication. Do not add compatibility behavior for the old global installation contract.

The installation path in this slice may use a fixture with no boot, cron, bootstrap, provider, import, integration, or automation entries. It must still persist the complete canonical manifest so later slices can activate those surfaces without changing package identity. Initial config must be fully schema-valid. API output must not expose source files, compiled code, or secret values.

## Acceptance criteria

- [ ] The database represents stable plugin identity, explicit scope and owner, current source package, and per-user installation with enforced ownership constraints.
- [ ] Two users can install different private packages with the same slug and version without database, compiler-registry, or runtime collisions.
- [ ] One user cannot list, inspect, invoke, update, or otherwise resolve another user's private plugin or installation.
- [ ] Authenticated install validates package limits, manifest, source paths, compilation, compiled metadata, source hash, effective-registry collisions, and complete initial config before activation.
- [ ] Ordinary install and list endpoints use user authentication and no longer require or accept administrator ownership semantics.
- [ ] Listing returns safe installation metadata, scope, lifecycle state, disabled state, order, source hash, version, and secret-safe config information.
- [ ] A declared user-authenticated operation resolves through the caller's exact installation and runs with that user's authority and config.
- [ ] A slug that exists only in another user's registry returns not found rather than leaking its existence.
- [ ] Existing system plugin startup remains functional while the explicit system provisioning behavior is completed in Task 02.
- [ ] Repository, service, registry, contract, operation, and end-to-end tests cover the complete private install/list/invoke path and same-slug isolation.

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
- User story 59
- User story 60

## Implementor Notes

Keep plugin ID, installation ID, and script content identity separate. Route handlers stay thin; ownership checks and transaction boundaries belong to services, and repositories remain the only table writers.
