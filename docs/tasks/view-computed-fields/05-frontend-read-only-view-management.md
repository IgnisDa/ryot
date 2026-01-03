# Frontend Read-Only View Management

**Parent Plan:** [View Computed Fields](./README.md)

**Type:** AFK

**Status:** done

## What to build

Make the frontend intentionally read-only for saved-view semantics so the app does not break once the backend contract changes. Remove the saved-view editing UI and its dead code, keep view execution and rendering working against the new backend contract, and replace the drawer with a simple message that advanced saved-view editing is currently available only through direct payloads/config.

The end-to-end behavior: users can still load saved views, execute them, switch layouts, view runtime results, and perform non-semantic actions like clone/delete/toggle/reorder, but the old frontend editing experience is removed completely instead of pretending to support the new language.

See the parent PRD sections "Implementation Decisions" and "Out of Scope" for the no-builder stance and direct-payload authoring model.

Backward compatibility is not needed in this slice. Remove the old editing experience and its assumptions instead of trying to adapt it to both contracts.

## Acceptance criteria

- [x] Saved-view execution in the frontend uses the new expression-based backend contract without relying on legacy reference arrays
- [x] The saved-view editing UI is removed from the frontend completely
- [x] Dead code tied only to the removed editing UI is deleted
- [x] The saved-view drawer shows a simple read-only message explaining that advanced editing currently requires direct payloads/config
- [x] Clone, delete, disable/enable, reorder, and view rendering continue to work after the UI removal

## Blocked by

- [Task 02](./02-computed-fields-and-raw-output.md)

## User stories addressed

- User story 13
- User story 14
- User story 15
- User story 16
- User story 22
- User story 23
- User story 36
- User story 39
- User story 41
