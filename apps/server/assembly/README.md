# Server Assembly

`assemble.ts` copies the archives named in `shipped-plugins.json`, verifies their client artifact
hashes, compiles the client runtime and kernel renderers, and writes `plugins/client-image.json`.
Run it with `bun run assemble` from `apps/server`; its output matches the `/home/ryot` image layout.

`sandbox-runtime-image.ts` is bundled into `dist/sandbox-runtime-image.js`. During image creation it
materializes the Deno dependency cache, checks the installed Deno version against the generated
payload, and executes a mediated sandbox script to verify alias identity and bridge access. The image
runs this entrypoint before setting `NODE_ENV=production`. `apps/server/dev.ts` coordinates local
rebuilds and server restarts.
