# Client Plugin Compiler

- Keep import policy, limits, protocol, output model, and public API independent from `@ryot-app/sandbox-compiler`. Shared generic TypeScript infrastructure belongs in `@ryot-app/typescript-compiler`; do not share engine-specific behavior or contracts.
- The trusted module allowlist (`clsx`, `react`, `react-dom`, `react-dom/client`, `react/jsx-runtime`, the published `@ryot-app/client-sdk` entry points, and the `@ryot-app/client-ui-sdk` entry points, including its `/table` and `/schema-form` subpaths) is fixed; any other bare import must fail compilation, never silently pass through.
- Inject the Tailwind entry into the generated stylesheet rather than relying on a plugin to `@import` it. A plugin may ship no stylesheet at all, and without the entry that document gets neither Preflight nor a registered `@layer` order, so the accessibility base layer inlined from `@ryot-app/client-ui-sdk/theme.css` would land in an unregistered layer that any author rule outranks. Serve the entry once so a plugin that also imports it is a no-op.
- Plugin documents inherit their cursor and focus-visible base rules from that inlined `theme.css`; `clientBaseStylesheet` must not redefine them.
- Emit `index.html` last and exclude it from the artifact hash it carries; the hash covers `plugin.js`, `plugin.css`, and assets only.
- Artifact identity (format, versions, hash) is embedded by the compiler; never let plugin source declare or override it.
