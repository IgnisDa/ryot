# Plugin Archives

- Preserve exact executable bytes, including a leading BOM. Validate compiled JavaScript as UTF-8; do not decode client assets.
- Keep archives deterministic and source-free. Follow the format and limits in `README.md`.
- Enforce compressed and decompressed limits while streaming; stop the active entry immediately on overflow.
- Every rejection maps to a stable `PluginArchiveError` reason.
