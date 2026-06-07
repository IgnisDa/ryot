# Plugin Archive Package

- Archives contain `manifest.json` first, then `backend/**` and `client/**` source paths sorted by JavaScript code units; `client/**` entries must use `.ts`, `.tsx`, `.css`, or `.svg` extensions.
- Encode the manifest as tab-indented JSON with one trailing newline and preserve source UTF-8 bytes.
- Keep archive output deterministic: ZIP epoch mtime, OS 0, and deflate level 6.
- Enforce compressed and decompressed limits while streaming. Terminate the active entry as soon as a decompressed limit is exceeded.
- Apply container limits to every archive: 1024 entries, 256-byte paths, a 4 MiB manifest, 256 KiB per source, 16 MiB total uncompressed, and 8 MiB compressed.
- Keep every archive rejection mapped to one stable `PluginArchiveError` reason.
