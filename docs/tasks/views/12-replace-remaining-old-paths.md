# Replace Remaining Old Paths

**Parent Plan:** [Composable Views Tracer](./tracer.md)

**System Design:** [Composable Views](./README.md)

**Status:** done

**Depends On:** [10 - Deliver The Complete Dashboard Journey](./10-deliver-the-complete-dashboard-journey.md), [11 - Unify Kernel Screen Data Access](./11-unify-kernel-screen-data-access.md)

## What To Build

Make the replacement system the only supported path for shipped views and their surrounding persistence, import, backup, packaging, and documentation surfaces. This task performs deliberate functional cutover; Task 13 is a separate final cleanup pass and must not be merged into it.

Follow [Saved View](./tracer.md#saved-view), the artifact/catalog replacement requirements in [Page HTTP And Session Contract](./tracer.md#page-http-and-session-contract), and [Step 7](./tracer.md#7-remove-old-paths-and-finish-documentation).

Convert every media, fitness, and fixture shipped saved-view definition to renderer/settings/data sources. Rich presentations remain limited to the tracer domains; other types use the supported generic renderer rather than retaining the old slots. Adapt navigation, cloning, disabled/order state, provider discovery, and builtin materialization to the new record model.

Update schema generation, backups, fixtures, and retained V1 import output together. Development data may be reset. Reject unsupported old V2 backup formats rather than add a compatibility reader. A retained V1 importer writes new-format state directly and does not justify keeping the removed V2 representation.

Remove replaced slot mappings/decoders/controllers, authored bootstrap paths, single-plugin session endpoints, stale catalog artifact-pointer assumptions, and temporary transition scaffolding after converting their real callers. Preserve generic formatting, query, UI, and authorization behaviour that still has a legitimate owner.

Delete the kernel's duplicate managed-asset helpers and image wrapper now that the extracted SDK behaviour serves both callers, and stop threading a resolved URL map through view state and component props. Keep the kernel-side asset service only where it answers a plugin session's bridged asset requests.

Update maintained package/application documentation and stale AGENTS rules. Every `AGENTS.md` change lands in its byte-identical `CLAUDE.md` mirror as well. The named stale rules are the kernel client's loader instruction for route-defining data, the media plugin's documentation of plugin-local asset batching and expiry, the media rule pinning its own asset image wrapper, and the compiler's verbatim trusted-import allowlist. Record the permanent pre-authentication and god-mode data-access exceptions in the kernel client's stable rules, and document the complete client capability error-reason set. The task index and design reference are not substitutes for maintained plugin-author and user documentation.

## Acceptance Criteria

- [x] Every shipped saved-view definition validates and opens through the new model, using generic presentation where no rich provider exists.
- [x] Builtin materialization, clone, disable/order, and navigation placement remain functional without mandatory grid/list/table query records.
- [x] No supported route or compiler entry depends on authored bootstrap or implicit plugin target compatibility.
- [x] Single-plugin-only session endpoints/adapters and obsolete catalog artifact-pointer consumers are removed or replaced at their real owners.
- [x] Old slot schemas, field-to-slot decoders, per-layout query controllers, and no-op filter UI are no longer retained as alternate paths.
- [x] Database and generated route/client outputs are produced through existing generation tools, not hand-edited.
- [x] New-format backup/restore fixtures round-trip renderer source, views, and home references consistently; derived artifacts are handled according to the new source/build ownership.
- [x] Unsupported old V2 formats are rejected explicitly, with no compatibility reader.
- [x] Retained V1 import code targets the new shipped definitions and state directly.
- [x] Tests formerly asserting old-format behaviour are replaced with meaningful new behaviour coverage rather than simply removed.
- [x] Backend/client/SDK/compiler/contract/plugin-kit READMEs, `apps/docs`, and directly affected AGENTS rules describe the implemented boundaries.
- [x] Every changed `AGENTS.md` rule is mirrored in its sibling `CLAUDE.md`, with no file left contradicting the other.
- [x] The kernel's duplicate managed-asset helpers and image wrapper are gone, no resolved URL map is threaded through view state or props, and the kernel-side asset service remains only for bridged plugin requests.
- [x] The permanent pre-authentication and god-mode data-access exceptions are documented as stable rules, and the client capability error-reason set is documented in full.
- [x] The complete tracer and affected shipped-view/backup/import tests still pass after cutover.

## Verification

Use the parent plan's affected package set and isolated standard E2E commands. Check manifests, source compiler imports, generated contracts, backup readers/writers, migrations, provider catalogs, and fixture scripts when finding old consumers. Do not widen scope into the legacy general seed script or unrelated domain features.

## User Stories Addressed

- [User story 19](./tracer.md#user-stories): shipped views, backups, imports, and docs use the replacement.
- User story 20: one maintained implementation without permanent transition paths.

## Implementor Notes

- Converted all shipped media, fitness, fixture, and kernel saved views to canonical `renderer`, `settings`, and `dataSources` records. Builtin materialization, cloning, ordering, disabling, provider add actions, navigation, plugin `homeView`, and custom home overrides now use that record directly.
- Removed saved-view layouts, slot mappings, field-to-slot decoders, layout controllers, the old saved-view route runtime, authored `client.entry`, single-plugin artifact sessions, `clientArtifactHash`, and their obsolete HTTP, Redis, catalog, client, and E2E paths. Compiler-generated `bootstrapClientPlugin` remains because plugin-route artifacts still use it as the active generated entry.
- Kept the client API, bridge, compiler, artifact, plugin manifest, and backup formats at greenfield version `1`. Backup export/restore now uses one `ryot-backup` V1 archive, stores renderer source plus canonical saved views and home references, remaps renderer/view IDs on restore, validates plugin and custom renderers, and excludes derived artifacts. V2/V3 backup code and fixtures were deleted; unsupported versions are rejected.
- Regenerated the reset Drizzle baseline at `kernel/backend/src/drizzle/20260908095514_tough_george_stacy/`, removing `saved_view.layouts`, `saved_view.entity_schema_slug`, and `saved_view.entity_schema_plugin_id` without an incremental development migration. The retained V1 Rust migration writes canonical saved-view state directly.
- Replaced kernel managed-asset callers with `@ryot-app/client-sdk/react` and removed the duplicate image wrapper. `ManagedAssetsService.read` remains only for `ClientPageHost` bridged asset requests.
- Updated maintained package, plugin, application, and user documentation plus directly affected stable rules. Changed `AGENTS.md` files continue to share their sibling `CLAUDE.md` mirrors.
- Reviewer feedback fixed canonical backup validation, collision-safe restored IDs, portable plugin renderer references and homes, plugin-rendered view restore validation, manifest source ownership, stale client artifact paths, and browser/E2E synchronization. The same reviewer reported no remaining Task 12 findings after re-review.
- Essential scope additions were limited to portable plugin-renderer backup references, plugin `homeView` handling, and plugin-rendered clone restore coverage. Each was required to make the planned canonical saved-view and backup cutover complete.
- Verification passed with `bun turbo --output-logs=full check`, `bun turbo --filter='!@ryot-app/e2e' --output-logs=full test`, and only affected E2E files covering saved views, renderer publication, backups, navigation, catalog events, fitness definitions, fixture provider smoke, client plugins, sidebar customization, and composed views.
