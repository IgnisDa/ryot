# Contract Package Guidelines

This package owns the client-safe HTTP boundary: `AppContract`, Effect Schema payloads, generic
shared wire schemas, plugin manifests, shared errors, auth middleware, and wire-safe primitives.
`kernel-backend` implements this contract; backend services and infrastructure stay in
`kernel/backend`.

The iframe bridge protocol, client artifact model and format, client source file policy, and shared
client-plugin capability payloads belong to `@ryot-app/client-plugin-contract`, not this package.

- Never import backend code or runtime-only dependencies here, including through `import type`. This includes database, Redis, auth-server, Node, and Bun modules.
- Define shared boundary types here and import them from backend consumers, never the reverse.
- Keep plugin manifest schemas and environment-key naming in `src/modules/plugins`; consumers import them from the defining contract module.
- Adding an HTTP endpoint requires updating `src/contract.ts`, its contract module, and the matching backend module.
- Construct authenticated POST/PUT/PATCH/DELETE endpoints with `AuthenticatedMutationEndpoint` from `src/authenticated-mutation-endpoint.ts`, passing an explicit `DemoAccessPolicy` (`"allowed"` or `"protected"`). Do not construct them with raw `HttpApiEndpoint` plus an annotation.
- Public capability/webhook endpoints and admin-only endpoints use raw `HttpApiEndpoint` constructors; authenticated reads also use raw constructors.
