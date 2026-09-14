# Kernel Renderers

Rationale lives in `README.md`.

- Keep every renderer source inside the client plugin import allowlist and free of Node and Bun APIs; it is compiled as plugin source, not kernel code.
- Emit renderer sources through `bun run build`; never hand-edit `sources.generated.ts` and never read renderer files at runtime, because `apps/server` bundles.
- Hash exactly the bytes that are encoded into `files`, and list each renderer's reachable sources in `src/index.ts`.
- Take the saved view's name and icon from the page context. Never hardcode a renderer name as the screen title.
- Drive compact chrome from `useRyotViewport().compact` and size layouts with Tailwind container queries; a media query here measures the iframe.
- Leave refresh to the host and to entity settle updates; renderers ship no manual refresh control.
- Keep test-only fixtures out of `src/` root so the generator does not ship them.
