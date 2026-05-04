# Sandbox subsystem

This folder implements the backend sandbox runtime used by `sandboxApi`.

The model is:

- Run untrusted user code in a pre-warmed, single-use Deno subprocess drawn from a persistent pool.
- Keep a long-lived localhost bridge server in the backend process.
- Expose selected host functions (for example `httpCall`) to user code through bridge RPC calls.

## Main components

- `index.ts`: singleton lifecycle helpers (`initializeSandboxService`, `getSandboxService`, `shutdownSandboxService`).
- `service.ts`: orchestration for startup/shutdown, queue enqueueing, and worker-side execution.
- `process-pool.ts`: pre-warmed process pool — maintains idle Deno subprocesses and replenishes on checkout.
- `bridge.ts`: localhost RPC bridge (`POST /rpc/:executionId/:fnName`) + session validation.
- `runner.ts`: manages the temporary runner file on disk.
- `scripts/runner-source.txt`: source code executed by Deno for each run.
- `constants.ts`: default limits and guardrail values.
- `utils.ts`: process and stream helpers (`waitForExit`, timeout guard, JSON response helpers).
- `types.ts`: shared sandbox host-function, descriptor, and result types.

## How one execution works

1. User creates a script via `POST /sandbox/scripts` with `{ name, slug?, code, metadata? }`. `metadata` defaults to `{}` when omitted. Returns `{ data: { id, name, slug, code, metadata } }`.
2. User enqueues via `POST /sandbox/enqueue` with `{ scriptId, driverName, context? }`. Returns BullMQ `jobId` immediately.
3. The route verifies the script belongs to the user and enqueues a job with `{ userId, scriptId, driverName, context }`.
4. A worker calls `SandboxService.executeQueuedRun(...)` for the job, fetches the script by `scriptId`, parses its `metadata`, and builds `apiFunctionDescriptors` from `allowedHostFunctions`.
5. The service constructs bound host functions from the static registry, then creates a unique `executionId` and one-time bearer token.
6. The bridge session is registered:
   - Redis stores `{ token, expiresAt }` under `sandbox:session:<executionId>` with TTL.
   - An in-memory map stores the bound host functions for that execution.
7. A pre-warmed Deno subprocess is checked out from the pool. If the pool is empty (burst exceeds capacity), a fresh subprocess is spawned instead. Either way, the subprocess has already paid the V8/Deno startup cost — it is blocked on stdin awaiting a payload. After checkout, the pool immediately spawns a replacement in the background.
8. The service sends one JSON payload over stdin (`code`, `driverName`, `context`, bridge URL, token, function names, execution id, script id) and closes stdin.
9. Inside Deno (`scripts/runner-source.txt`):
   - payload is parsed,
   - `console.log`, `console.warn`, `console.error`, `console.info`, and `console.debug` are redirected to stderr,
   - host-function stubs are created so user code can call `await someHostFn(...)`,
   - user code runs in an async wrapper, which registers drivers via `driver(name, fn)`,
   - the named driver is looked up and called with `context` and optional `meta`,
   - final result (including timing and memory metrics) is written as JSON to stdout.
10. Bridge calls from stubs hit `POST /rpc/:executionId/:fnName`:
    - execution and expiry are checked,
    - bearer token is validated,
    - body is parsed (`{ args: [...] }`),
    - mapped host function is executed,
    - `{ result }` or `{ error }` is returned.
11. The service collects:
    - `stdout` -> final sandbox result JSON,
    - `stderr` -> `logs`.
12. Session is removed in `finally`.

## API shape

- `POST /sandbox/scripts` creates a stored script with `{ name, slug?, code, metadata? }`. `metadata.allowedHostFunctions` is authoritative and defaults to no host functions when omitted. Returns `{ data: { id, name, slug, code, metadata } }`.
- `POST /sandbox/enqueue` enqueues a stored script by `scriptId` with `{ scriptId, driverName, context? }`. Returns `{ data: { jobId } }`.
- `GET /sandbox/result/:jobId` returns one of:
  - `{ data: { status: "pending" } }`
  - `{ data: { status: "completed", logs, value, error, timings, denoMetrics } }`
  - `{ data: { status: "failed", error } }`

