# Sandbox subsystem

This folder implements the backend sandbox runtime used by `sandboxApi`.

The model is:

- Run untrusted user code in a fresh Deno subprocess per execution.
- Keep a long-lived localhost bridge server in the backend process.
- Expose selected host functions (for example `addNumbers`, `httpCall`) to user code through bridge RPC calls.

## Main components

- `index.ts`: singleton lifecycle helpers (`initializeSandboxService`, `getSandboxService`, `shutdownSandboxService`).
- `service.ts`: orchestration for startup/shutdown and per-run execution.
- `bridge.ts`: localhost RPC bridge (`POST /rpc/:executionId/:fnName`) + session validation.
- `runner.ts`: manages the temporary runner file on disk.
- `runner-source.txt`: source code executed by Deno for each run.
- `constants.ts`: default limits and guardrail values.
- `utils.ts`: process and stream helpers (`waitForExit`, timeout guard, JSON response helpers).
- `types.ts`: public sandbox option/result types.

## How one execution works

1. `SandboxService.run(...)` receives `{ code, context, apiFunctions, timeoutMs, maxHeapMB }`.
   - `httpCall` is always injected as a default host function.
   - Any functions passed in `apiFunctions` are merged on top.
2. The service creates a unique `executionId` and one-time bearer token.
3. The bridge session is registered:
   - Redis stores `{ token, expiresAt }` under `sandbox:session:<executionId>` with TTL.
   - In-memory map stores `apiFunctions` for that execution.
4. A Deno subprocess is spawned with restricted permissions.
5. The service sends one JSON payload over stdin (`code`, `context`, bridge URL, token, function names, execution id).
6. Inside Deno (`runner-source.txt`):
   - payload is parsed,
   - `console.*` is redirected to stderr,
   - host-function stubs are created so user code can call `await someHostFn(...)`,
   - user code runs in an async wrapper,
   - final result is written as JSON to stdout.
7. Bridge calls from stubs hit `POST /rpc/:executionId/:fnName`:
   - execution and expiry are checked,
   - bearer token is validated,
   - body is parsed (`{ args: [...] }`),
   - mapped host function is executed,
   - `{ result }` or `{ error }` is returned.
8. The service collects:
   - `stdout` -> final sandbox result JSON,
   - `stderr` -> `logs`.
9. Session is removed in `finally`.

## Security and isolation

- **Process isolation:** user code runs in a separate Deno process per execution.
- **Deno restrictions:**
  - denied: `--deny-run`, `--deny-env`, `--deny-ffi`, `--deny-write`
  - allowed: `--allow-read=<runner-file>`, `--allow-net=127.0.0.1:<bridge-port>`
- **Network boundary:** sandbox can only talk to the local bridge; external network access must go through explicit host functions.
- **Auth boundary:** each execution has a random bearer token checked by bridge routes.
- **Timeout enforcement:** timeout guard sends `SIGTERM`, then `SIGKILL` after a short delay.
- **Memory limit:** Deno runs with `--v8-flags=--max-heap-size=<maxHeapMB>`.
- **Input limit:** bridge request body is capped (`requestBodyLimit`, currently 128 KB).
- **Environment leakage:** sandbox process only receives a minimal env (`PATH`).

## Runtime behavior notes

- The bridge server and runner file are created once on service startup and reused.
- Deno subprocesses are still per-run, which keeps run isolation while avoiding bridge re-creation overhead.
- Redis session metadata allows TTL-based expiry and explicit cleanup on shutdown.

## Adding a new host function

In the route that calls `sandbox.run`, add to `apiFunctions`:

```ts
const result = await sandbox.run({
  code,
  context: {},
  timeoutMs: 10_000,
  maxHeapMB: 64,
  apiFunctions: {
    myHostFn: async (arg1, arg2) => {
      return { ok: true };
    },
  },
});
```

User code can then call:

```js
const response = await myHostFn("a", "b");
return response;
```
