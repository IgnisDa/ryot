# Registry Reconciliation And System Conflicts

**Parent Plan:** [User-Owned Plugins](./README.md)

**Status:** todo

## What to build

Make user-scoped registries reliable across backend processes and server upgrades. Implement the parent plan's cache-generation, system reconciliation, and authoritative-system-conflict decisions. A package or installation change on one process must invalidate only the necessary effective-registry caches elsewhere, with a fallback that repairs missed Redis messages.

Startup reconciliation must ingest current shipped packages, update existing system plugin records and installations, provision newly shipped plugins for existing users through durable fan-out, and keep system functionality available when a private installation conflicts with a new system slug or definition. Conflicting private installations become incompatible with a safe reason; their qualified historical definitions remain attributable but their runtime surfaces are inactive.

## Acceptance criteria

- [ ] Plugin package and installation changes publish centralized, schema-validated Redis invalidations containing global or per-user generation intent.
- [ ] Subscribers invalidate affected effective-registry snapshots atomically and never expose a partially rebuilt registry.
- [ ] Redis publication failure does not roll back a committed database change, and fallback reconciliation repairs stale local caches.
- [ ] The fallback does not require rebuilding every user's registry on every fixed polling interval.
- [ ] Startup updates current system packages and all applicable installation references without allowing private code to block system ingestion.
- [ ] A new system plugin is installed for existing users with restart-safe durable fan-out and deterministic installation identities.
- [ ] Conflicting private installations enter incompatible health with a safe diagnostic and disappear from active runtime resolution.
- [ ] Historical records owned by an incompatible private plugin still resolve through qualified plugin identity.
- [ ] Resolving or removing a conflict permits health reconciliation without recreating plugin or installation identity.
- [ ] Multi-process tests cover package update, user config and disablement changes, missed publication, system release changes, new-system provisioning, and private conflict handling.

## User stories addressed

- User story 36
- User story 37
- User story 38
- User story 58

## Implementor Notes

Centralize Redis keys, channels, codecs, and generation parsing in shared infrastructure. Keep registry snapshots immutable after publication.
