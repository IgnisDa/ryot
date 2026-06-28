# Core Host Capability Contracts

**Parent Plan:** [TypeScript Sandbox SDK and Compilation](./README.md)

**Type:** AFK

**Status:** done

## What to build

Extend the tracer from Task 01 with the first typed, capability-filtered host surface from the Host Contract section of the parent plan. Implement `httpCall`, `getCachedValue`, `setCachedValue`, `claimCachedValue`, `getAppConfigValue`, and `getUserPreferences` in the SDK contract, backend implementation map, bridge adapter, Deno host object, SDK test support, and focused execution coverage.

The manifest's exact capability tuple must determine the host methods visible to driver code. A declared method must type-check and execute; an undeclared method must fail TypeScript compilation and must not be present at runtime. Preserve discriminated success/failure results and existing cache partition, cache persistence, sensitive-configuration, HTTP, and normalized-preference behavior. Add the SDK unwrap helper without changing the default explicit result semantics. Resource byte limits and host-call budgets belong to Task 05; this task establishes typed behavior and authority, not final limit enforcement.

## Acceptance criteria

- [x] The SDK exposes typed contracts for all six core host methods named in this slice
- [x] Driver host types include exactly the capabilities declared in the static manifest
- [x] Undeclared core host usage fails user compilation with an actionable diagnostic
- [x] The backend core host registry satisfies the SDK implementation map before conversion to dynamic RPC handlers
- [x] Unknown argument arrays remain confined to the final bridge dispatch boundary
- [x] Deno receives only declared and server-approved core host stubs
- [x] Host success and failure envelopes preserve current behavior, including HTTP status failure details
- [x] The SDK unwrap helper returns success data and throws the host failure message
- [x] User scripts cannot read sensitive application configuration, while built-in policy remains unchanged
- [x] Cache round trips, cache misses, script isolation, persistent claims, HTTP calls, configuration reads, and normalized user preferences have focused tests using TypeScript definitions
- [x] SDK type fixtures prove capability narrowing and argument/result inference
- [x] Backend check and tests pass

## Implementation notes

- Core argument and result types are inferred from SDK-owned Zod schemas. `SandboxHost` selects methods from the manifest's literal capability tuple, and `CoreSandboxHostImplementationMap` applies the same contract to backend implementations.
- `@ryot/sandbox-sdk/testing` provides capability-checked test hosts and validated driver invocation. A dedicated type-fixture project checks negative capability and argument cases without adding Bun types or tests to the runtime-neutral SDK build.
- The user compiler requires static manifests without widening assertions, canonical `defineDriver(manifest, ...)` declarations, and a statically inspectable `defineScript` driver record. This prevents a second or widened manifest from granting compile-time host methods that the persisted manifest does not declare.
- Backend implementations now receive typed arguments and execution context directly. Untrusted argument arrays exist only in `bridge-adapter.ts`, which converts final RPC dispatch into the typed registry. Domain method values remain `unknown` until Task 03 adds their SDK schemas, but they no longer receive unknown argument arrays.
- The Deno runner constructs a null-prototype format-1 host from persisted declarations and server-approved function names before importing untrusted code. Captured bridge primitives prevent module-level global mutation from redirecting an approved stub. Format-0 built-ins retain their existing approved-function behavior during the incremental migration.
- The temporary Task 01 E2E compatibility adapter now emits top-level canonical driver constants so it conforms to the hardened compiler policy. It still wraps the same legacy JavaScript fixtures; their typed replacement remains Task 08.
- The backend Vitest default timeout is 20 seconds so Deno subprocess integration tests remain reliable when the full suite runs concurrently. Sandbox execution timeouts are unchanged.

## User stories addressed

- User story 7
- User story 8
- User story 9
- User story 10
- User story 21
- User story 29
