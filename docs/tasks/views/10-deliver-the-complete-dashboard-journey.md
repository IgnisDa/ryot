# Deliver The Complete Dashboard Journey

**Parent Plan:** [Composable Views Tracer](./tracer.md)

**System Design:** [Composable Views](./README.md)

**Status:** done

**Depends On:** [05 - Add Rich Domain Presentations](./05-add-rich-domain-presentations.md), [06 - Support Configured Queries And General Results](./06-support-configured-queries-and-general-results.md), [07 - Complete The Collection Workflow](./07-complete-the-collection-workflow.md), [08 - Preserve State During Live Refresh](./08-preserve-state-during-live-refresh.md), [09 - Handle Dependency Updates Safely](./09-handle-dependency-updates-safely.md)

## What To Build

Deliver the complete agreed demonstration from media home using a genuinely user-owned published renderer. Add workspace-home selection and extend the existing seed script so an implementor can run the entire journey without editing stored rows or installing another tool.

Implement [Home Selection](./tracer.md#home-selection), [User-Owned Dashboard](./tracer.md#user-owned-dashboard), and [Deterministic Setup](./tracer.md#deterministic-setup). Reuse the public UI and real services from earlier tasks; do not move the dashboard source into fixture's plugin home.

Store the nullable home view reference on the user's plugin installation through its owning repository. Validate access, published/registered renderer availability, and enabled view state. Keep workspace placement separate from renderer ownership. Resolve media home at its existing URL without adding a nested frame or redirect loop.

The source fixture publishes a renderer with collection/page-size settings. Seed show, workout, Pokemon A, Pokemon B, and a collection with the first three as members. A page size of two makes fixture presentation first appear later. Add Pokemon B through the picker workflow and show the changed total and per-type count. Create a second saved view using the same renderer and different collection settings.

Extend `seed-client-plugin.ts` and existing fixture install/update helpers. Keep the revision-A/revision-B update demonstration. Automated setup uses production/test-support paths and hermetic data; never call live Pokemon or media providers for standard acceptance.

## Acceptance Criteria

- [x] The home-selection API stores a per-user installation override, accepts null, and rejects inaccessible/disabled/unpublished targets.
- [x] Global or differently placed saved views can be selected without changing their renderer/data ownership.
- [x] Media home renders the chosen view at the workspace URL with one frame, scroll root, and active workspace.
- [x] The direct saved-view URL remains usable and shared navigation data is reloaded rather than patched in place.
- [x] Deleted/disabled overrides fall back to the plugin default, while a broken build of an existing override remains an explicit error.
- [x] Demo source is published through the custom-renderer API and imports system media, system fitness, and private fixture public components.
- [x] The initial mixed collection displays three members and later introduces Pokemon presentation without rebuilding.
- [x] Adding Pokemon B changes the total from three to four and Pokemon count from one to two, and persists after reload.
- [x] Fixture `greet` succeeds against the private target from media-home context.
- [x] Show and Pokemon entity links open the correct registered pages through the shared runtime.
- [x] Two saved views reuse one published renderer with different settings without needless source copies or settings-only builds.
- [x] The existing seed script prints usable dashboard/home URLs and retains its install/update workflow.
- [x] Browser acceptance covers mobile, a narrow desktop container, direct dialog entry, Back, entity refresh, and update notice behaviour.
- [x] Native keyboard/hardware-Back smoke checks are recorded when a device/simulator is available; unavailable native verification is reported honestly.

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

- `PUT /plugins/:pluginSlug/home-view` stores `{ savedViewId }` on the user's exact installation. Selection locks the owned saved-view row and updates the installation in one transaction; disabling or deleting that view clears matching overrides atomically and emits the existing user catalog invalidation.
- The plugin catalog RyotQL recipe carries the effective nullable home ID. The workspace route prepares that saved view through the shared page host only at the plugin root, while nested plugin routes retain their registered pages and `/v/:viewSlug` remains the direct-view path. Route workspace identity overrides remembered workspace chrome without mutating loaded navigation data.
- The E2E-owned dashboard source imports media, fitness, and private fixture exports, uses collection/page-size settings, and is published once for two differently configured saved views. The deterministic journey seeds one show, one workout, two Pokemon, and a collection containing the first three entities, then verifies the persisted fourth membership, grouped counts, entity pages, dialog/Back behavior, narrow and mobile layouts, and media-home rendering in one iframe.
- Run `bun --cwd e2e run seed:client-plugin` to install fixture revision A, create and publish the dashboard, select media home, and print credentials plus the media-home, primary-view, and secondary-view URLs. The existing prompt then updates the same fixture installation to revision B.
- Native simulator/device verification was unavailable. Browser automation covers compact layout and Back semantics but is not recorded as a substitute for native keyboard or hardware-Back smoke testing.
- Review found that raw catalog selection did not fall back after a view was disabled/deleted, selection could race those mutations, and the journey checked entity links without opening them or testing direct dialog entry. Atomic clearing, row locking, catalog invalidation, and the expanded browser journey resolved the findings; re-review found no scoped defects.
- Backup round-tripping of the new home reference remains owned by Task 12's explicit backup-format cutover and was not pulled into this task.
