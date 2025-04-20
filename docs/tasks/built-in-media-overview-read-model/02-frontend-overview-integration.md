# Frontend Overview Integration

**Parent Plan:** [Built-in Media Overview Read Model](./README.md)

**Type:** AFK

**Status:** done

## What to build

Replace the built-in media overview's placeholder data for `Continue`, `Up Next`, and `Rate These` with the new backend read-model response from `/media/overview`, keeping the frontend focused on fetching, rendering, and local timestamp formatting rather than lifecycle derivation.

This slice should connect the real backend payload to the existing overview UI, preserve the current section scope, and avoid introducing saved-view builder work or client-side lifecycle logic. The resulting UI should render the backend-powered sections for built-in media while leaving out-of-scope sections unchanged.

See the parent PRD sections "Frontend expectations", "Backend contract shape", and "Out of Scope".

## Acceptance criteria

- [ ] `apps/app-frontend/src/features/trackers/builtin-media-tracker-overview.tsx` stops using placeholder data for `Continue`, `Up Next`, and `Rate These`
- [ ] The frontend fetches the backend read-model response and renders those three sections directly from the returned payload
- [ ] The frontend does not reimplement latest-event classification, overlap rules, or section ordering logic
- [ ] Timestamp display remains a frontend concern using raw backend timestamps rather than backend-provided relative strings
- [ ] Activity, Library, and other out-of-scope sections remain untouched by this slice

## Blocked by

- [Task 01](./01-media-overview-read-model-and-sections.md)

## User stories addressed

- User story 19
- User story 20
- User story 21
- User story 22
- User story 24
- User story 29
