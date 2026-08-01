# Complete The Collection Workflow

**Parent Plan:** [Composable Views Tracer](./tracer.md)

**System Design:** [Composable Views](./README.md)

**Status:** todo

**Depends On:** [03 - Unify Plugin And Entity Pages](./03-unify-plugin-and-entity-pages.md), [05 - Add Rich Domain Presentations](./05-add-rich-domain-presentations.md), [06 - Support Configured Queries And General Results](./06-support-configured-queries-and-general-results.md)

## What To Build

From a user-composed page, select a Pokemon, choose a collection, review the membership change, and confirm it through the SDK. The saved membership must update both the displayed collection and its grouped count. Also invoke fixture's existing private `greet` operation using the explicit operation target from Task 03.

Implement [Collections](./tracer.md#collections), the mutation-success portions of [Queries, Assets, And Refresh](./tracer.md#queries-assets-and-refresh), and the dialog/overlay portions of [Back, Dialogs, And Screen State](./tracer.md#back-dialogs-and-screen-state). The [User-Owned Dashboard](./tracer.md#user-owned-dashboard) describes the final journey; build this interaction through a user-renderer test fixture now, then integrate home/seed behaviour in Task 10.

Add the narrow kernel collection port and SDK methods over existing create, membership upsert, and membership removal contracts. Read collection choices through typed RyotQL recipes. Authentication remains in the kernel. Do not expose a generic authenticated HTTP escape hatch.

The fixture owns the reusable Pokemon picker and dialog UI. Opening the dialog pushes `dialog=add-to-collection` and `entityId`; the internal choose/review steps are React state. Close pushed dialogs by pop and direct-entry dialogs by replacing only their search keys. Use the common overlay primitives and add the acknowledged document-level Back adapter for React-state overlays; do not add a general form-leave guard.

At the SDK capability boundary, successful operations and collection writes request one active-page refresh. Register query handles and custom refresh callbacks using existing query hooks. Refresh selection and aggregates, not only visible entity detail. Task 08 completes population/translation/background integration and the broader scheduling checks.

## Acceptance Criteria

- [ ] Collection create/upsert/remove methods use typed existing contracts through a narrow kernel port and validated bridge messages.
- [ ] The page invokes `fixture/greet` against the user's private fixture installation even when opened in media context.
- [ ] The public fixture picker can select a Pokemon outside the displayed collection.
- [ ] Choose, review, confirm, cancel, and retry states are implemented without adding a backend workflow engine.
- [ ] Cancel before confirmation writes nothing; failure preserves the user's selection and displays a retryable error.
- [ ] Retrying an uncertain submitted result uses existing idempotent membership-upsert behaviour and does not create duplicates.
- [ ] Browser Back closes a pushed dialog; direct-entry closing removes only dialog search keys with replace.
- [ ] Kernel and iframe overlays share correct Back ordering, acknowledgement, focus, and inert-background behaviour; edge Back is suspended while an overlay owns it.
- [ ] A successful SDK write refreshes active selection and grouped counts, whether or not the caller uses `useRyotMutation`.
- [ ] Hook and capability completion do not produce duplicate refreshes; failures and temporary-upload allocation do not signal a successful domain mutation.
- [ ] Selection refresh follows the previously loaded depth using fresh cursors and preserves stable item keys.
- [ ] A confirmed addition survives reload and visibly changes list membership and aggregate counts.
- [ ] Focused SDK, bridge, API, and browser tests exercise this complete persisted action.

## Verification

Reuse collection membership API tests and the existing private operation fixture. In the browser, seed three initial members and a fourth Pokemon outside the collection; assert the count changes from three to four and Pokemon count from one to two. Test cancellation, rejected writes, and direct-entry dialog closing separately from the successful path.

## User Stories Addressed

- [User story 10](./tracer.md#user-stories): explicit private plugin operation invocation.
- User story 11: a real multi-step membership action.
- User story 12: refresh result membership and summary data after a successful action.
- User story 14: shared dialog focus, scrolling, and Back behaviour.

## Implementor Notes

Record the mutation-completed signal, page-refresh registration seam, and Back-adapter message contract for subsequent tasks.
