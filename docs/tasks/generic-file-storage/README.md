## Tasks

**Overall Progress:** 6 of 8 tasks completed

**Current Task:** [Task 07](./07-operations-documentation-and-workspace-isolation.md) (todo)

### Task List

| #   | Task                                                                                                         | Status |
| --- | ------------------------------------------------------------------------------------------------------------ | ------ |
| 01  | [Local Permanent Upload Intents](./01-local-permanent-upload-intents.md)                                     | done   |
| 02  | [S3 Permanent Intents And Generic Downloads](./02-s3-permanent-intents-and-downloads.md)                     | done   |
| 03  | [Temporary Local Lifecycle And Cleanup](./03-temporary-local-lifecycle-and-cleanup.md)                       | done   |
| 04  | [Temporary S3 Lifecycle And Cleanup](./04-temporary-s3-lifecycle-and-cleanup.md)                             | done   |
| 05  | [Import Migration And Legacy Upload Removal](./05-import-migration-and-legacy-upload-removal.md)             | done   |
| 06  | [Cross-Provider Contract Hardening](./06-cross-provider-contract-hardening.md)                               | done   |
| 07  | [Operations Documentation And Workspace Isolation](./07-operations-documentation-and-workspace-isolation.md) | todo   |
| 08  | [Codebase Cleanup](./08-codebase-cleanup.md)                                                                 | todo   |

## Problem Statement

Ryot's application backend currently treats permanent file storage as an S3-specific
capability. Its public upload contract exposes presigned S3 terminology, permanent uploads
can only target S3-compatible storage, and stored asset values can only distinguish S3 keys
from remote URLs.

Temporary uploads enter through the uploads module, but their implementation is coupled to
imports and the process-wide temporary directory. The uploads module writes files to the
local filesystem and stores a single-use Redis token, while imports validate the resulting
absolute path and take responsibility for deleting the file. The Redis token expires after
15 minutes, but the underlying file does not. An upload that is never claimed therefore
leaks indefinitely. Partial failures can also leave files behind.

Ryot needs a generic uploads subsystem that supports S3-compatible and local filesystem
providers simultaneously. Callers must explicitly select a provider for each upload.
Uploads must use a provider-neutral upload-intent protocol, support temporary and permanent
lifetimes, resolve short-lived download URLs, and clean abandoned temporary data through the
existing frequent cron infrastructure. Imports must consume temporary local uploads through
this subsystem without owning their storage lifecycle.

This is a greenfield project. Existing S3-specific upload routes, schemas, methods, and
compatibility paths should be removed rather than deprecated.

## Solution

Build a provider-neutral uploads subsystem with explicit `s3` and `local` storage providers.
Both providers may be configured at the same time, and every upload intent identifies the
provider and whether the upload is temporary or permanent.

An authenticated caller creates an upload intent containing the provider, lifetime, file
name, and content type. The backend reserves an opaque object key and returns a short-lived
PUT target. S3 intents return an absolute provider-presigned URL. Local intents return a
relative, short-lived signed backend path. After uploading the bytes, the caller completes
the intent. Completion verifies the stored object before returning either a permanent asset
locator or a temporary upload token.

Permanent asset locators use a three-way union: remote URL, S3 key, or local key. Stored S3
and local assets are resolved through a generic authenticated download-resolution endpoint.
S3 results contain provider-presigned URLs; local results contain relative, short-lived
signed backend paths.

Temporary intent and object metadata is stored in Redis and indexed by expiration time.
An uploads-owned frequent cron task deletes expired and abandoned objects in bounded,
retryable batches. Claiming a temporary object atomically replaces its short unclaimed
lifetime with a processing lease. Consumers delete claimed objects when processing
terminates, while the sweeper provides eventual cleanup after crashes.

Imports always create temporary local upload intents. Claiming those tokens gives the import
workflow a validated absolute path beneath the configured local working directory. Imports
continue to validate source-specific extensions and orchestrate sandbox work, but all
uploaded-file claiming, lease management, and deletion belong to the uploads subsystem.

## User Stories

