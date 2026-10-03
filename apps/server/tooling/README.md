# Server Tooling

`build.ts` compiles native smoke fixtures and bundles `src/main.ts` and `prepare-sandbox-runtime.ts` into `dist/`, inlining
`RYOT_VERSION` and `UNKEY_ROOT_KEY`. `version.ts` resolves the version from `RYOT_VERSION`, falling
back to `git describe --tags --always --dirty`; `apps/server/dev.ts` passes the same value to the
unbundled server.

`assemble.ts` copies the archives named in `shipped-plugins.json`, verifies their client artifact
hashes, compiles the client runtime and kernel renderers, and writes `plugins/client-image.json`.
It also copies the canonical native executable, launcher, snapshots, and manifest to `sandboxd/`
and generates the precompiled smoke fixtures in `dist/`.
Run it with `bun run assemble` from `apps/server`; its output matches the `/home/ryot` image layout.

`prepare-sandbox-runtime.ts` is bundled into `dist/prepare-sandbox-runtime.js`. During image creation it
loads the precompiled fixtures and executes real definitions through the supervisor and host-call
gate on all six trust × snapshot keys. It verifies alias identity and mediated host calls without
loading compiler workers. Linux uses the root-owned installation and separate sidecar UID; macOS
reports unconfined development. The image
runs this entrypoint before setting `NODE_ENV=production`. `apps/server/dev.ts` coordinates local
rebuilds and server restarts.
