# Diagnostics and Resource Limits

**Parent Plan:** [TypeScript Sandbox SDK and Compilation](./README.md)

**Type:** AFK

**Status:** done

## What to build

Complete the safety and observability behavior in the Diagnostics and Runtime Errors and Resource Limits sections. Apply the agreed limits at compilation, persistence, queue input, Deno execution, bridge calls, upstream HTTP streaming, logs, results, and cache boundaries. Return deterministic structured compilation and execution errors with source-mapped TypeScript locations.

Run user compilation outside the main backend process with five-second timeout, two-compilation concurrency, bounded diagnostics, and production memory supervision. Preserve the existing ten-second execution timeout and worker concurrency while adding the Deno heap bound. Limit logs by truncating once with a marker; reject oversized output as an output-phase error. Count all bridge and HTTP calls, including failures. Enforce response limits while streaming rather than after unbounded buffering. Centralize byte measurement and limit decisions so tests exercise the same values used in production.

## Acceptance criteria

- [x] All numeric limits and behaviors in the parent PRD's Resource Limits section are implemented centrally
- [x] UTF-8 byte length, not JavaScript character count, governs source, manifest, diagnostics, context, payload, logs, results, cache, and body limits
- [x] User compilation runs outside the main process with five-second timeout and at most two concurrent compilations
- [x] Production configuration or supervision documents and enforces the 256 MiB compiler memory budget
- [x] Compilation diagnostics contain logical file, one-based line and column, optional length, code, severity, and message and obey entry/byte caps
- [x] Deno execution uses the existing timeout plus a 256 MiB V8 heap limit
- [x] Runner request, bridge request/response, driver context, host-call, and HTTP-call budgets fail deterministically
- [x] HTTP response limits are enforced during streaming and oversized responses return host failures
- [x] Logs enforce per-entry, entry-count, and total-byte limits with exactly one truncation marker and no execution failure solely from truncation
- [x] Oversized final output produces an output-phase error and no partial value
- [x] Cache key, value, and TTL limits apply to get, set, and claim paths as relevant
- [x] Runtime errors distinguish load, input, execute, and output phases and map locations back to TypeScript while sanitizing internals and credentials
- [x] Sandbox result contracts and internal consumers use structured execution errors rather than nullable error strings
- [x] Focused boundary tests cover every agreed limit and both ASCII and multi-byte input
- [x] Check, tests, and build pass

## Implementation notes

- `@ryot/sandbox-compiler/limits` owns compiler limits and UTF-8 measurement; `sandbox-runtime/limits.ts` composes them with cache, context, request, host-call, bridge, HTTP, log, and result limits.
- `@ryot/sandbox-compiler` owns the worker, compilation pipeline, diagnostics, and process protocol. Backend `SandboxCompiler` starts its one-shot Bun artifact behind a two-permit semaphore. The five-second timeout includes process startup, native TypeScript checking, manifest extraction, bundling, response encoding, and shutdown; cancellation kills the complete process group.
- The production image builds and executes a smoke test against `compiler-worker.js` beside `main.js`. Linux production supervision samples proportional set size for the worker and its TypeScript descendants every five milliseconds and kills the process group above 256 MiB. This avoids shared-page double-counting but is sampled process supervision rather than a cgroup hard ceiling because the existing unprivileged single-container deployment cannot create delegated cgroups; non-Linux development does not claim a portable memory ceiling.
- The Deno runner receives its limits in the trusted backend request, enforces call, bridge, log, and result budgets before returning data, and runs with a 256 MiB V8 old-space limit. The backend independently enforces bridge and HTTP limits so persisted metadata or runner changes cannot bypass authority.
- Runtime stacks rely on Deno's native consumption of Bun's inline source maps. Returned stacks are rebuilt only from mapped `sandbox-user:script.ts` frames, which preserves authored locations without returning data URLs, runner/dependency paths, bridge URLs, execution identifiers, or bearer tokens.
- Bounded logging, streamed bridge reads, and error normalization live in `runner-utilities.sandbox.js` so both trusted runner files stay below the repository's 500-line limit. This is a runtime module import, not source-fragment concatenation.
- Temporary format `0` scripts receive the same structured phases and resource limits but have no authored TypeScript source map, so their error locations remain absent.

## User stories addressed

- User story 13
- User story 15
- User story 16
- User story 19
- User story 20
- User story 21
- User story 22
- User story 23
- User story 24
- User story 25
- User story 26