1. As a Ryot user, I want to upload a permanent file to S3, so that it can be retained in object storage.
2. As a Ryot user, I want to upload a permanent file to local storage, so that I can run Ryot without an S3-compatible service.
3. As a Ryot user, I want to choose S3 or local storage for each upload, so that both providers can be used by one deployment.
4. As a Ryot user, I want upload routes to use provider-neutral terminology, so that clients are not coupled to S3 implementation details.
5. As a Ryot user, I want an upload intent before transferring bytes, so that the backend can authorize and constrain the upload.
6. As a Ryot user, I want S3 upload bytes to go directly to S3, so that large transfers do not pass through the application backend.
7. As a Ryot user, I want local upload bytes to use a short-lived backend URL, so that local uploads follow the same intent protocol securely.
8. As a Ryot user, I want upload completion to verify the object, so that an asset is not returned for a missing or invalid upload.
9. As a Ryot user, I want completion requests to be safely retryable, so that a lost response does not force another upload.
10. As a Ryot user, I want permanent uploads to return their provider and key, so that stored assets can later be resolved correctly.
11. As a Ryot user, I want local assets to use the `local` type, so that they are distinct from S3 and remote assets.
12. As a Ryot user, I want S3 assets to continue using the `s3` type, so that their provider remains explicit.
13. As a Ryot user, I want externally hosted assets to continue using the `remote` type, so that Ryot does not attempt to manage them.
14. As a Ryot user, I want stored assets resolved to short-lived download URLs, so that provider details remain behind the uploads API.
15. As a Ryot user, I want local download URLs to be short-lived and signed, so that local files are not exposed through permanent public paths.
16. As a Ryot user, I want local download URLs returned as relative paths, so that deployments do not require a separately configured public backend origin.
17. As a Ryot user, I want local downloads to support normal browser media behavior, so that images and videos can be displayed efficiently.
18. As a Ryot user, I want temporary uploads to expire, so that abandoned imports do not consume storage forever.
19. As a Ryot user, I want incomplete upload intents to expire, so that interrupted transfers do not leave permanent garbage.
20. As a Ryot user, I want temporary S3 objects cleaned automatically, so that temporary storage does not accumulate in the bucket.
21. As a Ryot user, I want temporary local files cleaned automatically, so that the backend working directory does not fill up.
22. As a Ryot user, I want cleanup failures retried, so that transient provider errors do not permanently leak data.
23. As a Ryot user, I want an active import protected from ordinary temporary expiry, so that long-running imports are not interrupted.
24. As a Ryot user, I want files from failed imports removed, so that processing failures do not leak claimed uploads.
25. As a Ryot user, I want imports to use local temporary uploads, so that sandbox artifact grants receive safe filesystem paths.
26. As a Ryot user, I want imports to reject S3 temporary tokens, so that remote keys are never mistaken for sandbox filesystem paths.
27. As a Ryot user, I want import source extension validation preserved, so that each importer receives only supported formats.
28. As a Ryot operator, I want both providers configured independently, so that enabling one does not disable the other.
29. As a Ryot operator, I want local permanent files stored separately from working files, so that temporary cleanup cannot remove durable assets.
30. As a Ryot operator, I want a configurable backend working directory, so that temporary uploads and sandbox files use an appropriate volume.
31. As a Ryot operator, I want invalid provider requests rejected clearly, so that configuration errors are diagnosable.
32. As a Ryot operator, I want local storage documented as single-replica only, so that I do not deploy it behind multiple unshared backend instances.
33. As a Ryot operator, I want local directory permission and persistence requirements documented, so that files survive container replacement.
34. As a Ryot operator, I want the cleanup schedule to use existing scheduler infrastructure, so that another queue or scheduler is not introduced.
35. As a Ryot operator, I want cleanup work bounded per run, so that a backlog cannot monopolize a frequent cron execution.
36. As a Ryot operator, I want provider deletion to be idempotent, so that duplicate cleanup attempts are harmless.
37. As a Ryot operator, I want no public permanent-delete endpoint without ownership tracking, so that knowledge of a key does not grant deletion rights.
38. As a Ryot developer, I want storage operations hidden behind one uploads-owned interface, so that routes and consumers do not branch on infrastructure details.
39. As a Ryot developer, I want temporary lifecycle state centralized in uploads, so that imports do not duplicate storage rules.
40. As a Ryot developer, I want old S3-specific API names removed, so that new code cannot accidentally continue using the legacy flow.
41. As a Ryot developer, I want end-to-end tests for S3 and local flows, so that the public contract is verified against both providers.
42. As a Ryot developer, I want cleanup races tested deterministically, so that tests do not wait for real cron intervals.
43. As a Ryot developer, I want the legacy backup client excluded from workspace checks without changing its source, so that contract cleanup does not preserve obsolete APIs.

