# Ryot CLI

- Keep the CLI limited to `plugin build` unless a separate plan expands its scope.
- Treat the current working directory as the plugin package root and validate manifests with the canonical contract schema before replacing output.
- Derive `scripts` from the compiled `backend/**/*.sandbox.ts` entries; the authored manifest must not declare them.
- Archive only canonical backend, shared, and client sources plus their compiled script and client artifacts; never archive a plugin's `host/` tree.
- `plugin build` runs `@ryot-app/sandbox-compiler` and, when the manifest declares a client entry, `@ryot-app/client-plugin-compiler` too. Both compiled outputs are required in the archive; either compiler's diagnostics fail the build before the archive is written.
