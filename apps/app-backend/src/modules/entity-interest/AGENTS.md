# Entity Interest

- Read `README.md` before changing reconciliation, delivery, limits, or stream ownership.
- Keep registry map mutations inside `Effect.suspend`; effect construction must remain side-effect-free.
- Wire schemas and completion reasons live in `packages/contract/src/modules/entity-interest/messages.ts`; Redis infrastructure owns transport only.
- Thread any new completion reason through terminal mapping and both publisher workflows.
- Behavior changes must update `README.md`, `tests/src/fixtures/interest-sse.ts`, and the relevant entity-interest or translation-status e2e tests.