## Implementation Decisions

### Uploads Module Boundary

- The uploads module is the deep module that owns upload intents, object verification,
  provider dispatch, download resolution, temporary claims, processing leases, and deletion.
- Routes remain thin. They validate boundary data, obtain the authenticated user where
  required, call the uploads service, and return direct values or typed errors.
- Provider-specific infrastructure is hidden behind a storage interface implemented by S3
  and local providers.
- The provider interface supports reserving or deriving a key, creating upload targets,
  verifying object metadata, resolving download targets, resolving local paths where
  applicable, and idempotently deleting objects.
- Provider implementations must not own temporary lifecycle policy. The uploads service
  applies the same intent and cleanup state machine to both providers.
- No new third-party storage abstraction is required. Prefer existing Effect platform
  primitives, Bun's S3 APIs, Web Crypto, and Ioredis. Add an AWS SDK dependency only if a
  required S3 operation or supported-provider compatibility cannot be implemented correctly
  with Bun's S3 client.

### Storage Providers

- `s3` and `local` are the only managed upload providers.
- Both providers may be configured simultaneously.
- Provider availability is evaluated independently and, for local storage, by upload kind.
- A request for an unavailable provider fails with a typed, client-visible configuration
  error rather than terminating the backend.
- S3 retains the existing endpoint, region, bucket, access key, and secret key settings.
- Local permanent objects live beneath the configured local permanent directory.
- Local temporary objects, import artifacts, sandbox scratch data, and sandbox harvest data
  live beneath the configured backend local working directory.
- Local permanent and working directories must resolve to distinct, non-overlapping roots.
- Generated object keys are opaque and collision-resistant. Client filenames are never used
  as path segments. A validated extension derived from content type may be retained.
- Every provider operation validates the key namespace expected for its upload kind.
- Local path resolution uses canonical containment checks and must not permit traversal,
  absolute client paths, directory listing, or symlink escape.
- Local storage is supported only for a single backend replica using its own persistent
  volume. Shared or multi-replica local storage semantics are not part of this work.

### Configuration

- Remove the top-level temporary-directory configuration key.
- Add `fileStorage.localDir`, configured by `FILE_STORAGE_LOCAL_DIR`, for permanent local
  objects.
- Add `fileStorage.localTempDir`, configured by `FILE_STORAGE_LOCAL_TEMP_DIR`, for the
  backend's local working directory.
- The local working directory replaces all current process-wide temporary-directory uses,
  including temporary local uploads, import staging, ZIP extraction, sandbox scratch,
  sandbox harvest, and workflow path validation.
- Document `localTempDir` as the backend's local working directory, not as durable local
  object storage.
- Add a dedicated secret configuration value for signing local upload and download paths.
  It is required when signed local routes are enabled and must not reuse an admin token,
  S3 credential, or unrelated sandbox secret.
- Startup validation checks configured local roots and signing requirements without making
  S3 configuration mandatory.
- Generated configuration documentation must be regenerated after changing the definition.

### Asset Model

- The canonical asset value is a three-way discriminated union:
  - `remote` contains a URL.
  - `s3` contains an object key.
  - `local` contains an object key.
- Runtime property schemas, plugin-owned schemas, query behavior, fixtures, and tests must
  accept all three variants where managed images or videos are supported.
- Provider-specific collection fields such as S3 image or video arrays are not part of the
  resulting model. They have already been normalized and must not be reintroduced.
- Remote assets do not pass through managed upload or download routes.
- No backward-compatible asset migration is required for this greenfield project.

### Upload Intent Contract

- Remove the existing S3-specific presigned upload route and method names.
- Add an authenticated endpoint that creates an upload intent.
- Intent input contains `provider`, `kind`, `fileName`, and `contentType`.
- `provider` is exactly `s3` or `local`.
- `kind` is exactly `temporary` or `permanent`.
- Intent creation allocates an opaque intent identifier and provider object key before any
  bytes are uploaded.
- Intent output contains the intent identifier, HTTP method, upload URL, required headers,
  and expiration timestamp.
- S3 upload URLs are absolute provider-presigned PUT URLs.
- Local upload URLs are relative, short-lived signed PUT paths on the backend.
- Local URL signatures bind at least the method, intended path or object identity, and
  expiration timestamp.
