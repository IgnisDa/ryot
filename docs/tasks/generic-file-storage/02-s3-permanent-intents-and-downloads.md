# S3 Permanent Intents And Generic Downloads

**Parent Plan:** [Generic File Storage](./README.md)

**Status:** done

## What to build

Extend the intent protocol through permanent S3 storage and deliver generic download
resolution for both managed providers. S3 intent creation must return an absolute presigned
PUT URL, while completion must inspect the resulting object before returning an S3 locator.
The generic authenticated download resolver accepts stored local and S3 locators and returns
short-lived provider-appropriate URLs. Local results are relative signed backend paths; S3
results are absolute provider-presigned URLs.

Complete the local media-serving side of the download contract, including safe GET, HEAD,
and range responses. Replace the old S3-specific permanent upload and download routes,
service methods, and response schemas once the new routes cover their behavior. Extend
pending-intent cleanup to remove abandoned S3 objects that were uploaded but never
successfully completed.

## Acceptance criteria

- [x] The create-intent contract supports `s3` plus `permanent` and returns an absolute presigned PUT URL
- [x] S3 completion verifies creator, reserved key, object existence, content type, and the 50 MiB size limit
- [x] Invalid or oversized S3 objects never become permanent and remain eligible for deletion
- [x] Successful S3 completion is idempotent and returns `{ type: "s3", key }`
- [x] The authenticated generic download resolver accepts non-empty arrays of local and S3 locators and preserves result association
- [x] S3 download results contain 15-minute absolute presigned URLs
- [x] Local download results contain 15-minute relative signed paths
- [x] Signed local downloads safely support GET, HEAD, and byte ranges with correct content metadata and inline disposition
- [x] Pending cleanup can idempotently remove abandoned local and S3 intent objects
- [x] Requests for an unconfigured provider return a typed client-visible error instead of terminating the backend
- [x] The old S3-specific permanent presign routes, handlers, service methods, and schemas are removed rather than aliased
- [x] End-to-end tests exercise direct S3 PUT, completion, generic resolution, and byte retrieval, plus local resolution and retrieval

## User stories addressed

- User story 1
- User story 3
- User story 6
- User story 8
- User story 9
- User story 10
- User story 14
- User story 15
- User story 16
- User story 17
- User story 28
- User story 40
- User story 41
