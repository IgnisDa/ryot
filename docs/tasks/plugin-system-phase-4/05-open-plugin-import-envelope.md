# Open Plugin Import Envelope

**Parent Plan:** [Plugin System - Phase 4](./README.md)

**Status:** todo

## What to build

Replace the central closed first-party import-source union with the catalog-validated open envelope
described in "Import contract". Read the overview, Phase 4 plan, parent PRD, and this task first.

Carry the change through the contract, route/service boundary, artifact claiming, source metadata,
workflow dispatch, plugin-owned typed helpers, and an installed fixture source that did not exist when
the central contract was authored. Preserve strict validation of source identity, JSON compatibility,
declared upload-token fields, named artifact requirements, extensions, and active package config.

Do not add source discovery, marketplace behavior, or compatibility unions that continue enumerating
all current sources.

## Acceptance criteria

- [ ] The central request contract accepts a non-empty source slug without enumerating first-party sources
- [ ] Unknown and inactive source slugs fail before uploads are claimed or workflows start
- [ ] Only declared payload fields or artifact token fields reach the selected source workflow
- [ ] Single and named file declarations retain required/optional and extension validation
- [ ] First-party source-specific client helpers remain typed and compose into the generic envelope
- [ ] A newly installed fixture source is invoked through the public import endpoint and reaches terminal success
- [ ] Tests cover malformed payloads, undeclared tokens, missing required artifacts, unknown source, and config failure
- [ ] Media and fitness source names are absent from the generic contract implementation
- [ ] No source-listing endpoint or speculative manifest schema is added
- [ ] The corresponding purity exception is removed

## User stories addressed

- User story 13
- User story 14
- User story 15
