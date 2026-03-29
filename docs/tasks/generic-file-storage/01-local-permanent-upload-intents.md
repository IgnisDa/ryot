# Local Permanent Upload Intents

**Parent Plan:** [Generic File Storage](./README.md)

**Status:** todo

## What to build

Deliver the first complete provider-neutral upload-intent path using permanent local storage.
Implement the upload intent and completion contracts described in the parent PRD, the
uploads-owned intent state store, the local provider boundary, local permanent storage
configuration, and a short-lived signed relative PUT target. A caller must be able to create
an authenticated local permanent intent, PUT at most 50 MiB to the signed target, complete
the intent idempotently, and receive a canonical `{ type: "local", key }` locator.

This slice establishes the generic interfaces that later S3 and temporary slices extend.
It must also index pending intents for cleanup and provide idempotent removal of abandoned
local data, rather than knowingly introducing an uncollectable intermediate flow. Keep the
existing legacy routes functioning until their replacements are complete in later slices;
do not add new compatibility aliases.

## Acceptance criteria

- [ ] The authenticated create-intent contract accepts provider, kind, file name, and content type and supports the `local` plus `permanent` combination
- [ ] Intent output contains an opaque identifier, PUT method, relative signed upload path, required headers, and a 15-minute expiration
- [ ] Local permanent storage uses its dedicated configured root and a dedicated signing secret
- [ ] The signed PUT route rejects expired, malformed, tampered, mismatched-method, and traversal attempts
- [ ] Local writes enforce the shared 50 MiB maximum without unbounded buffering and do not expose interrupted staged data as completed objects
- [ ] Authenticated completion verifies creator, object existence, size, and content type before returning `{ type: "local", key }`
- [ ] Successful completion is idempotent and removes the permanent object from cleanup eligibility
- [ ] Pending intent metadata is stored in Redis and indexed by expiration so abandoned local data can be deleted idempotently
- [ ] Local keys are opaque, collision-resistant, namespace constrained, and never contain a client-controlled path
- [ ] Service, route, signature, path-safety, size-limit, and idempotency behavior has focused automated coverage
- [ ] End-to-end coverage creates an intent, uploads bytes to the relative target, completes it, and verifies the permanent local locator

## User stories addressed

- User story 2
- User story 4
- User story 5
- User story 7
- User story 8
- User story 9
- User story 10
- User story 28
- User story 29
- User story 30
- User story 31
- User story 38
