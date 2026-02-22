# Temporary S3 Lifecycle And Cleanup

**Parent Plan:** [Generic File Storage](./README.md)

**Status:** todo

## What to build

Extend the completed temporary lifecycle through the S3 provider without materializing S3
objects into the local working directory. A temporary S3 intent uses a direct presigned PUT,
completion verifies the object, and claiming returns an S3 storage locator under the same
user-bound token and processing-lease rules as local storage. The frequent cleanup task must
delete abandoned, unclaimed, and expired claimed S3 objects with the same retry semantics as
local objects.

Keep provider-specific behavior behind the uploads provider boundary. Generic lifecycle
state and claim semantics must not branch into duplicated local and S3 implementations.
There is no import integration in this slice; imports will explicitly reject S3 claims in
Task 05.

## Acceptance criteria

- [ ] Create intent and completion support the `s3` plus `temporary` combination
- [ ] Temporary S3 uploads use absolute presigned PUT targets and are verified at completion
- [ ] Completion rejects and cleans oversized, missing, or metadata-mismatched S3 objects
- [ ] A completed S3 temporary upload returns the same token and 15-minute lifetime shape as local storage
- [ ] Generic claim returns an S3 provider/key locator and never downloads the object locally
- [ ] S3 claims are single-use, user-bound, atomic with cleanup, and protected by the 24-hour processing lease
- [ ] Cleanup covers incomplete S3 intents, uploaded-but-uncompleted objects, unclaimed temporary objects, and expired claimed objects
- [ ] Missing S3 objects are treated as successful idempotent deletion and transient S3 errors remain retryable
- [ ] Provider-neutral lifecycle tests run equivalent local and S3 behavior where appropriate
- [ ] End-to-end tests exercise temporary S3 intent, direct PUT, completion, token issuance, resolution behavior, and the 50 MiB completion limit

## User stories addressed

- User story 18
- User story 19
- User story 20
- User story 22
- User story 23
- User story 24
- User story 28
- User story 34
- User story 35
- User story 36
- User story 41
- User story 42
