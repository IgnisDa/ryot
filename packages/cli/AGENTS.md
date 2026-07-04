# Ryot CLI

- Keep the CLI limited to `plugin build` unless a separate plan expands its scope.
- Treat the current working directory as the plugin package root and validate manifests with the canonical contract schema before replacing output.
- Derive `scripts` from the compiled `backend/**/*.sandbox.ts` entries; the authored manifest must not declare them.
- Keep archives limited to `manifest.json`, non-test TypeScript sources under `backend/`, and non-test files under `client/` allowed by the canonical client source file policy from `@ryot-app/client-plugin-contract`. A plugin's `host/` tree is never archived.