- The local PUT route uses the signed capability as authorization and does not require a
  browser session in addition to that capability.
- Intent metadata is bound to the authenticated user who created it.
- Upload intents expire 15 minutes after creation.
- Uploading bytes does not by itself make an intent permanent or claimable; callers must
  complete it.
- Upload URL use and completion must not allow a caller to substitute a different provider,
  key, kind, content type, or user.

### Completion Contract

- Add an authenticated endpoint that completes an upload intent by its opaque identifier.
- Only the user who created an intent may complete it.
- Completion verifies that the provider object exists and matches the reserved key.
- Completion verifies the stored size and declared content type before returning success.
- All temporary and permanent uploads have a maximum size of 50 MiB.
- Local PUT handling enforces the limit while reading the request and must not buffer an
  unbounded request in memory.
- S3 completion verifies object size after direct upload. An oversized or otherwise invalid
  S3 object is rejected and scheduled or immediately attempted for deletion.
- Completion is idempotent. Retrying a successful completion returns the same logical result
  while its completion record remains available.
- Completing a permanent intent returns `{ type: provider, key }` and removes the object
  from temporary cleanup eligibility. The object is durable from that point onward.
- Completing a temporary intent returns a user-bound single-use upload token and expiration
  timestamp. Its unclaimed lifetime starts at successful completion and lasts 15 minutes.
- Completed permanent objects are not tracked for ownership or attachment to a domain
  record. A completed but unused permanent object remains permanent.
- Incomplete and failed intents remain eligible for cleanup, including cases where provider
  bytes were uploaded before completion.

### Upload Policy

- Use one shared content-type allowlist for temporary and permanent uploads.
- Preserve the existing supported CSV, XML, JSON, ZIP, gzip, and image MIME types.
- Add `video/mp4`, `video/webm`, and `video/quicktime` with canonical extensions.
- Normalize media types by removing parameters and comparing a lowercase value.
- An empty or `application/octet-stream` declaration may fall back to a recognized filename
  extension, preserving current import compatibility.
- Filename extension fallback never permits a type outside the shared allowlist.
- The contract's request limits and the service/provider verification limit use one shared
  source of truth.

### Local Uploads and Downloads

- Local PUT writes beneath the appropriate configured root for the intent kind.
- Local writes are staged and finalized safely so interrupted requests do not expose a
  completed-looking object.
- A failed or oversized local PUT removes its staged data best-effort and leaves the intent
  eligible for the sweeper.
- Remove the existing S3-specific download-resolution route and method names.
- Add one authenticated generic download-resolution endpoint for non-empty arrays of stored
  asset locators.
- The resolver dispatches each locator using its `s3` or `local` type and preserves input
  association in the response.
- S3 download results are short-lived absolute presigned URLs.
- Local download results are short-lived relative signed paths.
- Download URL lifetime is 15 minutes.
- Signed local download routes do not require a browser session; possession of an unexpired
  valid signature is sufficient.
- Local download signatures bind the method, key, and expiration timestamp.
- Signature comparison is constant-time and rejects malformed or expired signatures.
- Local file responses support GET, HEAD, and byte ranges so browsers can render and seek
  supported media.
- Local responses emit the verified content type, byte length, range headers where relevant,
  and inline content disposition.
- Download resolution does not perform permanent object ownership checks, matching the
  current ability of an authenticated caller to resolve a known S3 key.

### Temporary Lifecycle State

- Redis stores upload intent and temporary object metadata. No database table is introduced.
- A Redis sorted set indexes cleanup candidates by expiration timestamp.
- Metadata includes intent identifier, creator user ID, provider, kind, object key, expected
  content type, current state, timestamps, and the data needed to reproduce an idempotent
  completion response.
- The lifecycle distinguishes at least pending, completed, claimed, and cleaning states.
- State transitions that race with cleanup are atomic through Redis transactions or a Lua
  operation.
- The token presented by a consumer is opaque, user-bound, and single-use.
- Claiming succeeds only for an unexpired completed temporary upload belonging to that user.
- A successful claim atomically changes the state to claimed and replaces the 15-minute
  unclaimed lifetime with a 24-hour processing lease.
- Generic temporary claims return a storage locator containing provider and key metadata.
- A local claim can additionally resolve the safe absolute path for a consumer authorized
  to use local artifacts.
