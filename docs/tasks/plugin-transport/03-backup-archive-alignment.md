# Backup Archive Alignment

**Parent Plan:** [Plugin Package Transport](./README.md)

**Status:** pending

## What to build

Make backup store a private plugin package as the same artifact a user could install, following the parent plan's Backup Alignment decisions. This removes the last independent encoding of a plugin package.

Change backup export to write each owned private plugin package as a plugin archive entry instead of an inline source file map, while recording the same identity information it records today. Change restore to read those entries through the archive reader from Task 01, before opening the domain write transaction, exactly where it validates and compiles private packages today.

Preserve everything else about the archive: deterministic ordering, section hashes, counts, streaming behavior, existing ZIP validation, asset verification, resource limits, and secret redaction. System plugins remain recorded as exact slug, version, and source-hash requirements and are never copied into a user backup.

Update backup fixtures and documentation to the new representation. There is no compatibility path for the previous representation.

## Acceptance criteria

- [ ] Export writes each owned private plugin package as a plugin archive entry and retains its existing identity information.
- [ ] Restore reads private plugin packages through the same archive reader used by install, before the domain write transaction opens.
- [ ] System plugins remain exact requirements and are never copied into a user backup.
- [ ] Deterministic ordering, section hashes, counts, streaming behavior, ZIP validation, asset verification, and resource limits are unchanged.
- [ ] Secret redaction behavior is unchanged, and no secret value appears in archives, fixtures, logs, or test output.
- [ ] Export and restore round-trip a private plugin with its plugin identity, installation, provenance, and source hash intact.
- [ ] Backup fixtures and documentation reflect the new representation, and no compatibility path for the previous representation remains.
- [ ] Repository check and test tasks pass.
