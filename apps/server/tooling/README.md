# Server Tooling

`build.ts` writes the native smoke fixtures to `dist/`, bundles `src/main.ts` and `prepare-sandbox-runtime.ts` there, and inlines
`RYOT_VERSION` and `UNKEY_ROOT_KEY`. `version.ts` resolves the version from `RYOT_VERSION`, falling
back to `git describe --tags --always --dirty`; `apps/server/dev.ts` passes the same value to the
unbundled server.

`assemble.ts` copies the archives of the package IDs listed in `shipped-plugins.json` (resolved by `shipped-plugins.ts`), verifies their client artifact
hashes, compiles the client runtime and kernel renderers, and writes `plugins/client-image.json`.
It also copies the canonical native executable, launcher, and snapshots to `sandboxd/`.
Run it with `bun run assemble` from `apps/server`; its output matches the `/home/ryot` image layout.

`prepare-sandbox-runtime.ts` is bundled into `dist/prepare-sandbox-runtime.js`. CI runs it in the
built release image with no network. It loads the precompiled fixtures and executes real definitions through the supervisor and host-call
gate on all six trust × snapshot keys. It verifies alias identity and mediated host calls without
loading compiler workers. Linux uses the root-owned installation and separate sidecar UID; macOS
reports unconfined development. Run `bun turbo --filter=@ryot-app/server dev` from the repository
root. Turbo builds or restores dependency artifacts before server dev; `apps/server/dev.ts` assembles
artifacts, watches local changes, and restarts the server.
