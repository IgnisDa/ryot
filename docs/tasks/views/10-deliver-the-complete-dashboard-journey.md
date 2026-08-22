# Deliver The Complete Dashboard Journey

**Parent Plan:** [Composable Views Tracer](./tracer.md)

**System Design:** [Composable Views](./README.md)

**Status:** todo

**Depends On:** [05 - Add Rich Domain Presentations](./05-add-rich-domain-presentations.md), [06 - Support Configured Queries And General Results](./06-support-configured-queries-and-general-results.md), [07 - Complete The Collection Workflow](./07-complete-the-collection-workflow.md), [08 - Preserve State During Live Refresh](./08-preserve-state-during-live-refresh.md), [09 - Handle Dependency Updates Safely](./09-handle-dependency-updates-safely.md)

## What To Build

Deliver the complete agreed demonstration from media home using a genuinely user-owned published renderer. Add workspace-home selection and extend the existing seed script so an implementor can run the entire journey without editing stored rows or installing another tool.

Implement [Home Selection](./tracer.md#home-selection), [User-Owned Dashboard](./tracer.md#user-owned-dashboard), and [Deterministic Setup](./tracer.md#deterministic-setup). Reuse the public UI and real services from earlier tasks; do not move the dashboard source into fixture's plugin home.

Store the nullable home view reference on the user's plugin installation through its owning repository. Validate access, published/registered renderer availability, and enabled view state. Keep workspace placement separate from renderer ownership. Resolve media home at its existing URL without adding a nested frame or redirect loop.

The source fixture publishes a renderer with collection/page-size settings. Seed show, workout, Pokemon A, Pokemon B, and a collection with the first three as members. A page size of two makes fixture presentation first appear later. Add Pokemon B through the picker workflow and show the changed total and per-type count. Create a second saved view using the same renderer and different collection settings.

Extend `seed-client-plugin.ts` and existing fixture install/update helpers. Keep the revision-A/revision-B update demonstration. Automated setup uses production/test-support paths and hermetic data; never call live Pokemon or media providers for standard acceptance.

## Acceptance Criteria

- [ ] The home-selection API stores a per-user installation override, accepts null, and rejects inaccessible/disabled/unpublished targets.
- [ ] Global or differently placed saved views can be selected without changing their renderer/data ownership.
- [ ] Media home renders the chosen view at the workspace URL with one frame, scroll root, and active workspace.
- [ ] The direct saved-view URL remains usable and shared navigation data is reloaded rather than patched in place.
- [ ] Deleted/disabled overrides fall back to the plugin default, while a broken build of an existing override remains an explicit error.
- [ ] Demo source is published through the custom-renderer API and imports system media, system fitness, and private fixture public components.
- [ ] The initial mixed collection displays three members and later introduces Pokemon presentation without rebuilding.
- [ ] Adding Pokemon B changes the total from three to four and Pokemon count from one to two, and persists after reload.
- [ ] Fixture `greet` succeeds against the private target from media-home context.
- [ ] Show and Pokemon entity links open the correct registered pages through the shared runtime.
- [ ] Two saved views reuse one published renderer with different settings without needless source copies or settings-only builds.
- [ ] The existing seed script prints usable dashboard/home URLs and retains its install/update workflow.
- [ ] Browser acceptance covers mobile, a narrow desktop container, direct dialog entry, Back, entity refresh, and update notice behaviour.
- [ ] Native keyboard/hardware-Back smoke checks are recorded when a device/simulator is available; unavailable native verification is reported honestly.

## Verification

Run `composed-views.test.ts` as a standard isolated E2E file under the existing harness. Keep private/domain fixtures in their ownership-separated directories, and user renderer source in kernel page fixtures. Test the real API-created application rather than a hardcoded frontend route. Use existing configuration and pool limits.

## User Stories Addressed

- [User story 2](./tracer.md#user-stories): reuse one renderer with different settings.
- User story 4: navigate the full page/entity journey.
- User story 9: show aggregate data beside entity results.
- User story 14: complete mobile and narrow-layout experience.
- User story 16: saved view as workspace home.
- User story 17: reproducible demonstration through existing tooling.

## Implementor Notes

Record the final seed command/output URLs and any native verification limitations. Do not include real credentials in committed notes.
