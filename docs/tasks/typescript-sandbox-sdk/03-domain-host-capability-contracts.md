# Domain Host Capability Contracts

**Parent Plan:** [TypeScript Sandbox SDK and Compilation](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Complete the typed host surface after Tasks 01 and 02 by implementing `getEntity`, `getEntitySchema`, `getIntegration`, `listEventSchemas`, `listEvents`, `listIntegrations`, `createEvents`, and `executeQueryEngine` across the SDK, backend host implementation map, bridge, Deno host object, and test support. Follow the Host Contract and Driver Contracts sections of the parent plan.

Define SDK-owned serialized schemas for fixed-shape host responses and constrain backend encoders or returned values to those types. Keep dynamic query-engine output unknown and require script-side parsing. Preserve all existing user-scope authorization, entity readability, integration ownership, event creation, filtering, durable side effects, and query validation. Do not move backend Effect schemas or domain logic into the SDK, and do not introduce unsafe generic return types for arbitrary properties or query results.

## Acceptance criteria

- [ ] The SDK exposes typed contracts for all eight domain host methods named in this slice
- [ ] Fixed-shape entity, schema, integration, event-schema, event, integration-list, and event-creation data use SDK-owned serialized schemas
- [ ] Query-engine input uses the public query document shape and query output remains unknown until script-owned validation
- [ ] Backend implementations satisfy the completed SDK host map before dynamic bridge erasure
- [ ] Capability narrowing applies to every domain host method at compile time and runtime
- [ ] Existing user-scope, ownership, readability, filtering, and event-creation behavior remains unchanged
- [ ] Host arguments are validated at the backend trust boundary even when compiled TypeScript used the correct static type
- [ ] Focused tests cover successful and failed entity, schema, integration, event, and query calls
- [ ] Security tests prove another user cannot broaden access through the typed SDK
- [ ] Type fixtures prove dynamic values remain unknown and require runtime parsing
- [ ] Backend check and tests pass

## User stories addressed

- User story 7
- User story 8
- User story 10
- User story 21
- User story 29
