# Plugin Package Transport

## Tasks

**Overall Progress:** 0 of 3 tasks completed

**Current Task:** [Task 01](./01-plugin-archive-format.md) (pending)

### Task List

| #   | Task                                                                  | Status  |
| --- | --------------------------------------------------------------------- | ------- |
| 01  | [Plugin Archive Format](./01-plugin-archive-format.md)                 | pending |
| 02  | [Upload-Based Install And Update](./02-upload-based-install-and-update.md) | pending |
| 03  | [Backup Archive Alignment](./03-backup-archive-alignment.md)           | pending |

**Prerequisite:** [Kernel Assembly](../kernel-assembly/README.md) must be complete. This plan depends on the plugin bundle format and `@ryot/cli` delivered there.

## Problem Statement

A plugin is a multi-file source package, but the authenticated install and update endpoints accept it as a JSON body containing a manifest object and a map of file paths to file contents. That shape has three consequences.

The package has no artifact identity. A plugin author cannot produce a single file, hand it to someone, and know that what is installed is what was built. Every consumer reassembles the package from a JSON structure instead.

The package travels through a request body. Package size is therefore bounded by request body limits rather than by the plugin package limits the ingestion path already enforces, and a large upload competes with ordinary request handling instead of using the existing upload path that imports and backup restore already use.

The package is represented differently in each place it appears. After the kernel assembly plan, a shipped plugin is a bundle directory, an uploaded plugin is a JSON file map, and a backed-up private plugin is a source file map inside a newline-delimited record stream. These are three encodings of one thing.

The repository already contains everything needed to fix this. Backup export and restore produce and consume deterministic ZIP archives with integrity validation, entry limits, and path-traversal protection. Backup restore and imports already accept an upload token, claim the uploaded object, and stream it. Only plugin installation has its own transport.

## Solution

Define one archive as the transport encoding of a plugin bundle, and use it everywhere a plugin package crosses a boundary.

`@ryot/cli` gains archive output alongside the directory bundle it already produces. The archive is a deterministic ZIP containing the bundle's canonical manifest and its source tree, so identical inputs produce identical bytes and the archive can be content-addressed and verified.

Install and update stop accepting a source file map in the request body. The client creates an upload intent, uploads the archive, and submits the resulting token with its configuration. The server claims the upload, reads the archive under the existing archive security and resource limits, and hands the decoded manifest and file map to the unchanged ingestion, compilation, and validation path. Package limits are enforced against the decoded contents exactly as they are today.

Backup export stores each owned private plugin as that same archive rather than as an inline source file map, and restore reads it back through the same reader. Deterministic ordering, hashes, counts, streaming behavior, and existing ZIP security validation are preserved.

The shipped image keeps extracted bundle directories. The archive is the transport encoding of a bundle, not a second runtime format, so the server never unpacks an archive at boot and plugin discovery is untouched.

Please note that this is a greenfield project with no production user data, so breaking changes and bigger refactors are fine. No bridge or compatibility code should remain, and documentation is to be updated.

## User Stories

1. As a plugin author, I want a single file that represents my built plugin, so that I can distribute and install exactly what I built.
2. As a plugin author, I want identical sources to produce identical archive bytes, so that a package can be verified rather than trusted.
3. As an authenticated user, I want to install a plugin by uploading its archive, so that package size is governed by plugin limits rather than by request body limits.
4. As an authenticated user, I want an invalid or malicious archive rejected before any package work begins, so that upload cannot become an attack surface.
5. As an authenticated user, I want install and update to keep their existing validation, compilation, and configuration behavior, so that only the transport changes.
6. As a user creating a backup, I want my private plugin packages stored as the same archive I could install, so that a backup is portable without a translation step.
7. As a user restoring a backup, I want plugin packages read through the same validated reader as an upload, so that restore and install cannot diverge.
8. As a Ryot developer, I want one encoding of a plugin package across build, upload, and backup, so that a package is not reassembled differently in three places.

## Implementation Decisions

### Archive Format

- A plugin archive is a ZIP containing the bundle contents: the canonical `manifest.json` at the archive root and the source tree beneath it.
- Archive production is deterministic. Entry order, timestamps, and metadata are fixed so identical inputs produce identical bytes.
- The archive is the transport encoding of a bundle. It introduces no manifest fields, no runtime format, and no change to plugin discovery or ingestion.
- Reading an archive yields exactly the manifest and file map the ingestion path already accepts. Package identity remains the existing source hash derived from those values.
- Reading enforces entry count, entry size, total size, path normalization, and traversal protection, reusing the archive security behavior that backup restore already applies.
- `@ryot/cli plugin build` emits both the bundle directory and the archive. The image assembly consumes the directory; upload and backup consume the archive.

### Upload Lifecycle

- Install and update accept an upload token and configuration. They no longer accept a manifest object or a source file map in the request body.
- The server claims the uploaded object through the existing upload intent path, the same one used by imports and backup restore, and releases it on both success and failure.
- Archive reading and validation happen before ingestion begins. Existing plugin package limits, manifest decoding, source validation, compilation, effective-registry collision checks, schema-evolution checks, and configuration validation are unchanged and run in their current order.
- The plugin archive extension is added to the supported upload extensions so upload validation accepts it.
- Failures keep their existing structured reasons. Archive-level failures are reported distinctly from manifest, compilation, and configuration failures so an author can tell a bad file from a bad plugin.

### Backup Alignment

- Backup export writes each owned private plugin package as a plugin archive entry instead of an inline source file map, and records the same identity information it records today.
- Backup restore reads those entries through the same archive reader used by upload, before opening the domain write transaction, exactly as it validates and compiles private packages today.
- System plugins remain recorded as exact requirements and are never copied into a user backup.
- Deterministic ordering, section hashes, counts, streaming behavior, existing ZIP validation, asset verification, resource limits, and secret redaction are preserved.

### Interface Consequences

- The plugin install and update contract changes shape. There is no compatibility path for the previous request body.
- No plugin management or plugin installation user interface exists yet, so no client work is required. The interface is built when the client plugin architecture is implemented, against this contract.
- Documentation for authoring and installing a plugin is updated to describe building an archive and uploading it.

## Testing Decisions

- Determinism is covered by asserting that building the same sources twice produces identical archive bytes.
- Round-tripping is covered by asserting that reading a built archive yields the same manifest and file map that the directory bundle produces.
- Archive rejection is covered for oversized entries, excessive entry counts, and traversal-shaped paths, reusing the existing archive security expectations.
- Install and update behavior is covered by asserting that validation, compilation, collision, schema-evolution, and configuration outcomes are unchanged when the same package arrives as an archive.
- Backup coverage asserts that export and restore round-trip a private plugin through the archive with unchanged determinism, hashes, and redaction.

## Out Of Scope

- Changing plugin discovery, system plugin trust, ingestion, compilation, installation lifecycle, or definition qualification.
- Unpacking archives at server boot or shipping archives instead of directories in the image.
- Plugin signing, publisher identity, trust chains, or a remote plugin registry.
- Plugin management or plugin installation user interface.
- Adding further `@ryot/cli` commands beyond archive output on the existing one.
- Changing backup semantics beyond how a private plugin package is stored.

## Further Notes

- The image intentionally keeps extracted directories. Unpacking at boot would add a failure mode and defeat per-plugin image layer caching for no benefit.
- Determinism is what makes the archive worth having. Without it the archive is merely a container; with it a package can be content-addressed, compared, and verified.
- This plan is deliberately sequenced after kernel assembly. The bundle must exist as a defined artifact before an encoding of it is worth standardizing.
