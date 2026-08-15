# Client Plugin Compiler

Rationale lives in `README.md`.

- Keep import policy, limits, protocol, output model, and public API independent from `@ryot-app/sandbox-compiler`; share only generic infrastructure through `@ryot-app/typescript-compiler`.
- Keep client trusted bare imports exact: `clsx`, `react`, `react-dom`, `react-dom/client`, `react/jsx-runtime`; `@ryot-app/client-sdk` plus `/effect`, `/plugin`, `/react`, `/ryotql`, and `/screen`; `@ryot-app/ryotql-recipes/saved-views`; and `@ryot-app/client-ui-sdk` plus `/icon`, `/schema-form`, `/sync`, `/table`, and `/tint`. Only `shared/**` sources may import `@ryot-app/plugin-kit/{effect,ryotql,schema}`. Reject every other bare import.
- Resolve trusted packages through their public exports and normal Vite filesystem resolution. Do not add package-specific bundler repairs.
- Restrict `shared/**` bare imports to the three plugin-kit neutral shims and relative imports to `shared/`. Keep this policy aligned with the sandbox compiler.
- Inject the official Tailwind Vite entry once with automatic scanning disabled. Emit plugin CSS before compiler-owned fonts, theme, palette, and base styles.
- Scan reachable contributor client sources plus both SDKs for Tailwind classes. Visual code may live in either SDK; never rely on incidental class overlap.
- Keep `CLIENT_COMPILER_VERSION` at 1 unless an explicit coordinated boundary change requires otherwise.
- Hash every non-HTML Vite output and every variable `index.html` template input, including the plugin name. Finalize `index.html` last and exclude it from the hash it embeds.
- Embed artifact identity in the compiler, never plugin source. Reuse cache only when all current artifact metadata matches; do not add stale fallback.
