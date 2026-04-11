# Entity Interest Infrastructure

Status: Implemented in the working tree.

## Scope

- Backend entity-interest protocol, Redis membership, SSE delivery, reconciliation, localization, progression, reconnect catch-up, and cleanup.
- Client coordinator, owner routing, declaration retry, update batching, blocking, and consumer-owned hydration.
- Saved-view targeted hydration and structural refresh integration.

## Non-scope

- No new global entity cache or broad invalidation path.
- No process-affine routing requirement.
- No detail or recommendation consumer implementation; examples remain future guidance.

## Implementation Checklist

- [x] Stage 1 - Define the shared protocol, completion reasons, 500-ID limit, and Redis keys. Implemented.
- [x] Stage 2 - Add stream ownership, 15-minute TTL, five-minute renewal, callback-only local state, and normal/crash cleanup. Implemented.
- [x] Stage 3 - Add replacement generations, pending/watching state, register-before-reconcile, bounded reconciliation, and population-to-translation progression. Implemented.
- [x] Stage 4 - Add Redis Pub/Sub delivery, multi-instance fan-out, reconnect resubscription, and declaration catch-up. Implemented.
- [x] Stage 5 - Add the client coordinator, owner/entity index, single-flight 250 ms/25 batcher, blocking, and declaration retry. Implemented.
- [x] Stage 6 - Integrate saved-view discovery and targeted hydration without global invalidation. Implemented.

## Verification

| Command or review | Status |
| --- | --- |
| `git diff --check` | Passed |
| `bun turbo --filter=@ryot/app-backend check` | Passed |
| `bun turbo --filter=@ryot/app-backend test` | Passed |
| `bun turbo --filter=@ryot/app-client check` | Passed |
| `bun turbo --filter=@ryot/app-client test` | Passed |
| `bun turbo --filter=@ryot/ryotql-recipes check` | Passed |
| `bun turbo --filter=@ryot/ryotql-recipes test` | Passed |
| `bun turbo --filter=@ryot/contract check` | Passed |
| `bun turbo --filter=@ryot/contract test` | Passed |
| `bun turbo --filter=@ryot/tests check` | Passed |
| Affected entity-interest, entity-translation, and RyotQL localization E2E files | Passed |
| Final review | Passed after findings were fixed and re-reviewed |
| Manual browser verification | Pending: no persistent seeded development session with a deliberately slow RyotQL endpoint was available |
