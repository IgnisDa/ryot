# Trusted Plugin User Bootstrap

**Parent Plan:** [Plugin System - Phase 4](./README.md)

**Status:** done

## What to build

Add the narrow trusted-package `userBootstrap` vertical slice defined under "Trusted plugin user
bootstrap" in the parent PRD. Read the overview, Phase 4 plan, parent PRD, and this task first.

Extend the manifest, ingestion validation, direct script catalog, bootstrap dispatcher, sandbox SDK,
typed bridge, backend host implementation, media package, and new-user flow together. A media-owned
bootstrap script must idempotently ensure the user's library through a batch-first user-entity host
capability. The kernel binds user and package ownership and rejects writes to foreign schemas.

This capability is restricted to the globally boot-configured trusted packages in Phase 4. Do not
add per-user plugin installation, source upload, capability consent, backfill, or package versioning;
those belong to Phase 5.

## Acceptance criteria

- [x] `userBootstrap` is a distinct manifest section with stable entry slug, description, and direct compatible script target
- [x] Ingestion rejects missing, foreign, duplicate, or incompatible bootstrap script references
- [x] Only trusted boot-configured packages may declare or dispatch the section in Phase 4
- [x] Bootstrap scripts execute with kernel-bound user authority and deterministic idempotent execution identity
- [x] The new batch host capability can ensure user entities only for schemas owned by the executing package
- [x] Host input and output use Effect Schema and the public SDK/bridge/backend path is Effect-only
- [x] The media package declares a bootstrap script that ensures exactly one library with existing name and initial properties
- [x] A failed plugin bootstrap prevents overall user bootstrap completion and retries safely
- [x] Backend, SDK, plugin, and e2e tests cover validation, authority, foreign-schema rejection, first creation, and idempotent retry
- [x] Kernel user bootstrap no longer contains the `library` schema slug or media naming

## User stories addressed

- User story 5
- User story 6
- User story 10
- User story 11
- User story 12
