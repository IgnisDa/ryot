# Sandbox Enqueue by Script ID

**Parent Plan:** [External Entity Search](./README.md)

**Type:** AFK

**Status:** done

## What to build

Extend `POST /sandbox/enqueue` with a second body variant that accepts a stored script ID
rather than raw code. When the `kind` field is `"script"`, the endpoint looks up the
`sandboxScript` row by `scriptId`, validates that the requesting user may run it
(`isBuiltin === true` or `script.userId === user.id`), resolves the code, and enqueues the
job via `SandboxService.enqueue()`. The `scriptId` is stored alongside the resolved code in
the BullMQ job payload for observability.

The `kind: "code"` variant retains its existing behaviour unchanged.

See the **Implementation Decisions** section of the parent PRD for the full contract details,
access-control rules, and the apiFunctionDescriptors that are injected for script-by-ID jobs.

## Acceptance criteria

- [ ] `POST /sandbox/enqueue` with `{ kind: "script", scriptId, context? }` enqueues the
      job and returns `{ data: { jobId } }`.
- [ ] `POST /sandbox/enqueue` with `{ kind: "code", code, context? }` behaves exactly as
      before (no regression).
- [ ] A request with `kind: "script"` and a `scriptId` that does not exist returns `404`.
- [ ] A request with `kind: "script"` and a `scriptId` belonging to another user (non-builtin)
      returns `404` (not `403`).
- [ ] A built-in script (`isBuiltin: true`) can be run by any authenticated user.
- [ ] The BullMQ job payload includes both `scriptId` and the resolved `code`.
- [ ] Unit tests cover all access-control outcomes (own script, built-in, other user's script,
      not found).
- [ ] `bun run typecheck` and `bun test` pass in `apps/app-backend`.

## Blocked by

None — can start immediately.

## User stories addressed

- User story 9 — enqueue any stored script by ID via `POST /sandbox/enqueue`
- User story 10 — access control enforced (`isBuiltin || ownedByUser`)
- User story 11 — `scriptId` stored in job payload alongside resolved code
- User story 12 — standard host function descriptors injected for script-by-ID jobs
