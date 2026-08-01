# Scoped Imports And Integrations

**Parent Plan:** [User-Owned Plugins](./README.md)

**Status:** todo

## What to build

Deliver private plugin imports and integrations through the authenticated user's effective registry. Apply the parent plan's Persistence Model, User-Scoped Registries And Definitions, and Runtime Authority And Lifecycle decisions to import-source catalogs, integration-provider catalogs, import dispatch, integration workflows, and integration-authenticated operations.

Import creation must resolve an enabled source from the requesting user's exact installation, pin its workflow script and installation identity, and execute with that user's authority. Integration records must reference installation IDs and match the installation owner. An integration-authenticated operation must prove that the integration belongs to the same installation that declares the invoked operation, not merely that an enabled integration ID exists.

Build on the current server-driven import inputs and integration schemas, structured failure reasons, durable workflows, and exact script-ID execution. Change existing contracts and app-client consumers where required instead of introducing parallel catalog or form behavior.

## Acceptance criteria

- [ ] Import-source and integration-provider catalogs are derived from the requesting user's ready, enabled effective registry.
- [ ] Identical import-source or integration-provider slugs in unrelated user plugins do not collide or leak across users.
- [ ] Import creation records plugin installation identity and pins the exact current workflow script before durable dispatch.
- [ ] Import execution retains user authority and cannot resolve a source, workflow, config, or artifact grant from another installation.
- [ ] Integration creation validates the provider and settings against the exact installation manifest and stores installation ownership.
- [ ] Integration workflows resolve scripts and config from their stored installation and owner.
- [ ] Integration-authenticated plugin operations reject an integration from another plugin installation, including another installation owned by the same user.
- [ ] Disabled, incompatible, failed, or uninstalled installations cannot start new imports, integrations, or operations.
- [ ] Existing uninstall fences use installation references and continue protecting integration and import workflow dependencies.
- [ ] Catalog, import service, durable import, integration service, integration workflow, operation, repository, existing app-client consumers, and end-to-end tests cover isolation and exact ownership.

## User stories addressed

- User story 27
- User story 28
- User story 39

## Implementor Notes

Durable payloads must carry stable IDs and exact script pins. They must not re-resolve a mutable local slug when execution resumes.
