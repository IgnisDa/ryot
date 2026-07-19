# Operations Documentation And Workspace Isolation

**Parent Plan:** [Generic File Storage](./README.md)

**Status:** partial

## What to build

Finish the operational surface for simultaneous local and S3 storage. Update generated
configuration references, deployment examples, container/test provisioning, and the
file-storage guide with the exact configuration, persistence, permission, CORS, lifetime,
and single-replica constraints established by the parent PRD. Ensure a test backend can run
with both providers enabled and isolated local roots.

Keep the legacy backup client source completely untouched while excluding that package from
workspace build, check, and test participation. Verify active workspace commands no longer
require obsolete upload contract methods. This task documents and verifies the completed
behavior; it must not retain old APIs for operational convenience.

## Acceptance criteria

- [x] Generated configuration references include local permanent directory, local working directory, and local signing-secret settings
- [x] The file-storage guide documents simultaneous provider configuration and the complete upload-intent sequence
- [x] Documentation distinguishes durable local storage from the backend local working directory
- [x] Local volume persistence, writable non-root permissions, backup implications, capacity planning, and non-overlapping roots are documented
- [x] Local permanent storage is explicitly documented as single-replica only
- [x] S3 direct-PUT CORS requirements and supported headers/methods are documented
- [x] The 50 MiB limit, 15-minute intent and unclaimed lifetimes, 24-hour processing lease, and cron-delay semantics are documented
- [x] Deployment examples expose the required local directories as appropriate volumes without treating working storage as durable assets
- [x] Integration provisioning starts one backend with both S3 and isolated local storage available
- [ ] The legacy backup client package is excluded from workspace build/check/test participation without modifying files inside that application
- [ ] Backend package checks, backend tests, integration tests, and applicable monorepo checks pass with no compatibility upload routes

## Verification

- `bun turbo --filter=@ryot/docs build` passed.
- `bun turbo --filter=@ryot/app-backend check` passed.
- `bun turbo --filter=@ryot/app-backend test` passed.
- `bun turbo --filter=@ryot/tests check` passed.
- The affected e2e files passed separately: kernel uploads, kernel imports, media imports, and
  fitness imports.
- The full active-workspace check remains blocked by unrelated `@ryot/graphql` TypeScript
  configuration errors and an `@ryot/frontend` Node heap exhaustion.
- Workspace exclusion was intentionally not included in this scoped change; the legacy backup
  client source remains untouched.

## User stories addressed

- User story 28
- User story 29
- User story 30
- User story 31
- User story 32
- User story 33
- User story 34
- User story 35
- User story 43
