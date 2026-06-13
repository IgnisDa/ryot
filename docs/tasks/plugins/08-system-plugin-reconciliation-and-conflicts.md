# System Plugin Reconciliation And Conflicts

**Parent Plan:** [User-Owned Plugins](./README.md)

**Status:** todo

## What to build

Reconcile shipped system plugins and private conflicts across backend processes and server upgrades. Keep the existing process-wide package-catalog invalidation and reconciliation behavior for package ingestion and updates. Resolve user-effective registries from current installation state on demand; do not add per-user registry caches, generations, or invalidation infrastructure.

Startup reconciliation must ingest current shipped packages, update existing system plugin records and installations, provision newly shipped plugins for existing users through durable fan-out, and keep system functionality available when a private installation conflicts with a new system slug or definition. Conflicting private installations become incompatible with a safe reason; their qualified historical definitions remain attributable but their runtime surfaces are inactive.

## Acceptance criteria

- [ ] Existing process-wide package-catalog invalidation and reconciliation continue making package ingestion and updates visible across backend processes.
- [ ] User-effective registry resolution reads current installation state without per-user snapshots, generations, or invalidation messages.
- [ ] Startup updates current system packages and all applicable installation references without allowing private code to block system ingestion.
- [ ] A new system plugin is installed for existing users with restart-safe durable fan-out and deterministic installation identities.
- [ ] Conflicting private installations enter incompatible health with a safe diagnostic and disappear from active runtime resolution.
- [ ] Historical records owned by an incompatible private plugin still resolve through qualified plugin identity.
- [ ] Resolving or removing a conflict permits health reconciliation without recreating plugin or installation identity.
- [ ] Tests cover process-wide package update visibility, system release changes, new-system provisioning, private conflict handling, and current installation-state resolution.

## User stories addressed

- User story 36
- User story 37
- User story 38

## Implementor Notes

Reuse existing process-wide package-catalog coordination.
