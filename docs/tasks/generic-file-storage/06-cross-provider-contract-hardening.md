# Cross-Provider Contract Hardening

**Parent Plan:** [Generic File Storage](./README.md)

**Status:** todo

## What to build

Complete and harden the public and stored-data contract across local, S3, and remote assets.
Apply the canonical three-way asset union everywhere managed images or videos are validated,
queried, imported, or tested. Consolidate upload MIME and size policy into one source of
truth, including the existing import/image formats and the approved MP4, WebM, and QuickTime
video types.

Exercise the entire cross-provider protocol for security and behavioral conformance. Cover
signature binding and expiry, canonical path containment, symlink escape, content metadata,
GET/HEAD/range responses, idempotent completion, provider availability, token races, and
removed legacy routes. This task closes gaps discovered across earlier slices; it must not
introduce compatibility wrappers or a parallel abstraction.

## Acceptance criteria

- [ ] Runtime property schemas and plugin-owned image/video schemas accept exactly `remote`, `s3`, and `local` asset variants where applicable
- [ ] Query, import, and stored-property fixtures cover local assets without reintroducing provider-specific image or video arrays
- [ ] One shared upload policy defines the 50 MiB limit and all approved document, image, and video MIME-to-extension mappings
- [ ] Empty and octet-stream declarations fall back only to recognized safe filename extensions
- [ ] Local signatures bind method, key, and expiry, use constant-time verification, and never expose or log the signing secret
- [ ] Local path handling rejects traversal, absolute keys, namespace mismatches, malformed encodings, and symlink escape
- [ ] Local GET, HEAD, valid ranges, invalid ranges, and media response headers are covered behaviorally
- [ ] Completion retries, wrong-user completion, missing objects, provider-unavailable requests, oversized objects, and metadata mismatch have typed outcomes
- [ ] Claim and cleanup races plus duplicate cron dispatches remain safe across both providers
- [ ] End-to-end suites exercise permanent and temporary local and S3 flows against one backend configured with both providers
- [ ] End-to-end suites verify authentication, invalid signatures, unsupported content types, size rejection, generic downloads, and removed route behavior
- [ ] No S3-specific route, handler, service, schema, or test terminology from the old flow remains in active backend, contract, or test code

## User stories addressed

- User story 11
- User story 12
- User story 13
- User story 14
- User story 15
- User story 16
- User story 17
- User story 31
- User story 36
- User story 38
- User story 40
- User story 41
- User story 42
