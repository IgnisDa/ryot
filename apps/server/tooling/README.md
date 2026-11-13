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

`agent-docs.ts` generates `dist/agent-docs.json`, the page SDK documentation topics served by the
`read_docs` agent tool, during every server build from the compiler's allowed SDK entries and
SDK-owned examples. Ship it beside the server bundle and shared chunks. Production loads this file
without loading build tooling or regenerating the topics; unbundled development generates them from
current sources.

`assistant-eval.ts` measures Ryo against a running server with real provider calls, so it is
kept out of CI. Create an API key for a dedicated account and run
`RYOT_EVAL_API_URL=http://localhost:<port>/api RYOT_EVAL_API_KEY=<key> bun run tooling/assistant-eval.ts`
from `apps/server`. When `SERVER_ASSISTANT_MODEL` and `SERVER_ASSISTANT_BASE_URL` are set (Bun also
loads them from `.env`), the script configures them, with the optional `SERVER_ASSISTANT_API_KEY`, as
the account's own provider; otherwise the account's resolved provider is used. `RYOT_EVAL_ONLY` takes
comma-separated task names. Each task starts a conversation, approves every write, and checks the
turn status, the tools and capabilities used and, for page tasks, the resulting page state. The
script removes leftover `eval-` pages first, prints a summary table, and writes a JSON report with
each answer to `tmp/`.
