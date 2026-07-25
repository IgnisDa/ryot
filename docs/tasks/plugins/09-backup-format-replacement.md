# Backup Format Replacement

**Parent Plan:** [User-Owned Plugins](./README.md)

**Status:** done

## What to build

Replace the currently implemented and documented backup archive directly with format version 2 as defined in the parent plan's Backup And Restore section. This project is undeployed, so do not retain a version 1 reader, writer, fixture, compatibility dispatcher, migration path, or documentation. Preserve the existing archive's deterministic streaming, integrity, ZIP-security, asset, size-limit, and clean-account properties while adding portable private plugin packages and installation-aware provenance.

Export includes exact private source packages owned by the user, non-secret installation config, configured-secret redaction pointers, system plugin requirements, and portable plugin keys used by every definition-backed record. Restore validates and compiles private packages before opening the domain write transaction, creates inactive installation identities, remaps all qualified provenance, skips plugin bootstrap, and activates only installations whose restored configuration is complete.

## Acceptance criteria

- [x] All version 1 archive implementation, fixtures, compatibility tests, and dispatch branches are removed.
- [x] The only accepted and emitted archive manifest version is 2, with a clear unsupported-version error for all other versions.
- [x] Version 2 preserves deterministic ordering, hashes, counts, streaming behavior, ZIP validation, asset verification, and resource limits.
- [x] Export includes each owned private plugin's canonical manifest, complete source file map, version, source hash, and portable archive key.
- [x] Export records system plugins only as exact slug, version, and source-hash requirements.
- [x] Installation export contains order, disabled intent, safe lifecycle metadata, non-secret config, and explicit secret redaction paths without secret values.
- [x] Every plugin-qualified domain record uses portable archive plugin keys rather than database IDs.
- [x] Restore verifies system requirements and validates, compiles, and collision-checks every private package before domain writes.
- [x] Restore creates a complete archive-key mapping and rewrites entities, events, relationships, providers, integrations, saved views, signals, and subscriptions consistently.
- [x] Restore does not dispatch installation user bootstrap and keeps all restored private installations runtime-inactive until domain commit succeeds.
- [x] Installations with complete config return to archived disablement intent; installations missing redacted required secrets enter needs-configuration health.
- [x] Failure rolls back domain rows and installation state according to existing restore guarantees and cleans newly staged assets.
- [x] A new version 2 golden fixture and focused archive, export, restore, cleanliness, workflow, and service tests replace version 1 coverage.
- [x] Product documentation and backup module guidance describe only version 2 behavior and contain no obsolete version 1 guarantees or terminology.

## User stories addressed

- User story 42
- User story 43
- User story 44
- User story 45
- User story 46
- User story 47
- User story 48
- User story 49
- User story 50

## Implementor Notes

Only manifest-declared config secrets can be redacted reliably. Preserve the parent PRD warning that user-authored source files may contain embedded credentials.

## Implementation Notes

- `archive-v2` is the only archive codec. It retains deterministic non-Zip64 streaming, strict section
  codecs, hashes, counts, ZIP-path and compression checks, asset verification, and bounded resource
  limits. Version 1 code, fixtures, branches, and documentation were removed rather than retained as a
  compatibility path.
- Export resolves one installation-aware effective definition snapshot inside the repeatable-read snapshot.
  Private packages include canonical manifests and complete source maps; system packages are represented
  only by exact slug, version, and source-hash requirements. System installation config is never exported.
- Schema-marked configuration secrets are recursively redacted with JSON pointers. Restore follows nested
  object and array pointers when deciding whether an installation needs configuration and whether an
  integration must remain disabled.
- Every qualified archive record uses a portable plugin key. Restore compiles and collision-checks private
  packages, verifies exact system requirements, builds the complete key map, and streams a provenance
  preflight before opening the domain transaction. Both missing and incorrect ownership keys are rejected.
- Private plugins and installations are persisted through a restore-only path that does not dispatch
  user-bootstrap. Installations remain inactive during domain writes, then become `ready` with archived
  disablement or `needs-configuration` after commit. Destination-owned system config is preserved.
- Focused backend coverage includes archive integrity and limits, package preflight ordering, secret
  redaction, provenance remapping, lifecycle state, rollback, and account cleanliness. The three affected
  backup end-to-end files pass, and the tests-package check completes without warnings.
