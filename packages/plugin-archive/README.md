# Plugin Archives

This package is the canonical deterministic archive reader and writer for system and private
plugins. Archives contain compiled artifacts, not authoring sources.

## Format

The writer emits `manifest.json` first, followed by compiled backend and compiled client metadata
and files. Each group is sorted by JavaScript code units. The manifest is tab-indented JSON with one
trailing newline. ZIP entries use epoch mtime, OS 0, and deflate level 6.

Compiled script entry labels remain canonical `backend/**` or `shared/**` `.sandbox.ts` paths;
they identify authored entries, not source files stored in the archive. Raw `backend/**`,
`shared/**`, and `client/**` entries, including raw assets, are rejected. Canonical client file policy
comes from `@ryot-app/plugin-client-contract`.

Executable JavaScript is validated as UTF-8 without changing its bytes or stripping a leading BOM.
Compiled client assets, including SVG, remain bytes and are not decoded as executable text.

## Limits And Rejections

`PLUGIN_ARCHIVE_LIMITS` in `src/index.ts` defines entry counts, path bytes, compressed bytes, manifest
bytes, compiled backend/client bytes, metadata bounds, and total decompressed bytes. The same bounds
apply to every archive. Readers enforce compressed and decompressed limits while streaming and
terminate the active entry immediately on overflow. `PluginArchiveErrorReason` is the canonical set
of stable rejection reasons.
