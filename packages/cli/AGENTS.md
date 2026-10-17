# Ryot CLI

- Keep the CLI limited to `plugin build`. Default archive paths are `dist/<publisher>/<name>.zip` from the canonical package ID.
- Treat the current working directory as the plugin package root and validate manifests with the canonical contract schema before replacing output.
- Derive `scripts` from the compiled `backend/**/*.sandbox.ts` entries; the authored manifest must not declare them.
- Collect canonical backend, shared, and client files for compiler input. Archive only the manifest and compiled script and client artifacts; authored sources and raw assets must not enter the archive.
- `plugin build` runs `@ryot-app/plugin-backend-compiler` and, when the manifest declares a client entry, `@ryot-app/plugin-client-compiler` too. Both compiled outputs are required in the archive; either compiler's diagnostics fail the build before the archive is written.
