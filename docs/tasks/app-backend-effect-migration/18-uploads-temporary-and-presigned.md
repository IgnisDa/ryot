# Uploads Temporary And Presigned

**Parent Plan:** [App Backend Effect Migration](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Migrate upload routes and services for temporary multipart uploads and S3 presigned upload/download URLs. This slice should use Effect services for file/S3 access, typed upload limits, and typed errors for missing storage configuration or invalid uploads.

Uploads are mostly leaf behavior but become important for imports and app-client image loading later.

## Acceptance criteria

- [ ] Authenticated users can upload temporary files through the typed contract
- [ ] Multipart limits are enforced before handler logic
- [ ] Authenticated users can request presigned upload URLs when S3 is configured
- [ ] Authenticated users can request presigned download URLs when S3 is configured
- [ ] Missing or incomplete S3 configuration fails with a typed expected error
- [ ] Upload E2E tests pass through the Effect client or raw fetch where malformed multipart is required

## User stories addressed

Reference by number from the parent PRD:

- User story 35
- User story 50
- User story 56
- User story 59
