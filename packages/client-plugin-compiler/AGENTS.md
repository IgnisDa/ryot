# Client Plugin Compiler

Rationale lives in `README.md`.

- Keep import policy, limits, protocol, output model, and public API independent from `@ryot-app/sandbox-compiler`; share only generic infrastructure through `@ryot-app/typescript-compiler`.
- Keep client trusted bare imports exact: `clsx`, `react`, `react-dom`, `react-dom/client`, `react/jsx-runtime`; `@ryot-app/client-sdk` plus `/effect`, `/plugin`, `/react`, `/ryotql`, and `/screen`; and `@ryot-app/client-ui-sdk` plus `/icon`, `/schema-form`, `/sync`, `/table`, and `/tint`. Only `shared/**` sources may import `@ryot-app/plugin-kit/{effect,ryotql,schema}`. Reject every other bare import.
- Resolve trusted transitive barrels such as `effect` and `lucide-react` to concrete paths. Keep the Effect shim exports and pinned `effect/*` resolver entries synchronized, and execute emitted JavaScript when adding a barrel.
- Restrict `shared/**` bare imports to the three plugin-kit neutral shims and relative imports to `shared/`. Keep this policy aligned with the sandbox compiler.
- Inject the Tailwind entry once. Emit plugin CSS before inlined `theme.css` and `palette.css`, and leave shared cursor and focus rules to `theme.css`.
- Keep `CLIENT_COMPILER_VERSION` at 1 unless format, client API, bridge, compiler, cache, and runtime consumers change together.
- Hash `plugin.js`, `plugin.css`, assets, and every variable `index.html` input, including the plugin name. Emit `index.html` last and exclude it from the hash it embeds.
- Embed artifact identity in the compiler, never plugin source. Reuse cache only when all current artifact metadata matches; do not add stale fallback.
