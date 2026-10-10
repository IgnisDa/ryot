# Plugin Archive Package

- Archives contain `manifest.json` first, then compiled backend and compiled client metadata and files, sorted within each group by JavaScript code units. Reject raw `backend/**`, `shared/**`, and `client/**` entries, including assets.
- Encode the manifest as tab-indented JSON with one trailing newline and preserve every file's exact bytes.
- Validate compiled backend and client JavaScript as UTF-8 while preserving a leading BOM and the exact executable bytes. Do not decode compiled client assets, including SVG.
- Compiled script entry labels remain canonical `backend/**` or `shared/**` `.sandbox.ts` paths; they do not identify archive source files. Use the canonical file policy from `@ryot-app/client-plugin-contract`.
- Keep archive output deterministic: ZIP epoch mtime, OS 0, and deflate level 6.
- Enforce compressed and decompressed limits while streaming. Terminate the active entry as soon as a decompressed limit is exceeded.
- Apply container limits to every archive: 1024 entries, 256-byte paths, a 4 MiB manifest, 8 MiB compiled client bytes, 32 MiB compiled script bytes, and 32 MiB compressed bytes.
- Keep every archive rejection mapped to one stable `PluginArchiveError` reason.