`timings` contains server-side execution phases: `{ totalMs, processMs, hostSetupMs, poolHit, cpuUserMs, cpuSystemMs }`. `denoMetrics` contains Deno-side measurements: `{ startupMs, scriptExecMs, memoryRssBytes, memoryHeapUsedBytes }`. Both fields are `null` when the job did not complete normally.

## Security and isolation

- **Process isolation:** user code runs in a single-use Deno subprocess per execution. Even though subprocesses are drawn from a pre-warmed pool, each subprocess handles exactly one execution and then exits — the OS process boundary is preserved.
- **Deno restrictions:**
  - denied: `--deny-run`, `--deny-env`, `--deny-ffi`, `--deny-write`, `--no-prompt`, `--no-remote`
  - allowed: `--allow-read=<runner-file>`, `--allow-net=127.0.0.1:<bridge-port>`
  - import enforcement: `--cached-only` (only pre-approved packages loadable; see below)
- **Network boundary:** sandbox can only talk to the local bridge; external network access must go through explicit host functions. `--allow-net` is bridge-only, so even code inside imported packages cannot reach external hosts.
- **Auth boundary:** each execution has a random bearer token checked by bridge routes.
- **Timeout enforcement:** timeout guard sends `SIGTERM`, then `SIGKILL` after a short delay.
- **Memory limit:** Deno runs with `--v8-flags=--max-heap-size=<maxHeapMB>`.
- **Input limit:** bridge request body is capped (`requestBodyLimit`, currently 128 KB).
- **Environment leakage:** sandbox process only receives a minimal env (`PATH`, `DENO_DIR`). `DENO_DIR` is read by the Deno runtime itself before the `--deny-env` sandbox applies, so user code cannot access it.

## Process pool

At startup, `SandboxService` fills a pool of `sandboxWorkerConcurrency + 2` idle Deno subprocesses. Each subprocess:

1. Starts with the same restricted permission flags used for every execution.
2. Loads V8 and initialises the Deno runtime.
3. Reaches `await new Response(Deno.stdin.readable).arrayBuffer()` and blocks — waiting for a payload.

When a job arrives, `execute()` checks out an idle process from the pool in O(1), writes the payload to its stdin, and waits for it to exit. The pool immediately spawns a replacement subprocess in the background. If the pool is empty under a burst, execution falls back to a fresh spawn (identical to the original behaviour).

**Memory cost:** each idle subprocess uses roughly 40–55 MB RSS. With a pool size of 7 that is ~350 MB pinned while the service is running.

**Why single-use:** reusing a subprocess across executions would allow user code to pollute global state (prototype mutations, lingering timers) and eliminates per-process memory limits. Single-use preserves the full isolation guarantee while still amortising the ~200 ms V8 startup cost.

## Vendored packages

User scripts can import a curated set of pre-cached npm packages via dynamic `import()`:

```js
driver("parse", async function (context) {
	const { load } = await import("npm:cheerio");
	const dayjs = (await import("npm:dayjs")).default;
	const { z } = await import("npm:zod");
	// ...
});
```

The allowlist lives in `constants.ts` (`vendoredPackages`). At service startup, `PackageCacheManager.populate()` runs a single `deno cache --no-config` invocation with all packages as arguments into a persistent local directory (default: `~/ryot/tmp`, overridable via `RYOT_SANDBOX_DENO_DIR`). The `--cached-only` Deno flag then enforces that only cached packages can be imported — attempting to import anything not in the allowlist fails with a clear error surfaced in the sandbox result.

### Adding a new vendored package

