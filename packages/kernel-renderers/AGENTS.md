# Kernel Renderers

- Renderer sources are compiled plugin code: obey its import allowlist and exclude Node/Bun APIs.
- Regenerate `sources.generated.ts` with `bun run build`; never edit it or read renderer files at runtime.
- Hash the exact encoded file bytes and list reachable sources in `src/index.ts`. Keep test fixtures outside the shipped `src/` root.
- Use page-context titles/icons. Leave refresh to the host and entity settle updates.
