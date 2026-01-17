# Sandbox subsystem

This folder implements the backend sandbox runtime used by `sandboxApi`.

The sandbox runs untrusted user code in single-use Deno subprocesses, exposes selected app capabilities through a localhost bridge, and keeps subprocess startup costs low with a pre-warmed pool.

## Components

- `service.ts`: builds execution payloads, registers bridge sessions, checks out Deno subprocesses, and returns sandbox results.
- `runtime.ts`: owns the Deno runner file, process pool, package cache, and bridge server.
- `runner-source.sandbox.js`: source executed by each Deno subprocess.
- `host-functions.ts`: app-bound bridge functions for user, entity, event, integration, query-engine, and config access.
- `shared.ts`: shared types and helpers for host-function implementations.
- Sandbox scripts and script-side helpers (`providers/`, `triggers/`, `script-helpers/`) live under `modules/builtins/sandbox-scripts/`, not here — this folder is only the execution runtime.

## Execution Flow

1. `POST /sandbox/scripts` accepts one TypeScript `source`, statically validates its manifest, type-checks and bundles it, then stores source and compiled JavaScript separately with compiled format `1`.
2. `POST /sandbox/enqueue` receives a `scriptId`, `driverName`, and optional `context`. The workflow loads compiled code and the capabilities from validated manifest metadata.
3. The service registers a bridge session keyed by `executionId`. Redis stores `{ token, expiresAt }` with a TTL, and memory stores the allowed host-function handlers for that run.
4. A pre-warmed Deno process is checked out, or a fresh one is spawned if the pool is empty. Each process handles exactly one execution.
5. The service writes one JSON payload to stdin containing compiled code, compiled format, driver name, context, bridge URL, token, function names, execution id, and script id.
6. The runner captures console calls into `logs`, imports the compiled in-memory ES module, validates the definition, driver, input, and output, and writes the final JSON result to stdout.
7. Host-function stubs call `POST /rpc/:executionId/:fnName`; the bridge validates expiry, bearer token, request body, and function name before dispatching.
8. The service adds server timing, removes the bridge session with an Effect finalizer, and returns the job result.

## API Shape

- `POST /sandbox/scripts`: creates a stored script with `{ source }`; name, slug, and capabilities come from the static manifest.
- `POST /sandbox/enqueue`: enqueues a stored script with `{ scriptId, driverName, context? }` and returns `{ jobId }`.
- `GET /sandbox/result/:jobId`: returns `pending`, `failed`, or `completed` with `{ logs, value, error, timing }`.

Generic scripts declare an exact manifest `capabilities` tuple. The SDK exposes only those methods on the driver's host parameter. `timing` is `{ totalMs, executionMs }` for completed runs.

## Security

- User code runs in a separate Deno process per execution.
- Deno denies subprocess, env, FFI, write, prompt, and remote module access.
- Deno can only read the generated runner file and call the localhost bridge port.
- Sandbox script network access must go through explicit host functions such as `httpCall`.
- App-side source connectors are outside the sandbox runtime and use app runtime HTTP helpers.
- Bridge calls require the per-execution bearer token and expire through Redis TTL.
- Timeouts invalidate the pooled process and kill it.
- Sandbox processes receive only `PATH` and `DENO_DIR`; user code cannot read env values because `--deny-env` is enabled.

## Process Pool

`ProcessPool` keeps `config.sandbox.workerConcurrency + 2` idle Deno subprocesses ready. A pooled process has loaded Deno and is blocked on stdin waiting for its payload. On checkout, the pool immediately starts a replacement in the background.

The pool preserves process isolation because every subprocess is still single-use. Reusing a process across executions would allow global state pollution and weaken per-process memory limits.

## Vendored Packages

Format-1 user modules can import only the SDK root and bundle its current runtime. Existing format-0 built-ins can dynamically import only packages listed in `vendoredPackages` in `runtime.ts`. At startup, `PackageCacheManager` runs `deno cache --no-config` into `SANDBOX_DENO_DIR` and records a marker file for the cached package list. Deno then runs with `--cached-only`, so imports outside the allowlist fail.

To add a package, append its specifier to `vendoredPackages` and restart the service. In Docker deployments, mount `SANDBOX_DENO_DIR` as a volume to avoid re-downloading packages on each restart.

## Host Functions

Host functions are bridge handlers exposed only when listed in format-1 manifest `capabilities` or temporary format-0 `metadata.allowedHostFunctions`. The backend intersects those declarations with its implementation registry, and the format-1 runner intersects the approved names with the compiled definition's manifest before constructing the driver host.

| Scope   | Functions                                                                                                                                                          |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Runtime | `httpCall`                                                                                                                                                         |
| Script  | `getAppConfigValue`, `getCachedValue`, `setCachedValue`, `claimCachedValue`                                                                                        |
| User    | `createEvents`, `executeQueryEngine`, `getEntity`, `getEntitySchema`, `getIntegration`, `getUserPreferences`, `listEventSchemas`, `listEvents`, `listIntegrations` |

Script-scoped functions use execution metadata such as `scriptId`. User-scoped functions require `userId` and are unavailable for system executions. `claimCachedValue` atomically writes a script-scoped cached value only when the key does not already exist.

`getCachedValue` and `setCachedValue` are scoped to the current server run, so their values are refreshed after a backend restart. `claimCachedValue` remains persistent across restarts.

### Adding A Host Function

1. Define the script-facing schema and method in `@ryot/sandbox-sdk`.
2. Implement the context-first method in the typed backend registry in `service.ts` or `host-functions.ts`.
3. Decode its untrusted RPC argument array in `bridge-adapter.ts`; implementation functions must not accept unknown argument arrays.
4. Use `requireUserSandboxRunInput(input, fnName)` for user-scoped functions.
5. Add the function name to this section and to any temporary format-0 script metadata that should be allowed to call it.

## Driver Functions

Format-1 scripts define drivers with SDK input and output schemas. The enqueue request chooses a driver by name; the runner validates input before invoking `run` and output before returning it.

```ts
const main = defineDriver(manifest, {
	input: z.object({ value: z.number() }),
	output: z.number(),
	run: async (input) => input.value + 1,
});

export default defineScript({ manifest, drivers: { main } });
```

The SDK run function receives `(input, host, execution)`. `execution` contains `{ metadata, sandboxScriptId }`. Temporary format-0 built-ins continue to register legacy `driver(name, fn)` functions inside their compatibility module.

## Errors And Debugging

- Host-function exceptions are returned by the bridge and re-thrown by the runner stub.
- Script exceptions produce `{ success: false, error }` in the sandbox result.
- Bridge validation returns 400 for bad body, 401 for invalid token, 404 for unknown function, and 410 for expired session.
- Timeout, memory, and import failures surface as job errors.
- Console calls are captured in the completed result's `logs` field.
