# Sandbox subsystem

This folder implements the backend sandbox runtime used by `sandboxApi`.

The model is:

- Run untrusted user code in a fresh Deno subprocess per execution.
- Keep a long-lived localhost bridge server in the backend process.
- Expose selected host functions (for example `addNumbers`, `httpCall`) to user code through bridge RPC calls.

## Main components

- `index.ts`: singleton lifecycle helpers (`initializeSandboxService`, `getSandboxService`, `shutdownSandboxService`).
- `service.ts`: orchestration for startup/shutdown, queue enqueueing, and worker-side execution.
- `bridge.ts`: localhost RPC bridge (`POST /rpc/:executionId/:fnName`) + session validation.
- `runner.ts`: manages the temporary runner file on disk.
- `scripts/runner-source.txt`: source code executed by Deno for each run.
- `constants.ts`: default limits and guardrail values.
- `utils.ts`: process and stream helpers (`waitForExit`, timeout guard, JSON response helpers).
- `types.ts`: shared sandbox host-function, descriptor, and result types.

## How one execution works

1. `POST /sandbox/enqueue` accepts `{ code, driverName, context? }` and returns a BullMQ `jobId` immediately.
2. The route builds `apiFunctionDescriptors` server-side and stores them in the job payload.
3. A worker calls `SandboxService.executeQueuedRun(...)` for the job.
4. The service reconstructs bound host functions from the static registry, then creates a unique `executionId` and one-time bearer token.
5. The bridge session is registered:
   - Redis stores `{ token, expiresAt }` under `sandbox:session:<executionId>` with TTL.
   - An in-memory map stores the bound host functions for that execution.
6. A Deno subprocess is spawned with restricted permissions.
7. The service sends one JSON payload over stdin (`code`, `driverName`, `context`, bridge URL, token, function names, execution id, script id).
8. Inside Deno (`scripts/runner-source.txt`):
   - payload is parsed,
   - `console.*` is redirected to stderr,
   - host-function stubs are created so user code can call `await someHostFn(...)`,
   - user code runs in an async wrapper, which registers drivers via `driver(name, fn)`,
   - the named driver is looked up and called with `context` and optional `meta`,
   - final result is written as JSON to stdout.
9. Bridge calls from stubs hit `POST /rpc/:executionId/:fnName`:
   - execution and expiry are checked,
   - bearer token is validated,
   - body is parsed (`{ args: [...] }`),
   - mapped host function is executed,
   - `{ result }` or `{ error }` is returned.
10. The service collects:
    - `stdout` -> final sandbox result JSON,
    - `stderr` -> `logs`.
11. Session is removed in `finally`.

## API shape

- `POST /sandbox/enqueue` enqueues a script and returns `{ data: { jobId } }`.
- `GET /sandbox/result/:jobId` returns one of:
  - `{ data: { status: "pending" } }`
  - `{ data: { status: "completed", logs, value, error } }`
  - `{ data: { status: "failed", error } }`

## Security and isolation

- **Process isolation:** user code runs in a separate Deno process per execution.
- **Deno restrictions:**
  - denied: `--deny-run`, `--deny-env`, `--deny-ffi`, `--deny-write`, `--no-remote`
  - allowed: `--allow-read=<runner-file>`, `--allow-net=127.0.0.1:<bridge-port>`
  - import enforcement: `--cached-only` (only pre-approved packages loadable; see below)
- **Network boundary:** sandbox can only talk to the local bridge; external network access must go through explicit host functions. `--allow-net` is bridge-only, so even code inside imported packages cannot reach external hosts.
- **Auth boundary:** each execution has a random bearer token checked by bridge routes.
- **Timeout enforcement:** timeout guard sends `SIGTERM`, then `SIGKILL` after a short delay.
- **Memory limit:** Deno runs with `--v8-flags=--max-heap-size=<maxHeapMB>`.
- **Input limit:** bridge request body is capped (`requestBodyLimit`, currently 128 KB).
- **Environment leakage:** sandbox process only receives a minimal env (`PATH`, `DENO_DIR`). `DENO_DIR` is read by the Deno runtime itself before the `--deny-env` sandbox applies, so user code cannot access it.

## Vendored packages

User scripts can import a curated set of pre-cached npm packages via dynamic `import()`:

```js
driver("parse", async function(context) {
  const { load } = await import("npm:cheerio");
  const dayjs = (await import("npm:dayjs")).default;
  const { z } = await import("npm:zod");
  // ...
});
```

The allowlist lives in `constants.ts` (`vendoredPackages`). At service startup, `PackageCacheManager.populate()` runs `deno cache --no-config` for each package into a persistent local directory (default: `~/.ryot/sandbox-deno-cache`, overridable via `RYOT_SANDBOX_DENO_DIR`). The `--cached-only` Deno flag then enforces that only cached packages can be imported — attempting to import anything not in the allowlist fails with a clear error surfaced in the sandbox result.

### Adding a new vendored package

1. Append the specifier (e.g. `"npm:cheerio"`) to `vendoredPackages` in `constants.ts`.
2. Restart the service. `PackageCacheManager.populate()` downloads the new package on startup.
3. If the cache already exists and the network is unavailable at startup, the service logs a warning and continues with the existing cache.

### Cache directory

The cache persists across restarts. In Docker deployments, mount the cache directory as a volume so packages do not need to be re-downloaded on every container start.

## Runtime behavior notes

- The bridge server and runner file are created once on service startup and reused.
- Deno subprocesses are still per-execution, which keeps run isolation while avoiding bridge re-creation overhead.
- Redis session metadata allows TTL-based expiry and explicit cleanup on shutdown.
- Host functions are serialized as descriptors in the job payload, so any worker instance can reconstruct them.

## Adding a new host function

1. Implement the host function with the signature `(context, ...args) => Promise<unknown>`.
2. Register it in `function-registry.ts`.
3. Add a descriptor for it where sandbox jobs are enqueued.

For stateless functions use an empty context object. For stateful functions, bind per-request data into the descriptor context before enqueueing.

## Driver functions

Driver functions are the only entry points in sandbox scripts. Every script must register at least one driver using `driver(name, fn)`, and the caller must supply a matching `driverName` when enqueueing.

A driver receives two arguments:

1. `context` — user-provided execution context containing input data (e.g., search query, page size)
2. `meta` — system-provided metadata object containing `{ sandboxScriptId: string }` when running from a stored script, or `undefined` when running ad-hoc code

```js
driver("search", async function(context, meta) {
  // meta.sandboxScriptId contains the script ID when available
  const response = await httpCall("GET", "https://api.example.com/search");
  return response;
});
```
