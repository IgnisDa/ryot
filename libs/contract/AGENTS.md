# Contract Package Guidelines

## Purpose

This package is the client-safe wire boundary consumed by `app-backend`, `app-client`, `website`, and `tests`. It holds the `AppContract` (`@effect/platform` `HttpApi`) assembly, the Effect Schema definitions for every HTTP group's payloads, shared errors, auth middleware, and brand/schema primitives — the parts of the backend's contract surface that are safe to load into a mobile bundle, a browser bundle, or a test harness.

`app-backend` is a consumer/implementor of this package, not its source of truth. Other backend modules (services, repositories, routes, db, redis, config) stay in `apps/app-backend` and are never moved here.

## The Boundary Rule

This package must never import `drizzle-orm`, `ioredis`, `pg`, `better-auth`, Node/Bun built-ins, or any `#lib/db` / `#lib/redis` / `#lib/config` / service / repository code from `app-backend` — not even as `import type`. TypeScript erases type-only imports, but that erasure is easy to lose (a later edit that turns a type import into a value import, or a bundler that doesn't tree-shake it) and it still reaches into the wrong dependency graph. The one confirmed leak this package was extracted to fix was exactly this shape: `entity-interest/messages.ts` importing `EntityUpdatedReason` as a value from a file (`#lib/redis`) that also did `import Redis from "ioredis"`, pulling a real TCP/TLS client into the mobile bundle.

If a type must be shared across the boundary, define it here and have the backend-only file import it back — never the reverse. `apps/app-backend/src/lib/auth-middleware.ts`'s `CachedUserPreferences` (moved here from the backend-only `builtins/bootstrap.ts`, which now imports it back) is the reference example.

## Keeping This In Sync

Adding a new backend HTTP endpoint means editing this package's `contract.ts` and that module's files here — not just `apps/app-backend`. The module folder layout under `src/modules/*` mirrors `apps/app-backend/src/modules/*` 1:1 by name.
