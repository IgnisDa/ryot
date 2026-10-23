# Ryot CLI

Run commands from the plugin package root.

`ryot plugin build` validates the manifest and compiles backend and client sources. It writes a deterministic source-free archive to `dist/<publisher>/<name>.zip`. Use `--output <path>` for an explicit filename or `--watch` to rebuild after source changes.

Client dependency declarations map importer-local aliases to `{ packageId, scope }`. Authored imports use `@ryot-app/plugins/<alias>/<export>`. Compilation replaces the alias with the exact scoped package target; it does not install dependencies or select revisions.

Client artifacts record the imported package/export targets and a hash of the full client declaration. Archive validation rejects an artifact whose declaration hash differs from the manifest, even when its package ID and executable bytes are unchanged. These checks establish representation consistency, not compiler provenance or publisher authenticity.
