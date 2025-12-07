# Diagnostics and Resource Limits

**Parent Plan:** [TypeScript Sandbox SDK and Compilation](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Complete the safety and observability behavior in the Diagnostics and Runtime Errors and Resource Limits sections. Apply the agreed limits at compilation, persistence, queue input, Deno execution, bridge calls, upstream HTTP streaming, logs, results, and cache boundaries. Return deterministic structured compilation and execution errors with source-mapped TypeScript locations.

Run user compilation outside the main backend process with five-second timeout, two-compilation concurrency, bounded diagnostics, and production memory supervision. Preserve the existing ten-second execution timeout and worker concurrency while adding the Deno heap bound. Limit logs by truncating once with a marker; reject oversized output as an output-phase error. Count all bridge and HTTP calls, including failures. Enforce response limits while streaming rather than after unbounded buffering. Centralize byte measurement and limit decisions so tests exercise the same values used in production.

## Acceptance criteria

- [ ] All numeric limits and behaviors in the parent PRD's Resource Limits section are implemented centrally
- [ ] UTF-8 byte length, not JavaScript character count, governs source, manifest, diagnostics, context, payload, logs, results, cache, and body limits
- [ ] User compilation runs outside the main process with five-second timeout and at most two concurrent compilations
- [ ] Production configuration or supervision documents and enforces the 256 MiB compiler memory budget
- [ ] Compilation diagnostics contain logical file, one-based line and column, optional length, code, severity, and message and obey entry/byte caps
- [ ] Deno execution uses the existing timeout plus a 256 MiB V8 heap limit
- [ ] Runner request, bridge request/response, driver context, host-call, and HTTP-call budgets fail deterministically
- [ ] HTTP response limits are enforced during streaming and oversized responses return host failures
- [ ] Logs enforce per-entry, entry-count, and total-byte limits with exactly one truncation marker and no execution failure solely from truncation
- [ ] Oversized final output produces an output-phase error and no partial value
- [ ] Cache key, value, and TTL limits apply to get, set, and claim paths as relevant
- [ ] Runtime errors distinguish load, input, execute, and output phases and map locations back to TypeScript while sanitizing internals and credentials
- [ ] Sandbox result contracts and internal consumers use structured execution errors rather than nullable error strings
- [ ] Focused boundary tests cover every agreed limit and both ASCII and multi-byte input
- [ ] Check, tests, and build pass

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
