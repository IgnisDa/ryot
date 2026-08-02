# Client Plugin Compiler

- Keep import policy, output model, and public API independent from `@ryot/sandbox-compiler`; do not unify or share code between the two compilers.
- The trusted module allowlist (`react`, `react-dom`, `react-dom/client`, `react/jsx-runtime`, `@ryot/client-plugin-sdk`, `@ryot/client-ui-sdk`) is fixed; any other bare import must fail compilation, never silently pass through.
- Emit `index.html` last and exclude it from the artifact hash it carries; the hash covers `plugin.js`, `plugin.css`, and assets only.
- Artifact identity (format, versions, hash) is embedded by the compiler; never let plugin source declare or override it.
