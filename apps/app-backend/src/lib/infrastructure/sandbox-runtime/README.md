# Sandbox subsystem

This folder implements the backend sandbox runtime used by `sandboxApi`.

The sandbox runs untrusted user code in single-use Deno subprocesses, exposes selected app capabilities through a localhost bridge, and keeps subprocess startup costs low with a pre-warmed pool.

## Components

- `service.ts`: builds execution payloads, registers bridge sessions, checks out Deno subprocesses, and returns sandbox results.
- `runtime.ts`: owns the Deno runner file, process pool, package cache, and bridge server.
- `runner-source.sandbox.js`: source executed by each Deno subprocess.
- `host-functions.ts`: app-bound bridge functions for user, entity, event, integration, query-engine, and config access.
- `app-config.ts`: validates and resolves allowlisted application configuration values.
- `cache-host-functions.ts`: owns the persistent script-scoped `claimCachedValue` bridge function.
- `notification-host-functions.ts`: owns subscription-only notification delivery effects.
- `effect-ledger.ts`: shares effect reservation and completion mechanics across effectful host functions.
- `serialization-bounds.ts`: bounds sandbox result, error, and log artifacts before persistence.
- `shared.ts`: shared types and helpers for host-function implementations.
- Sandbox scripts and script-side helpers (`automations/`, `providers/`, `triggers/`, `script-helpers/`) live under `modules/builtins/sandbox-scripts/`, not here — this folder is only the execution runtime.

## Execution Flow

1. A script is stored via `POST /sandbox/scripts` and enqueued via `POST /sandbox/enqueue` with a `scriptId`, `driverName`, and optional `context`.
2. `RunSandboxWorkflow` processes `SandboxExecutionQueue` with the server-set `direct` execution kind. Internal callers use the same queue with `policy`, `provider`, or `subscription`.
3. The queue worker loads the script, intersects `metadata.allowedHostFunctions` with the execution-kind and optional per-run capability ceilings, then calls `SandboxService.run(...)`.
4. The service registers a bridge session keyed by `executionId`. Redis stores `{ token, expiresAt }` with a TTL, and memory stores the effective host-function handlers for that run.
5. A pre-warmed Deno process is checked out, or a fresh one is spawned if the pool is empty. Each process handles exactly one execution.
6. The service writes one JSON payload to stdin containing the script code, driver name, context, bridge URL, token, function names, execution id, and script id.
7. The runner captures console calls into `logs`, creates host-function stubs, runs the requested `driver(name, fn)`, and writes the final JSON result to stdout.
8. Host-function stubs call `POST /rpc/:executionId/:fnName`; the bridge validates expiry, bearer token, request body, and function name before dispatching.
9. The service adds server timing, removes the bridge session with an Effect finalizer, and returns the bounded job result.

## API Shape

- `POST /sandbox/scripts`: creates a stored script with `{ name, slug?, code, metadata? }`.
- `POST /sandbox/enqueue`: enqueues a stored script with `{ scriptId, driverName, context? }` and returns `{ jobId }`.
- `GET /sandbox/result/:jobId`: returns `pending`, `failed`, or `completed` with `{ logs, value, error, timing }`.

`metadata.allowedHostFunctions` defaults to no host functions when omitted. `timing` is `{ totalMs, executionMs }` for completed runs.

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

User scripts can dynamically import only packages listed in `vendoredPackages` in `runtime.ts`. At startup, `PackageCacheManager` runs `deno cache --no-config` into `SANDBOX_DENO_DIR` and records a marker file for the cached package list. Deno then runs with `--cached-only`, so imports outside the allowlist fail.

To add a package, append its specifier to `vendoredPackages` and restart the service. In Docker deployments, mount `SANDBOX_DENO_DIR` as a volume to avoid re-downloading packages on each restart.

## Host Functions

Host functions are bridge handlers exposed only when listed in `metadata.allowedHostFunctions`.

| Scope      | Functions                                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Runtime    | `httpCall`                                                                                                                                                         |
| Script     | `getAppConfigValue`, `getCachedValue`, `setCachedValue`, `claimCachedValue`                                                                                        |
| User       | `createEvents`, `executeQueryEngine`, `getEntity`, `getEntitySchema`, `getIntegration`, `getUserPreferences`, `listEventSchemas`, `listEvents`, `listIntegrations` |
| Automation | `emitSignal`, `sendNotification`                                                                                                                                   |

Script-scoped functions use execution metadata such as `scriptId`. User-scoped functions require `userId` and are unavailable for system executions. `claimCachedValue` atomically writes a script-scoped cached value only when the key does not already exist.

The script allowlist is only the first capability boundary. `emitSignal` and `sendNotification`
are available only to `subscription` executions with an automation run; `createEvents` is available
to direct and subscription executions; policy and provider executions receive neither automation
effects nor event creation. Subscription runs apply the rule snapshot's capability ceiling as a
third intersection and ledger every effect by `effectKey`.

`getCachedValue` and `setCachedValue` are scoped to the current server run, so their values are refreshed after a backend restart. `claimCachedValue` remains persistent across restarts.

### Adding A Host Function

1. Implement the bridge handler as `(...args) => Promise<unknown>` in the owning module: `service.ts` for core runtime functions, `host-functions.ts` for app-bound reads and event creation, `cache-host-functions.ts` for persistent cache claims, or `notification-host-functions.ts` for notification effects.
2. Use `requireSandboxRunInput(args, expectedArgCount, fnName)` for script-scoped functions.
3. Use `requireUserSandboxRunInput(args, expectedArgCount, fnName)` for user-scoped functions.
4. Add the function name to this section and to any script metadata that should be allowed to call it.

## Driver Functions

Sandbox scripts must register at least one driver with `driver(name, fn)`. The enqueue request chooses which driver to run with `driverName`.

Drivers receive `(context, meta)`. `context` is caller-provided input. `meta` includes `{ metadata, sandboxScriptId }` when running from a stored script.

```js
driver("search", async function (context, meta) {
	const response = await httpCall("GET", "https://api.example.com/search");
	return { response, scriptId: meta.sandboxScriptId };
});
```

## Errors And Debugging

- Host-function exceptions are returned by the bridge and re-thrown by the runner stub.
- Script exceptions produce `{ success: false, error }` in the sandbox result.
- Bridge validation returns 400 for bad body, 401 for invalid token, 404 for unknown function, and 410 for expired session.
- Timeout, memory, and import failures surface as job errors.
- Console calls are captured in the completed result's `logs` field.
