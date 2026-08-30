# Direct Vite Cutover Report

## Status

The implementation uses Vite for sandbox, trusted Deno, and client compilation. Repository,
production server packaging, runtime smoke, and Chromium browser gates pass. The full Docker image
build was explicitly skipped for this validation; see [Final validation](#final-validation).

## Architecture

- `@ryot-app/vite-compiler` provides protected programmatic Vite invocation, scoped filesystem
  workspaces, diagnostics, environment isolation, and complete output collection.
- `@ryot-app/sandbox-compiler` performs TypeScript semantic checks and sandbox policy checks before
  building one unminified ES2022 Deno ESM module per backend entry.
- `@ryot-app/client-plugin-compiler` performs client policy and type checks, then builds a complete
  Vite application artifact with `index.html`, configured `plugin.js` and `plugin.css` names, and
  Vite-managed chunks and assets.
- Both dynamic compilers provide self-contained TypeScript project options and resolved source/type
  aliases. Vite transforms do not discover repository or package tsconfig files at runtime.
- `sandbox:prepare-runtime` uses Vite to generate the runner, embed kernel scripts, and build the
  trusted runtime payload. The payload registry is owned by `@ryot-app/sandbox-sdk`.

## Removed Bun And Custom Workarounds

Bun bundling for emitted sandbox and client modules is removed. The cutover also removes custom
module-resolution and virtual-source loading, package-specific resolver repairs, manual stylesheet
graphs, font parsing, asset copying, CSS-empty interception, and emitted JavaScript rewriting.
Bun remains the host for workers, filesystem services, dependency resolution, and packaging.

## Deno And Integrity Contracts

Deno execution is unchanged: single-use processes use the existing no-npm, no-lock, no-run,
no-env, no-FFI, no-prompt, no-config, no-remote, cached-only launcher; localhost networking and
execution-specific read/write grants remain scoped. The runner keeps its host bridge, input/output
validation, workflow behavior, and limits.

Compiled sandbox JavaScript is SHA-256 verified, published as read-only content-addressed `.mjs`,
and hard-linked for execution. The trusted payload is verified and materialized at startup from
shipped data. Its metadata records format, Deno/Vite versions, dependency versions, file byte lengths,
and per-file SHA-256 values. Its canonical content hash sorts paths and includes path lengths, byte
lengths, and file bytes. No runtime payload hash is recorded here because the hash may change after
the format correction.

Client artifact identity includes the plugin name, artifact/API/compiler/bridge identity, and sorted
non-HTML file names, content types, and hashes. `index.html` is emitted as the stable entry, then its
metadata placeholder is filled after the other files are hashed. Client version remains 1.

## Compiler Entrypoints And Callers

`@ryot-app/sandbox-compiler/worker` is the standalone supervised worker for user scripts. Built-ins
use `/builtins`; plugin source compilation uses `/plugins`; plugin manifest derivation and declared
script checks use `/plugin-manifest`. Kernel plugin bootstrap, kernel plugin ingestion, `ryot plugin
build`, built-in compiler tests, and packaged-worker smoke tests are the main callers.

## Production Packaging

Compiler workers are built for Bun and copied into the server image. The image installs production
dependencies for the compiler toolchain, builds one archive per shipped plugin, prepares the trusted
Deno payload, and runs worker and runtime smoke checks. The archive sizes recorded for this cutover
are fixture **30,778 bytes**, fitness **34,675 bytes**, and media **401,475 bytes**.

## Baseline And Measurements

Pre-cutover test baseline observed before edits:

- TypeScript compiler: **3 passed, 272 ms**
- Sandbox: **15 passed, 2.01 s**
- Client: **47 passed, 34.75 s**

No pre-cutover per-plugin process-tree measurement was captured. No comparison is fabricated.

Post-cutover plugin builds were measured on macOS with `/usr/bin/time -l`:

| Plugin  | Cold build                         | Repeated build                     |
| ------- | ---------------------------------- | ---------------------------------- |
| fixture | 1.63 s; 510,754,816 bytes max RSS  | 1.29 s; 509,247,488 bytes max RSS  |
| fitness | 1.37 s; 434,683,904 bytes max RSS  | 1.33 s; 436,715,520 bytes max RSS  |
| media   | 12.11 s; 885,309,440 bytes max RSS | 12.59 s; 848,445,440 bytes max RSS |

macOS `/usr/bin/time -l` measures the command process. It does not measure the Linux supervisor's
process-tree proportional set size (PSS).

## Focused Evidence

Current focused green evidence:

- Vite compiler: **21 tests passed**
- Client compiler: **53 tests passed**
- Client contract: **33 tests passed**
- Sandbox compiler: **18 tests passed**
- Targeted kernel sandbox/runner: **42 tests passed previously**

Representative package test commands are `bun --cwd packages/vite-compiler test`,
`bun --cwd packages/client-plugin-compiler test`, `bun --cwd packages/client-plugin-contract test`,
and `bun --cwd packages/sandbox-compiler test`. The kernel sandbox/runner evidence was previously
green.

## Final Validation

- [x] `bun turbo --output-logs=full check`: **30/30 tasks passed**.
- [x] `bun turbo --filter='!@ryot-app/e2e' --output-logs=full test`: **48/48 tasks passed**.
- [x] `bun turbo --filter=@ryot-app/server --output-logs=full build`: **5/5 tasks passed**;
      generated the trusted Deno payload and runner, both compiler workers, and production server
      and smoke executables.
- [x] From a directory without repository TypeScript configuration or `node_modules`, `bun
    "$REPO/apps/server/dist/smoke-compiler-workers.js"
    "$REPO/packages/sandbox-compiler/dist/sandbox-compiler-worker.js"
    "$REPO/packages/client-plugin-compiler/dist/client-plugin-compiler-worker.js"` passed with no
      output, where `REPO` was the current worktree root.
- [x] From the same pruned working directory, `bun
    "$REPO/apps/server/dist/prepare-sandbox-runtime.js" && bun
    "$REPO/apps/server/dist/smoke-sandbox-runtime.js"` passed with no output. This verified
      payload materialization and actual Deno execution with SDK alias interoperability and a
      mediated host call.
- [x] Development startup through `bun run dev` in `apps/server` built current first-party archives
      and renderers, ran migrations through ID 3 (`pg_messages_rowid_index`), verified and
      materialized the trusted payload while constructing the sandbox runtime service, ingested the
      shipped plugins, completed a fitness Deno boot script, listened on port 3000, and returned
      `200 {"status":"healthy"}` from `/api/system/health`.
- [x] The real Vite client ran with `bun run dev -- --host 0.0.0.0` in `kernel/client` on port 3005.
      A Playwright Chromium probe through `https://ryot-testing.ignisda.me` created a greenfield
      account with the existing deterministic fixtures and loaded both `/fixture` and a published
      saved-view renderer under `/v/renderer-view-<id>`.
- [x] Both page types used an `allow-scripts` iframe whose entry was
      `/api/client-pages/artifacts/<token>/index.html`. Across the initial fixture page, its dark
      theme remount, and the saved-view renderer, each iframe issued one index request and one bridge
      bootstrap. All 20 observed artifact requests returned 200. Relative `plugin.js`, `plugin.css`,
      PNG, SVG, and WOFF2 requests remained below the same
      `/api/client-pages/artifacts/<token>/` authorization boundary; no boundary violations occurred.
- [x] Browser behavior included loaded Outfit and Lora fonts, fixture light styles, dark styles with
      `color-scheme: dark`, a working `Greet` button, a successful mediated `Fetch greeting` host call
      (`Hello, Ryot`), and a working navigation drawer at a 390 by 844 viewport. The passing probe
      recorded no console errors, page errors, failed requests, or HTTP error responses.
- [ ] Full `docker build .`: **skipped by explicit user instruction**. Image success is not claimed.

The Dockerfile's Effect warning is a pre-existing baseline: it states that the Docker build is
broken until Effect is upgraded to rc.113. The production commands above validate the packaged
workers and runtime without claiming the image assembly itself.

Only desktop and mobile-viewport Chromium were exercised through the public tunnel. Firefox,
WebKit, native iOS, native Android, and physical-device behavior were not run in this validation.
