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

User compilation is implemented by the `@ryot/sandbox-compiler` workspace and runs in a one-shot Bun child process rather than the backend process. A two-permit semaphore bounds compilation concurrency, each process has a five-second wall-clock deadline, and timeout or cancellation kills its process group, including the native TypeScript child. Production runs on Linux, where the backend samples proportional memory across the compiler process tree and kills it above 256 MiB.

## API Shape

- `POST /sandbox/scripts`: creates a stored script with `{ source }`; name, slug, and capabilities come from the static manifest.
- `POST /sandbox/enqueue`: enqueues a stored script with `{ scriptId, driverName, context? }` and returns `{ jobId }`.
- `GET /sandbox/result/:jobId`: returns `pending`, `failed`, or `completed` with `{ logs, value, error, timing }`.

Generic scripts declare an exact manifest `capabilities` tuple. The SDK exposes only those methods on the driver's host parameter. `timing` is `{ totalMs, executionMs }` for completed runs.

## Security

- User code runs in a separate Deno process per execution.
- Deno denies subprocess, env, FFI, write, prompt, npm, and remote module access and ignores ambient config and lock files.
- Format-1 execution hides the `Deno` global and disables string code-generation constructors, `eval`, and workers before importing user code.
- Deno can only read the generated runner file, the read-only dependency runtime, and call the localhost bridge port.
- Sandbox script network access must go through explicit host functions such as `httpCall`.
- App-side source connectors are outside the sandbox runtime and use app runtime HTTP helpers.
- Bridge calls require the per-execution bearer token and expire through Redis TTL.
- Timeouts invalidate the pooled process and kill it.
- Each Deno process starts with a 256 MiB V8 old-space limit.
- Sandbox processes receive only `PATH` and `DENO_DIR`; user code cannot read env values because `--deny-env` is enabled.

## Process Pool

`ProcessPool` keeps `config.sandbox.workerConcurrency + 2` idle Deno subprocesses ready. A pooled process has loaded Deno and is blocked on stdin waiting for its payload. On checkout, the pool immediately starts a replacement in the background.

The pool preserves process isolation because every subprocess is still single-use. Reusing a process across executions would allow global state pollution and weaken per-process memory limits.

## Approved Dependencies

Format-1 user modules can import the SDK root plus the explicit `/zod`, `/dayjs`, `/dayjs/custom-parse-format`, `/cheerio`, and `/youtubei` entry points. The compiler bundles the small SDK definition runtime into each script and leaves approved dependency imports external.

`PackageCacheManager` builds the exact pinned package versions into self-contained ESM files under an immutable, content-addressed, read-only directory in `SANDBOX_DENO_DIR`. Its Deno import map resolves approved SDK imports to those local files. A separate content-addressed Deno cache starts without registry packages. Concurrent builders publish atomically and reuse the same verified module set.

Temporary format-0 compilation rewrites the built-ins' existing `npm:` dependency strings to the corresponding approved SDK paths. The runtime's `/youtubei` module uses youtubei.js's Deno/server platform, and the explicit Day.js plugin path preserves existing custom-parse-format imports during incremental migration.

Deno receives the import map and runs with `--cached-only`, `--no-npm`, `--no-remote`, `--no-config`, and `--no-lock`; execution never resolves a registry, npm cache, ambient project configuration, or remote URL. Updating an approved package changes the generated content hash automatically; the manual runtime format is reserved for incompatible loader-policy changes.

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
import { defineDriver, defineScript } from "@ryot/sandbox-sdk";
import * as z from "@ryot/sandbox-sdk/zod";

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
- Completed user-code failures contain a structured error with a `load`, `input`, `execute`, or `output` phase, message, optional mapped `script.ts` line and column, and an allowlisted source stack.
- Returned stacks contain only mapped `script.ts` frames. Data URLs, runner and dependency paths, bridge URLs, execution identifiers, and bearer tokens are removed.
- Bridge validation returns 400 for bad body, 401 for invalid token, 404 for unknown function, and 410 for expired session.
- Timeout and process termination remain workflow-level job failures; module import failures are completed results in the `load` phase.
- Console calls are captured in the completed result's `logs` field. Oversized logs append one `[sandbox logs truncated]` marker and do not fail execution.
- An oversized final value is rejected as an `output`-phase error and is never returned partially.

## Resource Limits

`@ryot/sandbox-compiler/limits` owns compiler limits and UTF-8 measurement. `limits.ts` composes those values with the execution, bridge, HTTP, log, result, and cache limits used by the backend. Limits are fixed in this phase rather than exposed as environment settings.

| Boundary                                              | Limit                         |
| ----------------------------------------------------- | ----------------------------- |
| TypeScript source / static manifest / compiled module | 256 KiB / 16 KiB / 1 MiB      |
| Compiler concurrency / time / process-tree memory     | 2 / 5 seconds / 256 MiB       |
| Driver context / runner request / final result        | 256 KiB / 2 MiB / 1 MiB       |
| Bridge request / response                             | 1 MiB / 10 MiB                |
| Host calls / `httpCall` calls per execution           | 200 / 50                      |
| HTTP request / streamed response body                 | 1 MiB / 10 MiB                |
| Log entry / count / total                             | 8 KiB / 500 / 256 KiB         |
| Cache key / value / TTL                               | 256 bytes / 256 KiB / 30 days |

The compiler supervisor samples proportional set size for the Bun worker and its TypeScript descendants in the Linux production image. This avoids double-counting shared pages but is a sampled process supervisor, not a cgroup hard ceiling. Non-Linux development retains the process, timeout, and concurrency boundaries without claiming a portable memory ceiling; Bun's `--smol` flag reduces baseline memory but is not treated as enforcement.
