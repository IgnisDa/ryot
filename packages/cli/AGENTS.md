# Ryot CLI

- Keep the CLI limited to `plugin build` unless a separate plan expands its scope.
- Treat the current working directory as the plugin package root and validate manifests with the canonical contract schema before replacing output.
- Keep archives limited to `manifest.json`, non-test TypeScript sources under `backend/`, and non-test files under `client/` allowed by the canonical contract client file policy.
