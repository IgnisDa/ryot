# Backup Format Replacement

**Parent Plan:** [User-Owned Plugins](./README.md)

**Status:** todo

## What to build

Replace the currently implemented and documented backup archive directly with format version 2 as defined in the parent plan's Backup And Restore section. This project is undeployed, so do not retain a version 1 reader, writer, fixture, compatibility dispatcher, migration path, or documentation. Preserve the existing archive's deterministic streaming, integrity, ZIP-security, asset, size-limit, and clean-account properties while adding portable private plugin packages and installation-aware provenance.

Export includes exact private source packages owned by the user, non-secret installation config, configured-secret redaction pointers, system plugin requirements, and portable plugin keys used by every definition-backed record. Restore validates and compiles private packages before opening the domain write transaction, creates inactive installation identities, remaps all qualified provenance, skips plugin bootstrap, and activates only installations whose restored configuration is complete.

## Acceptance criteria

- [ ] All version 1 archive implementation, fixtures, compatibility tests, and dispatch branches are removed.
- [ ] The only accepted and emitted archive manifest version is 2, with a clear unsupported-version error for all other versions.
- [ ] Version 2 preserves deterministic ordering, hashes, counts, streaming behavior, ZIP validation, asset verification, and resource limits.
- [ ] Export includes each owned private plugin's canonical manifest, complete source file map, version, source hash, and portable archive key.
- [ ] Export records system plugins only as exact slug, version, and source-hash requirements.
- [ ] Installation export contains order, disabled intent, safe lifecycle metadata, non-secret config, and explicit secret redaction paths without secret values.
- [ ] Every plugin-qualified domain record uses portable archive plugin keys rather than database IDs.
- [ ] Restore verifies system requirements and validates, compiles, and collision-checks every private package before domain writes.
- [ ] Restore creates a complete archive-key mapping and rewrites entities, events, relationships, providers, integrations, saved views, signals, and subscriptions consistently.
- [ ] Restore does not dispatch installation user bootstrap and keeps all restored private installations runtime-inactive until domain commit succeeds.
- [ ] Installations with complete config return to archived disablement intent; installations missing redacted required secrets enter needs-configuration health.
- [ ] Failure rolls back domain rows and installation state according to existing restore guarantees and cleans newly staged assets.
- [ ] A new version 2 golden fixture and focused archive, export, restore, cleanliness, workflow, and service tests replace version 1 coverage.
- [ ] Product documentation and backup module guidance describe only version 2 behavior and contain no obsolete version 1 guarantees or terminology.

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
