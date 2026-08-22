# Handle Dependency Updates Safely

**Parent Plan:** [Composable Views Tracer](./tracer.md)

**System Design:** [Composable Views](./README.md)

**Status:** todo

**Depends On:** [02 - Compose Public Plugin Components](./02-compose-public-plugin-components.md), [03 - Unify Plugin And Entity Pages](./03-unify-plugin-and-entity-pages.md), [07 - Complete The Collection Workflow](./07-complete-the-collection-workflow.md)

## What To Build

Update a contributing plugin or publish changed renderer source while its page and collection dialog are open. The page must show a clear reload notice without immediately discarding the user's local state. Explicit reload prepares a current application; stale operations and stale-code fallback remain forbidden.

Follow [Compile And Cache](./tracer.md#compile-and-cache), [Page HTTP And Session Contract](./tracer.md#page-http-and-session-contract), [Open-Page Updates](./tracer.md#open-page-updates), and [Explicit Targets](./tracer.md#explicit-targets).

Use existing catalog/publication signals and graph identities. Detect changes to the page entry, contributor revision, or automatic-provider set. Do not rebuild on pagination and do not eagerly rebuild every saved view after installation changes. Coalesce preparation work by exact build identity and recheck revisions before reuse/commit.

Keep the accepted mounted host identity stable until explicit navigation/reload or a genuine fatal failure. Distinguish stale-session renewal from broken transport or logout. A stale loaded document can preserve in-memory content, but its old artifact file URLs are not exempt from backend freshness checks.

The kernel supplies recorded target revisions for operation dispatch. Changes to contributors or other recorded operation targets must never be hidden by silently sending a request to the latest implementation. Reload can establish a new target snapshot without bundling a target used only for operations.

## Acceptance Criteria

- [ ] Source publication, contributor revision changes, and automatic-provider membership changes invalidate the correct prepared build identities.
- [ ] An already-open dialog/page remains mounted when the update notice appears.
- [ ] The notice is kernel-owned and explicit reload warns that local unsaved state will be discarded.
- [ ] Stale session renewal stops without being misclassified as a fatal bridge error that automatically destroys the page.
- [ ] Logout, revoked access where required, and genuine bridge failure still dispose authority and resources correctly.
- [ ] Operations against recorded outdated revisions fail clearly; no newer backend revision is substituted silently.
- [ ] Explicit reload reuses an exact valid build or builds the current graph on demand, with race checks.
- [ ] Missing exports or failed current builds show named errors and retry, never an old executable fallback.
- [ ] Unrelated settings values do not force executable recompilation; changed source/provider sets do.
- [ ] Removed or unavailable explicit dependencies fail rather than selecting another installation by the same slug.
- [ ] The existing fixture revision-A/revision-B update path demonstrates the notice and successful reload.
- [ ] Tests cover update-during-dialog, failed rebuild, operation freshness, preparation races, and current artifact access checks.

## Verification

Extend existing artifact, catalog, host, operation, and fixture-update tests. Verify both host identity stability before reload and changed identity after a successful reload. Keep access checks focused on adapting existing rules; do not add another permission system or a broad security workstream.

## User Stories Addressed

- [User story 15](./tracer.md#user-stories): controlled updates without stale writes or fallback.
- User story 18: access checks continue through multi-contributor sessions.
- User story 12: updates do not erase unrelated local state before the user chooses reload.

## Implementor Notes

Record the distinction between stale preparation, stale mounted document, and fatal host failure so later callers do not conflate them.
