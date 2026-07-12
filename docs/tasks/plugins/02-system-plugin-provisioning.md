# System Plugin Provisioning

**Parent Plan:** [User-Owned Plugins](./README.md)

**Status:** todo

## What to build

Deliver the trusted shipped-plugin path on top of explicit installations. Apply the parent plan's Plugin Ingestion And Installation, Configuration, Runtime Authority And Lifecycle, and HTTP Contract decisions to the media and fitness packages. New users must receive system installations automatically, shipped packages must continue to use environment config, and trusted boot, system cron, and first-install user-bootstrap behavior must preserve their intended authority.

Trusted status must come from the internal shipped-source ingestion path and persisted system scope, not from a user-supplied slug. System plugin slugs are reserved against private installation. System installations are visible in the authenticated installation list, may be user-disabled for user-scoped surfaces, and cannot be updated or uninstalled through private-plugin endpoints.

Use the same installation provisioning behavior for ordinary new-user bootstrap and newly introduced system packages. Lifecycle execution must remain outside database transactions and use deterministic durable identities where dispatch can outlive a request.

## Acceptance criteria

- [ ] Media and fitness ingest as system-scoped plugins through the trusted startup path and cannot be impersonated by private uploads.
- [ ] Every newly created user receives one installation for every current system plugin before plugin-defined user initialization needs the registry.
- [ ] System scripts continue to resolve plugin config from normalized server environment variables and never from installation config.
- [ ] Existing trusted instance boot and system cron entries execute once per instance with system authority.
- [ ] System user-bootstrap entries execute once for a newly provisioned user installation with that user's authority.
- [ ] User-facing list output distinguishes system installations from private installations without exposing environment config.
- [ ] Users may disable system installations for user-scoped runtime surfaces but cannot update their source, configure environment values, or uninstall them.
- [ ] Private install rejects current system plugin slugs before compilation or persistence.
- [ ] Provisioning and lifecycle operations are restart-safe and do not duplicate installation rows or bootstrap effects.
- [ ] Focused startup, user-bootstrap, scheduler, configuration, service, and endpoint tests preserve system behavior under the new model.

## User stories addressed

- User story 23
- User story 24
- User story 25
- User story 34
- User story 35
- User story 36

## Implementor Notes

System package ingestion remains an internal startup concern. Do not retain the administrator upload endpoint as an alternate way to create system plugins.
