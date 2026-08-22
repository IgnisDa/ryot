# Client Plugin Compiler

- Keep import policy, limits, protocol, output model, and public API independent from `@ryot-app/sandbox-compiler`. Shared generic TypeScript infrastructure belongs in `@ryot-app/typescript-compiler`; do not share engine-specific behavior or contracts.
- The trusted module allowlist (`clsx`, `react`, `react-dom`, `react-dom/client`, `react/jsx-runtime`, the published `@ryot-app/client-sdk` entry points, and the `@ryot-app/client-ui-sdk` entry points, including its `/table` and `/schema-form` subpaths) is fixed; any other bare import must fail compilation, never silently pass through.
- Emit `index.html` last and exclude it from the artifact hash it carries; the hash covers `plugin.js`, `plugin.css`, and assets only.
- Artifact identity (format, versions, hash) is embedded by the compiler; never let plugin source declare or override it.
