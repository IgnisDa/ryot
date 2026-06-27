# Core Host Capability Contracts

**Parent Plan:** [TypeScript Sandbox SDK and Compilation](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Extend the tracer from Task 01 with the first typed, capability-filtered host surface from the Host Contract section of the parent plan. Implement `httpCall`, `getCachedValue`, `setCachedValue`, `claimCachedValue`, `getAppConfigValue`, and `getUserPreferences` in the SDK contract, backend implementation map, bridge adapter, Deno host object, SDK test support, and focused execution coverage.

The manifest's exact capability tuple must determine the host methods visible to driver code. A declared method must type-check and execute; an undeclared method must fail TypeScript compilation and must not be present at runtime. Preserve discriminated success/failure results and existing cache partition, cache persistence, sensitive-configuration, HTTP, and normalized-preference behavior. Add the SDK unwrap helper without changing the default explicit result semantics. Resource byte limits and host-call budgets belong to Task 05; this task establishes typed behavior and authority, not final limit enforcement.

## Acceptance criteria

- [ ] The SDK exposes typed contracts for all six core host methods named in this slice
- [ ] Driver host types include exactly the capabilities declared in the static manifest
- [ ] Undeclared core host usage fails user compilation with an actionable diagnostic
- [ ] The backend core host registry satisfies the SDK implementation map before conversion to dynamic RPC handlers
- [ ] Unknown argument arrays remain confined to the final bridge dispatch boundary
- [ ] Deno receives only declared and server-approved core host stubs
- [ ] Host success and failure envelopes preserve current behavior, including HTTP status failure details
- [ ] The SDK unwrap helper returns success data and throws the host failure message
- [ ] User scripts cannot read sensitive application configuration, while built-in policy remains unchanged
- [ ] Cache round trips, cache misses, script isolation, persistent claims, HTTP calls, configuration reads, and normalized user preferences have focused tests using TypeScript definitions
- [ ] SDK type fixtures prove capability narrowing and argument/result inference
- [ ] Backend check and tests pass

## User stories addressed

- User story 7
- User story 8
- User story 9
- User story 10
- User story 21
- User story 29