- Claiming an S3 temporary upload does not download or materialize it locally.
- Consumers explicitly release or delete claimed temporary uploads when processing ends.
- Deletion is idempotent and removes provider data before final lifecycle metadata.
- A claimed object whose consumer crashes becomes eligible for sweeper deletion after its
  24-hour processing lease.

### Frequent Cleanup

- Add an uploads-owned task to the existing frequent cron workflow task list.
- Do not add another scheduler, queue library, or independent timer.
- Cleanup runs at the configured frequent cron cadence. A 15-minute TTL means an object is
  eligible after 15 minutes and normally deleted within one additional cron interval.
- Each run selects a bounded batch of due candidates.
- Selecting a candidate for cleanup atomically moves it to a cleaning lease so concurrent
  requests or duplicate cron executions cannot also claim it.
- Cleanup checks current state and expiration before deleting.
- Provider deletion treats a missing object as success.
- Cleanup metadata is removed only after provider deletion succeeds.
- Failed deletion records remain or become eligible for retry after a bounded retry lease.
- One failing deletion does not prevent other candidates in the batch from being processed.
- Repeated executions and duplicate workflow dispatches are harmless.
- Cleanup covers incomplete intents, partially uploaded local files, S3 objects uploaded but
  never completed, completed unclaimed temporary objects, and expired claimed objects.
- Logging identifies provider, lifecycle state, and intent identifier without logging signed
  URLs, secrets, or user filenames unnecessarily.

### Imports Integration

- Imports always create or expect temporary uploads using the local provider.
- Import test fixtures and consumers use create-intent, PUT, and complete rather than the old
  multipart temporary route.
- The imports service claims a temporary token through the uploads service.
- Imports reject a successfully claimed locator whose provider is not local.
- The uploads service resolves a claimed local locator to an absolute path beneath the local
  working directory.
- Imports retain source-required checks and source-specific extension validation.
- Imports retain sandbox grant construction and workflow orchestration.
- The upload identifier or cleanup handle travels with durable import work so success,
  failure, pinning failure, and enqueue failure can all ask uploads to delete the claimed
  object.
- Imports no longer directly delete uploaded source files or infer upload ownership from a
  path.
- Sandbox scratch, harvest, and generated chunk cleanup remain owned by sandbox/import
  infrastructure because those files are workflow artifacts rather than uploaded objects.
- Existing path-containment validation is updated to use the moved local working directory
  configuration.

### Permanent Deletion

- Provider implementations expose idempotent deletion internally because temporary cleanup
  requires it and future domain owners may need it.
- Do not add a public endpoint that deletes permanent objects.
- Do not add permanent object ownership tracking in this work.
- Domain-owned deletion and removal of assets that are no longer referenced are separate
  future work.

### Workspace and Compatibility

- Remove old S3-specific upload and download endpoints, handler names, service methods,
  response schemas, and tests.
- Remove the old multipart temporary upload route after all import fixtures and consumers use
  the intent flow.
- Do not retain aliases, deprecated endpoints, fallback behavior, or compatibility wrappers.
- Do not modify source files in the legacy backup client.
- Exclude the legacy backup client package from workspace build, check, and test participation
  so its obsolete contract calls do not require compatibility code.
- The active client currently has no upload consumer and does not require UI work.

### Documentation and Deployment

- Rewrite the file-storage guide around simultaneous local and S3 support.
- Document all local directory and signing configuration.
- Document that the local permanent directory requires a writable persistent volume owned by
  the non-root backend process.
- Document that the local working directory is disposable working storage but must have
  enough capacity for uploads, imports, and sandbox artifacts.
- Document the single-replica restriction for local permanent storage.
- Document the upload-intent sequence and provider-specific target URL behavior.
- Document S3 CORS requirements for direct PUT uploads.
- Document the 50 MiB limit, 15-minute intent and temporary lifetimes, 24-hour claimed lease,
  and cleanup delay of up to one frequent cron interval.
- Update deployment examples and generated configuration references.
- Test provisioning configures both S3 and isolated local roots in the same backend so both
  providers can be exercised end-to-end.

## Testing Decisions

- Tests assert application-owned behavior and branching rather than Effect, Redis, S3, or
  cryptographic library behavior.
- Backend upload service tests cover provider dispatch, lifecycle transitions, completion
  validation, idempotency, user-bound claims, provider mismatch, and deletion behavior.
