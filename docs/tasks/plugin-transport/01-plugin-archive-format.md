# Plugin Archive Format

**Parent Plan:** [Plugin Package Transport](./README.md)

**Status:** pending

## What to build

Define the plugin archive and the reader that consumes it, following the parent plan's Archive Format decisions. Nothing changes transport yet; this task makes the artifact exist, be deterministic, and be safely readable.

Extend `@ryot/cli plugin build` to emit a ZIP archive alongside the bundle directory it already produces. The archive contains the canonical `manifest.json` at its root and the source tree beneath it. Production is deterministic: entry order, timestamps, and metadata are fixed so that identical inputs produce identical bytes.

Add a reader that turns an archive into exactly the manifest and file map the existing ingestion path accepts, so package identity remains the existing source hash derived from those values. The reader enforces entry count, entry size, total size, path normalization, and traversal protection, reusing the archive security behavior that backup restore already applies rather than introducing a second set of rules.

Place the reader where both the install path and the backup path can use it, since Task 02 and Task 03 both consume it. Do not change plugin discovery, ingestion, compilation, or the image, which continues to ship extracted bundle directories.

## Acceptance criteria

- [ ] `plugin build` emits a plugin archive alongside the bundle directory.
- [ ] Building identical sources twice produces byte-identical archives.
- [ ] Reading a built archive yields the same manifest and file map as the corresponding bundle directory.
- [ ] The reader rejects oversized entries, excessive entry counts, oversized totals, and traversal-shaped paths, using the existing archive security expectations.
- [ ] The reader is available to both the plugin install path and the backup path.
- [ ] Plugin discovery, ingestion, compilation, and image contents are unchanged.
- [ ] Repository check and test tasks pass.
