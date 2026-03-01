# Namespaced Package Identity Cutover

**Parent Plan:** [Plugin System - Phase 5: Minimal User-Level Plugins](./README.md)

**Status:** todo

## What to build

Introduce the stable package and physical-identity foundation described by the parent PRD's
"Package Identity" and "Physical Identity and References" sections while preserving all current
trusted first-party behavior.

Give persisted packages opaque package IDs, with code-owned reserved IDs for media and fitness.
Create one identity-normalization boundary that translates package-local manifest slugs and embedded
query references into package-qualified physical identities before registry loading or persistence.
Apply it to entity, nested event, relationship, signal, saved-view, script, provider, operation,
bootstrap, binding, import-source, integration-provider, workflow, boot, and cron references used by
the existing trusted manifests. Keep exact script content hashes and workflow pins unchanged.

This slice must update persisted definition references and runtime resolution together so the backend
never temporarily depends on both bare and physical plugin identities. Kernel source-zero identity
remains explicit and separate. Trusted first-party and gated test packages may retain validated
cross-package references; ordinary uploaded-package policy is introduced by later tasks.

## Acceptance criteria

- [ ] Persisted packages have stable opaque package IDs, and media and fitness use reserved code-owned package IDs across reingestion
- [ ] All package-owned definitions, executables, providers, bindings, catalog entries, and embedded query references have deterministic physical identities derived through one normalization boundary
- [ ] Runtime resolution uses package ID plus local entry identity and never scans packages for the first matching slug
- [ ] Domain rows and workflow or execution attribution no longer rely on a globally unique package manifest slug
- [ ] Existing first-party cross-package references are explicitly validated and cannot be enabled by untrusted manifest data
- [ ] Two gated test packages can load structurally different definitions and executable entries with identical logical slugs without collision or mixed resolution
- [ ] Media, fitness, kernel, plugin-ingestion, provider, automation, query, and workflow-pinning tests retain their current behavioral assertions
- [ ] The initial database migration is regenerated for the identity cutover with no compatibility columns or aliases
- [ ] Backend check and focused backend/e2e identity tests pass

## User stories addressed

- User story 13
- User story 14
- User story 30
