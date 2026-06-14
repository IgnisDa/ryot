# TypeScript Script Execution Tracer

**Parent Plan:** [TypeScript Sandbox SDK and Compilation](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Implement the first complete user-authored TypeScript path described by the Public SDK Module, Static Manifest, Compiler Module, Compiled Module and Persistence, Script Creation API, and Deno Runtime sections of the parent plan. This slice must take one single-file generic SDK script with no host capabilities from authenticated creation through authoritative compilation, persistence, enqueueing, Deno ES-module loading, input/output validation, and completed-result polling.

Create the runtime-neutral `@ryot/sandbox-sdk` package with the minimum stable core needed for this path: JSON values, host-result foundations, static manifests, generic script definitions, generic drivers, Zod access, execution metadata, and explicit root exports. Implement the backend-owned compiler with an isolated user project, static manifest extraction, TypeScript diagnostics, import denial outside the SDK, one ESM output, and an inline source map. Introduce the separate source and compiled-code persistence fields plus internal compiled format `1`, and change script creation to accept only source while returning source and validated manifest data, never compiled code.

Replace function-body evaluation in the Deno runner with in-memory ESM import for compiled modules. The runner must reject an unsupported format, validate the default definition, validate input and output, and preserve the current queue, process isolation, authentication, timeout, and result timing. Add one end-to-end script proving a plain typed value can be created and executed, plus one creation failure proving invalid TypeScript produces a typed HTTP 400 and no script row. Later tasks add the complete host surface, approved external runtime modules, richer diagnostics, limits, provider helpers, and trigger helpers; do not preempt those slices with speculative APIs.

## Acceptance criteria

- [ ] `@ryot/sandbox-sdk` exists as a workspace package with runtime-neutral core definitions and explicit exports
- [ ] A generic single-file TypeScript script can declare a static literal manifest, input schema, output schema, and asynchronous driver
- [ ] User compilation type-checks in an isolated project, rejects non-SDK imports, extracts the manifest without executing source, and emits one ESM module with an inline source map
- [ ] Script persistence stores source, compiled code, compiled format, manifest metadata, name, and slug in the existing script row
- [ ] The creation payload contains only source, and the success response excludes compiled code
- [ ] Invalid TypeScript returns a typed HTTP 400 with at least one actionable diagnostic and creates no row
- [ ] The create service does not hold a database transaction or connection while compilation runs
- [ ] Enqueueing loads compiled code rather than source
- [ ] The Deno runner imports the compiled module as ESM without dynamic function construction and validates the requested driver, input, and output
- [ ] Existing process isolation, bridge authentication, timeout, timing, and one-process-per-execution behavior remain intact
- [ ] End-to-end coverage creates, enqueues, and polls a generic TypeScript script returning a plain value
- [ ] Backend check, test, and build commands pass for this vertical slice

## User stories addressed

- User story 1
- User story 2
- User story 6
- User story 12
- User story 14
- User story 17
- User story 18
- User story 27
- User story 28
- User story 30
- User story 37
- User story 38
- User story 40
