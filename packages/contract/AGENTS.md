# HTTP Contract

- Keep this package client-safe, including type imports: no backend, database, Redis, auth-server, Node, or Bun dependencies.
- Keep HTTP wire schemas generic. Plugin manifests and environment-key naming live in `src/modules/plugins`; bridge schemas belong to `@ryot-app/plugin-client-contract`.
- HTTP endpoint changes update `src/contract.ts`, the contract module, and its backend implementation.
- Authenticated writes use `AuthenticatedMutationEndpoint` with an explicit `DemoAccessPolicy`. Authenticated reads, public capability/webhook endpoints, and admin-only endpoints use raw `HttpApiEndpoint` constructors.
