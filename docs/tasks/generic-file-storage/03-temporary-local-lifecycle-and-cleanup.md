# Temporary Local Lifecycle And Cleanup

**Parent Plan:** [Generic File Storage](./README.md)

**Status:** done

## What to build

Extend local upload intents with the complete temporary lifecycle. Temporary completion
returns a user-bound opaque token with a new 15-minute unclaimed lifetime. Claiming is
single-use and atomically changes the object to a 24-hour processing lease. The uploads
service can resolve a claimed local object to a safe absolute path beneath the backend local
working directory and can delete or release it idempotently when a consumer terminates.

Add the uploads-owned frequent cron task and cleanup state machine described in the parent
PRD. It must process pending intents, completed unclaimed objects, and expired claimed
objects in bounded batches with cleaning leases and retryable failures. As part of this
slice, move the top-level temporary-directory config into the file-storage group as the
backend local working directory and update current sandbox/import path consumers to compile
and preserve their behavior. Do not yet migrate imports to the new intent protocol; that is
owned by Task 05.

## Acceptance criteria

- [x] Create intent and completion support the `local` plus `temporary` combination
- [x] Temporary completion returns a user-bound opaque token and expiration 15 minutes after completion
- [x] Claims reject missing, expired, already claimed, malformed, and wrong-user tokens with typed errors
- [x] A successful claim atomically enters a 24-hour processing lease and cannot race successfully with cleanup
- [x] Claimed local objects resolve only to canonical paths beneath the configured local working directory
- [x] Consumers can idempotently delete a claimed temporary object through the uploads service
- [x] The former top-level temporary-directory key is replaced by `fileStorage.localTempDir` and `FILE_STORAGE_LOCAL_TEMP_DIR`
- [x] Existing sandbox scratch, harvest, ZIP extraction, and path-validation consumers use the moved configuration without changing ownership semantics
- [x] An uploads-owned task is registered with the existing frequent cron workflow
- [x] Cleanup uses a Redis expiration index, bounded batches, atomic cleaning leases, idempotent provider deletion, and retryable failures
- [x] Cleanup covers pending local intents, partial local writes, completed unclaimed local objects, and expired claimed local objects
- [x] Deterministic tests cover expiry, claim-versus-cleanup races, duplicate cleanup, missing objects, failed deletion retry, and batch bounds without real-time sleeps
- [x] End-to-end tests cover temporary local intent, PUT, completion, token issuance, and authentication failures

## User stories addressed

- User story 18
- User story 19
- User story 21
- User story 22
- User story 23
- User story 24
- User story 30
- User story 34
- User story 35
- User story 36
- User story 39
- User story 42
