# Plugin Archive Package

- Archives contain `manifest.json` first, then `backend/**`, canonically supported `shared/**` and `client/**` sources, then compiled script and client artifact entries, sorted within each group by JavaScript code units. Import the client file policy from `@ryot-app/client-plugin-contract` and the shared file policy from `@ryot-app/contract`; do not duplicate either here.
- Encode the manifest as tab-indented JSON with one trailing newline and preserve every file's exact bytes.
- Require fatal UTF-8 validation for `backend/**`, `shared/**`, and client text sources. Do not decode client assets, including SVG.
- Keep archive output deterministic: ZIP epoch mtime, OS 0, and deflate level 6.
- Enforce compressed and decompressed limits while streaming. Terminate the active entry as soon as a decompressed limit is exceeded.
- Apply container limits to every archive: 1024 entries, 256-byte paths, a 4 MiB manifest, 256 KiB per source, 8 MiB compiled client bytes, 32 MiB compiled script bytes, and 32 MiB compressed bytes.
- Keep every archive rejection mapped to one stable `PluginArchiveError` reason.