- Provider tests cover the observable contract of S3 and local implementations, including
  object verification, signed target generation, safe local path handling, and idempotent
  deletion.
- Local route tests cover valid signatures, expired signatures, tampering, traversal, size
  enforcement, interrupted writes, GET, HEAD, and byte ranges.
- Cleanup task tests use an injected clock or direct task invocation. They do not sleep for
  real TTL or cron intervals.
- Cleanup tests cover pending intents, unclaimed temporary objects, claimed processing
  leases, failed deletion retries, missing provider objects, bounded batches, and duplicate
  executions.
- Race tests verify that claim and cleanup cannot both acquire the same object and that an
  expired object cannot be newly claimed.
- Imports service and workflow tests verify local-only claims and uploads-owned cleanup on
  success, validation failure, pinning failure, enqueue failure, workflow failure, and
  processing-lease fallback.
- Contract tests verify required provider and kind values, non-empty download requests,
  response unions, shared size limits, and typed errors.
- End-to-end tests under the repository's integration test application are mandatory and run
  against one backend configured with both S3 and local storage.
- End-to-end S3 coverage creates an intent, uploads directly to the presigned URL, completes
  it, resolves a download URL, and verifies downloaded bytes.
- End-to-end local coverage creates an intent, uploads to the relative signed backend path,
  completes it, resolves a relative signed download path, and verifies downloaded bytes.
- End-to-end temporary coverage exercises both provider intent/completion flows and validates
  returned temporary tokens.
- End-to-end import coverage updates the shared import fixture to use a local temporary
  intent and verifies existing import suites continue through production service paths.
- End-to-end validation covers authentication, provider-unavailable errors, unsupported
  content types, missing upload objects, completion by another user, repeated completion,
  invalid signed local paths, and the 50 MiB limit.
- S3 oversized-object coverage uploads the object and verifies completion rejects it and
  cleanup removes it without relying on S3 to enforce the request length.
- Raw requests to removed legacy upload paths should return no matching route, demonstrating
  that compatibility endpoints were not retained.
- Existing upload service unit tests and kernel upload integration tests are rewritten rather
  than supplemented with tests for obsolete routes.
- Existing import integration suites provide prior art for authenticated file upload and
  workflow completion. Existing frequent cron and cron workflow tests provide prior art for
  task registration and deterministic scheduler testing.
- Backend verification uses the package's standard check and test commands. Monorepo-wide
  verification excludes the legacy backup client package as decided above.

## Out of Scope

- Modifying or modernizing source code in the legacy backup client.
- Adding upload UI to the active application client.
- Backward-compatible aliases or migrations for old upload routes and response shapes.
- Reintroducing provider-specific S3 image or video array fields.
- Multi-replica local storage or shared network filesystem coordination.
- Ownership tracking for completed permanent objects.
- A public permanent-delete endpoint.
- Automatic deletion of permanent objects when a domain record stops referencing them.
- Moving existing permanent objects between providers.
- Downloading S3 temporary uploads into the local working directory for imports.
- Resumable, multipart, or TUS uploads.
- Malware scanning, media transcoding, thumbnail generation, or content inspection beyond
  declared type, extension, size, and provider metadata validation.
- Supporting arbitrary MIME types outside the shared allowlist.
- Replacing the existing frequent cron infrastructure.
- Relying on external S3 lifecycle policies as the application cleanup mechanism.
- Changing sandbox scratch, harvest, or chunk ownership beyond moving their configuration
  path and preserving their existing cleanup behavior.

## Further Notes

- Redis expiration alone cannot delete provider objects. The sorted cleanup index and
  retained lifecycle metadata are required even though upload tokens expire.
- Direct S3 PUT avoids backend bandwidth but means application size validation occurs at
  completion. Invalid objects must not become permanent merely because S3 accepted them.
- A local signed URL is a bearer capability. It must be short-lived, must not contain a
  reusable secret, and must not be logged with its signature.
- Relative local paths are resolved by clients against their configured backend API origin.
- The local working directory remains necessary after moving it into file-storage config
  because imports and sandbox execution require real local filesystem paths.
- The mandatory final task generated from this PRD must run the codebase-cleanup skill over
  touched files and directly affected modules, with particular attention to obsolete S3
  terminology, old route helpers, duplicated upload limits, and import-owned upload cleanup.