1. Append the specifier (e.g. `"npm:cheerio"`) to `vendoredPackages` in `constants.ts`.
2. Restart the service. `PackageCacheManager.populate()` downloads the new package on startup.
3. If the cache already exists and the network is unavailable at startup, the service logs a warning and continues with the existing cache.

### Cache directory

The cache persists across restarts. In Docker deployments, mount the cache directory as a volume so packages do not need to be re-downloaded on every container start.

## Runtime behaviour notes

- The bridge server and runner file are created once on service startup and reused across all executions.
- Pool subprocesses are initialised once on startup; each execution checks one out, uses it, and discards it. The pool replenishes itself after every checkout so idle capacity is maintained.
- Redis session metadata allows TTL-based expiry and explicit cleanup on shutdown for bridge RPC calls.
- The worker fetches the script by `scriptId` at execution time and rebuilds host-function descriptors from the stored `metadata`, so any worker instance can reconstruct them without descriptor serialisation in the job payload.
- Scripts are stored in the database, referenced by `scriptId` at enqueue time.

## Host functions

- `httpCall` performs outbound HTTP requests.
- `appApiCall` executes authenticated in-process requests against app-owned routes mounted on `baseApp`.
- `getCachedValue` and `setCachedValue` provide script-scoped cache access.
- `getAppConfigValue` reads server configuration values exposed to sandbox scripts.
- `getUserPreferences` reads the current user's stored preferences.

`allowedHostFunctions` is authoritative. Scripts with no `allowedHostFunctions` entry receive no host functions.

## Adding a new host function

1. Implement the host function with the signature `(context, ...args) => Promise<unknown>`.
2. Register it in `hostFunctionRegistry` in `function-registry.ts`.
3. Add a case for it in `buildFunctionContext` in `function-registry.ts` to bind the appropriate per-execution context (e.g. `userId`, `scriptId`).

For stateless functions use an empty context object. For stateful functions, bind per-execution data (such as `userId` or `scriptId`) into the context object inside `buildFunctionContext`.

`appApiCall` is stateful and binds the executing `userId` into the descriptor context. It can target routes mounted on `baseApp`, but it rejects `/api/auth/*` and does not accept auth override headers such as `authorization`, `cookie`, or `x-api-key`.

## Driver functions

Driver functions are the only entry points in sandbox scripts. Every script must register at least one driver using `driver(name, fn)`, and the caller must supply a matching `driverName` when enqueueing.

A driver receives two arguments:

1. `context` — user-provided execution context containing input data (e.g., search query, page size)
2. `meta` — system-provided metadata object containing `{ sandboxScriptId: string }` when running from a stored script

```js
driver("search", async function (context, meta) {
	// meta.sandboxScriptId contains the script ID
	const response = await httpCall("GET", "https://api.example.com/search");
	return response;
});
```

## Error handling

Errors are caught at multiple layers and surfaced in the job result:

- **Host function errors**: Bridge catches exceptions and returns HTTP 500 `{ error }`. The runner stub re-throws so user code sees a normal JS error.
- **Script errors**: Runner wraps uncaught throws into `{ success: false, error }` on stdout.
- **Bridge validation**: Invalid token → 401, expired session → 410, unknown function → 404, bad body → 400.
- **Timeouts**: SIGTERM then SIGKILL. Result: `"Sandbox timed out after ${timeoutMs}ms"`.
- **Memory/import failures**: V8 heap limit or `--cached-only` rejection causes process exit; error surfaces in job result.
- **Invalid metadata**: Unknown function in `allowedHostFunctions` fails before sandbox starts.

## Debugging

- **Logs**: All console output is redirected to stderr and stored as the `logs` field in the job result.
- **Job status**: Poll `GET /sandbox/result/:jobId` → `pending`, `completed` (with `logs`, `value`, `error`, `timing`), or `failed`.
- **Timing**: `timing.totalMs` vs `timing.executionMs` distinguishes slow host functions from slow user code.
