# Netflix ZIP Import Adapter

**Parent Plan:** [V2 Importing Infrastructure](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Port the Netflix export importer onto the V2 import pipeline and add the ZIP-specific file helper behavior needed by ZIP-backed sources. This slice should prove secure ZIP extraction, profile filtering where source data supports it, Netflix title matching/lookup behavior, history/review/watchlist mapping, source item failures, and cleanup of extracted artifacts.

Follow the parent PRD sections "File Handling And Security" and "Normalized Adapter Contract". ZIP extraction must be centralized in import file helpers and guard against zip-slip, file-count bombs, and decompressed-size bombs. The adapter must not delete temp files or extracted files directly; the worker/helper cleanup owns cleanup.

## Acceptance criteria

- [ ] Netflix source input schema is available through `POST /imports/runs`.
- [ ] ZIP file validation and extraction go through import file helpers.
- [ ] ZIP extraction rejects path traversal, excessive file counts, and excessive decompressed size.
- [ ] Extracted files are cleaned up best-effort by worker/helper cleanup and cleanup failures do not fail successful imports.
- [ ] Netflix viewing activity maps to non-episodic `complete` events or episodic `progress(100)` coverage according to matched media type and available episode data.
- [ ] Netflix ratings map to `review` events with historical dates where available.
- [ ] Netflix My List data maps to `backlog` events, not a watchlist collection.
- [ ] Source lookup or title-matching failures become item-level failures with useful `sourceLabel`/`sourceIdentifier` details.
- [ ] Raw Netflix CSV rows and raw ZIP contents are not stored in run summaries or failure context.
- [ ] Tests cover ZIP safety helpers and representative Netflix adapter success/failure cases.

## User stories addressed

Reference by number from the parent PRD:

- User story 1
- User story 4
- User story 5
- User story 7
- User story 8
- User story 9
- User story 11
- User story 12
- User story 15
- User story 16
- User story 22
- User story 23
