# Backend SDK

Rationale lives in `README.md`.

- `core.ts` and `workflow.ts` are aggregation points for `./core` and `./workflow`. Definitions live in `src/core/` and `src/workflow/`; internal modules import from defining modules, never from these entries.
- The backend compiler recognizes host operations by their declaration in `src/core/host-contracts.ts`; keep the host contract maps there.
