# Client Plugin Compiler

Rationale for these rules lives in `README.md`.

- Keep import policy, limits, protocol, output model, and public API independent from `@ryot-app/sandbox-compiler`. Shared generic TypeScript infrastructure belongs in `@ryot-app/typescript-compiler`.
- Keep the trusted module allowlist fixed: `clsx`, `react`, `react-dom`, `react-dom/client`, `react/jsx-runtime`, the published `@ryot-app/client-sdk` entry points, and the `@ryot-app/client-ui-sdk` entry points including `/table` and `/schema-form`. Any other bare import must fail compilation, never silently pass through.
- Inject the Tailwind entry into the generated stylesheet rather than relying on a plugin to `@import` it, and serve it once so a plugin that also imports it is a no-op.
- Leave cursor and focus-visible base rules to the inlined `theme.css`; `clientBaseStylesheet` must not redefine them.
- Inline `@ryot-app/client-ui-sdk/palette.css` after `theme.css`, and emit the plugin's own stylesheet before it. Changing a palette value means bumping `CLIENT_COMPILER_VERSION` so installed plugins are recompiled.
- Emit `index.html` last and exclude it from the artifact hash it carries; the hash covers `plugin.js`, `plugin.css`, and assets only.
- Embed artifact identity (format, versions, hash) in the compiler; never let plugin source declare or override it.
