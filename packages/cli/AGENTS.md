# Ryot CLI

- Keep the CLI limited to `plugin build`; derive script declarations from compiled entries, never the authored manifest.
- Validate manifests and definitions with `@ryot-app/definitions`, and require all declared backend/client compilation to succeed before replacing the archive. Publish only the manifest and compiled artifacts, never authored sources or raw assets.
