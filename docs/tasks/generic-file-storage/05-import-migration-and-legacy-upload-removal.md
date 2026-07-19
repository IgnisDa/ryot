# Import Migration And Legacy Upload Removal

**Parent Plan:** [Generic File Storage](./README.md)

**Status:** done

## What to build

Migrate every import upload path to the production local temporary intent flow. Shared test
fixtures and downstream import suites create a local temporary intent, PUT the source file
to its relative signed target, complete it, and pass the returned token into the existing
import creation contract. The imports service claims through uploads, requires a local
locator, obtains its validated absolute path, and carries an upload cleanup handle through
durable processing.

Transfer uploaded-source lifecycle ownership out of imports. Every pre-dispatch failure,
workflow success, workflow failure, pinning failure, and enqueue failure must request
idempotent deletion through uploads. Preserve source-required checks, source-specific
extension validation, sandbox grant construction, scratch/harvest cleanup, and generic chunk
cleanup. Once all consumers are migrated, remove the old multipart temporary endpoint and
all upload-token/path helpers that exist only for that flow.

## Acceptance criteria

- [x] Shared import upload fixtures use local create-intent, signed PUT, and completion rather than multipart temporary upload
- [x] All kernel and plugin import integration suites use the migrated fixture through production routes
- [x] Imports claim temporary tokens through the uploads service and reject non-local storage locators
- [x] A claimed local upload resolves to a path beneath `fileStorage.localTempDir` before sandbox use
- [x] Required-file and source-specific extension validation remains import-owned and behaviorally unchanged
- [x] A stable upload cleanup handle is carried into durable import processing
- [x] Validation, pinning, enqueue, workflow success, and workflow failure paths delete claimed uploads through the uploads service
- [x] The 24-hour processing lease remains a fallback when ordinary cleanup cannot run
- [x] Imports no longer directly delete uploaded source files or treat arbitrary paths as upload ownership
- [x] Sandbox scratch, harvest, ZIP extraction, and generic chunk cleanup remain with their existing owners
- [x] The old multipart temporary route, middleware-only branches, service method, response shape, and fixture are removed without aliases
- [x] Import service/workflow tests and end-to-end import suites cover local claims, S3 rejection, and every cleanup termination path
- [x] Raw requests to the removed temporary upload path no longer match a route

## Verification

- `bun turbo --filter=@ryot/app-backend check`
- `bun turbo --filter=@ryot/app-backend test --only -- src/app/kernel-workflow-references.test.ts src/modules/imports/service.test.ts src/modules/imports/import-run-workflow-live.test.ts src/modules/uploads/service.test.ts`
- `bun turbo --filter=@ryot/tests check`
- `bun turbo --filter=@ryot/tests test --only -- 'src/tests/kernel/imports/imports.test.ts'`
- `bun turbo --filter=@ryot/tests test --only -- 'src/tests/plugins/media/imports/imports.test.ts'`
- `bun turbo --filter=@ryot/tests test --only -- 'src/tests/plugins/fitness/imports/imports.test.ts'`
- `bun turbo --filter=@ryot/tests test --only -- 'src/tests/kernel/uploads/uploads.test.ts'`

## User stories addressed

- User story 25
- User story 26
- User story 27
- User story 39
- User story 40
- User story 41
- User story 42
- User story 43
