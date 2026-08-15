# Client Plugin Compiler

Rationale lives in `README.md`.

- Keep import policy, limits, protocol, output model, and public API independent from `@ryot-app/sandbox-compiler`; share only generic infrastructure through `@ryot-app/typescript-compiler`.
- Treat `CLIENT_DEPENDENCY_REGISTRY` in `src/dependencies.ts` as the only authority for trusted and neutral imports and their TypeScript entries. Derive every policy view from it; reject bare imports absent from it.
- Resolve trusted packages through their public exports and normal Vite filesystem resolution. Do not add package-specific bundler repairs.
- Restrict `shared/**` bare imports to the three plugin-kit neutral shims and relative imports to `shared/`. Keep this policy aligned with the sandbox compiler.
- Inject the official Tailwind Vite entry once with automatic scanning disabled. Emit plugin CSS before compiler-owned fonts, theme, palette, and base styles.
- Scan plugin client sources plus both SDKs for Tailwind classes. Visual code may live in either SDK; never rely on incidental class overlap.
- Bump `CLIENT_COMPILER_VERSION` when emitted artifact bytes or compiler compatibility changes.
- Hash every emitted module file and the plugin name; sort final artifact files by name.
- Embed artifact identity in the compiler, never plugin source. Reuse cache only when all current artifact metadata matches; do not add stale fallback.
