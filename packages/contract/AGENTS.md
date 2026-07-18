# Contract Package Guidelines

This package owns the client-safe HTTP boundary: `AppContract`, Effect Schema payloads, shared errors, auth middleware, and wire-safe primitives. `app-backend` implements this contract; backend services and infrastructure stay in `apps/app-backend`.

- Never import backend code or runtime-only dependencies here, including through `import type`. This includes database, Redis, auth-server, Node, and Bun modules.
- Define shared boundary types here and import them from backend consumers, never the reverse.
- Adding an HTTP endpoint requires updating `src/contract.ts`, its contract module, and the matching backend module.
