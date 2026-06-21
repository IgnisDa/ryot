# Domain Host Capability Contracts

**Parent Plan:** [TypeScript Sandbox SDK and Compilation](./README.md)

**Type:** AFK

**Status:** done

## What to build

Complete the typed host surface after Tasks 01 and 02 by implementing `getEntity`, `getEntitySchema`, `getIntegration`, `listEventSchemas`, `listEvents`, `listIntegrations`, `createEvents`, and `executeQueryEngine` across the SDK, backend host implementation map, bridge, Deno host object, and test support. Follow the Host Contract and Driver Contracts sections of the parent plan.

Define SDK-owned serialized schemas for fixed-shape host responses and constrain backend encoders or returned values to those types. Keep dynamic query-engine output unknown and require script-side parsing. Preserve all existing user-scope authorization, entity readability, integration ownership, event creation, filtering, durable side effects, and query validation. Do not move backend Effect schemas or domain logic into the SDK, and do not introduce unsafe generic return types for arbitrary properties or query results.

## Acceptance criteria

- [x] The SDK exposes typed contracts for all eight domain host methods named in this slice
- [x] Fixed-shape entity, schema, integration, event-schema, event, integration-list, and event-creation data use SDK-owned serialized schemas
- [x] Query-engine input uses the public query document shape and query output remains unknown until script-owned validation
- [x] Backend implementations satisfy the completed SDK host map before dynamic bridge erasure
- [x] Capability narrowing applies to every domain host method at compile time and runtime
- [x] Existing user-scope, ownership, readability, filtering, and event-creation behavior remains unchanged
- [x] Host arguments are validated at the backend trust boundary even when compiled TypeScript used the correct static type
- [x] Focused tests cover successful and failed entity, schema, integration, event, and query calls
- [x] Security tests prove another user cannot broaden access through the typed SDK
- [x] Type fixtures prove dynamic values remain unknown and require runtime parsing
- [x] Backend check and tests pass

## Implementation notes

- The SDK now owns a domain capability tuple (`DOMAIN_SANDBOX_HOST_CAPABILITIES`), per-method Zod arg/result schemas, a `DomainSandboxHostMethodMap`, and a `DomainSandboxHostImplementationMap<Context>`. `SANDBOX_HOST_CAPABILITIES`, `sandboxHostCapabilitySchema`, `SandboxHostMethodMap`, and `SandboxHostImplementationMap<Context>` merge the core and domain surfaces. `SandboxHost`, `GenericDriver`, and the manifest `capabilities` schema were widened to the full capability set, so declared domain capabilities narrow the driver host at compile time exactly like core capabilities.
- Fixed-shape top-level fields (identifiers, timestamps, `provider`/`lot` enums, `extraSettings`, `providers`, counts) are modeled precisely in SDK Zod. The JSON "bag" fields that repositories return as `Record<string, unknown>` / `AppSchema` / a provider-specifics union — entity and event `properties`, entity-schema and event-schema `propertiesSchema`, and integration `providerSpecifics` — are typed as the SDK's checked `jsonValueSchema` (never `unknown`, never generic) and coerced at the backend trust boundary through a new `toSandboxJsonValue` helper. This is the one place where those values become statically `JsonValue`; the values are already JSON at runtime (jsonb / decoded stored JSON), so the coercion is behavior-preserving.
- Backend `shared.ts` now consumes the SDK `SandboxHostImplementationMap<SandboxRunInput>` directly; the hand-written untyped domain map was removed. `#modules/sandbox/capabilities` re-exports the SDK `SANDBOX_HOST_CAPABILITIES` so the approved-capability name list has a single source of truth. `host-functions.ts` continues to satisfy the map via `satisfies AdditionalSandboxHostImplementationMap`.
- The bridge adapter is the sole place where untrusted RPC argument arrays become typed calls. String-identifier methods and `executeQueryEngine` use `typeof`/`isJsonValue` narrowing (matching Task 02 core style); the object- and array-shaped domain args (`listEvents`, `listIntegrations`, `createEvents`) are validated against the SDK Zod arg schemas via `safeParse`. Using the SDK's own schemas at this SDK↔backend boundary avoids re-modeling the contract in Effect and keeps argument shapes from drifting; the backend host functions still Effect-decode to branded identifiers, so user-scope and ownership checks are unchanged.

### Deviations

- **Query document input is `jsonValueSchema`, not a full Zod re-model of the query language.** The Effect `QueryDocument` schema is ~300 lines of deeply recursive definitions owned by `@ryot/contract`; re-declaring it in the runtime-neutral SDK would be disproportionate for this slice and a large drift surface. The backend Effect `QueryDocument` remains the authoritative decoder, and the query result stays `unknown` as the plan requires. A precise SDK query-document builder can be added later without changing this contract.
- **Cross-user access is proven at this task's layer, not end-to-end.** The bridge-adapter tests show domain calls always dispatch with the server-provided `SandboxRunInput` regardless of arguments, and the type fixtures show no host method accepts a `userId`. Full cross-user database enforcement (owner-scoped repositories) is exercised by the end-to-end suite in Task 08.

## User stories addressed

- User story 7
- User story 8
- User story 10
- User story 21
- User story 29
