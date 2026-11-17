# Plugin Archives

This package is the canonical deterministic archive reader and writer for system and private
plugins. Archives contain compiled artifacts, not authoring sources.

## Format

The writer emits `manifest.json` first, followed by compiled backend and compiled client metadata
and files, then compiled message catalogs. Each group is sorted by JavaScript code units. The manifest is compact JSON in JavaScript
property enumeration order with one trailing newline. Readers accept valid JSON whitespace. Compiled
metadata remains tab-indented JSON. ZIP entries use epoch mtime, OS 0, and deflate level 6.

Compiled script entry labels remain canonical `backend/**` or `shared/**` `.sandbox.ts` paths;
they identify authored entries, not source files stored in the archive. Raw `backend/**`,
`shared/**`, and `client/**` entries, including raw assets, are rejected. Canonical client file policy
comes from `@ryot-app/plugin-client-contract`.

Compiled message catalogs (`CompiledCatalog` from `@ryot-app/i18n/catalog`) are stored as
`messages/<locale>.json`, one compact JSON file per canonical BCP 47 locale, and the source locale
(`en`) is required. Readers validate locale paths and the catalog schema. `decodePluginCatalogs`
checks an untrusted catalog set: the catalog count, canonical locales, the catalog schema and limits,
the English catalog, and that no catalog defines a kernel common message key. Writers and installation apply it, so installation never trusts an archive.

Executable JavaScript is validated as UTF-8 without changing its bytes or stripping a leading BOM.
Compiled client assets, including SVG, remain bytes and are not decoded as executable text.

## Limits And Rejections

`PLUGIN_ARCHIVE_LIMITS` in `src/index.ts` defines entry counts, path bytes, compressed bytes, manifest
bytes, compiled backend/client bytes, metadata bounds, message catalog count and bytes, and total
decompressed bytes. The same bounds
apply to every archive. Readers enforce compressed and decompressed limits while streaming and
terminate the active entry immediately on overflow. `PluginArchiveErrorReason` is the canonical set
of stable rejection reasons.
