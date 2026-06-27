# Support Configured Queries And General Results

**Parent Plan:** [Composable Views Tracer](./tracer.md)

**System Design:** [Composable Views](./README.md)

**Status:** done

**Depends On:** [04 - Browse Mixed Entities Automatically](./04-browse-mixed-entities-automatically.md)

## What To Build

Complete the configurable browser controls and let pages display query results that are not entity cards. A user can search/sort an entity view, choose a table, use an explicitly configured provider-add action, and author a page that consumes named aggregate or time-series results.

Follow [Saved View](./tracer.md#saved-view), [Browser Configuration](./tracer.md#browser-configuration), and the query portions of [Queries, Assets, And Refresh](./tracer.md#queries-assets-and-refresh). Reuse existing RyotQL validation, typed recipes, and SDK query hooks. Do not add language-level variables or another query/cache framework.

Search and sort use declared projected expressions. Keep query membership independent of the selected grid/list/table style. Add the separate `results-table` kernel renderer with explicit columns and typed stable row keys; entity links are optional. General rows referring to the same entity must remain distinct when their row keys differ.

Expose ordinary named source results to page code for explicit schema decoding. Prove grouped counts in a page and test the row/aggregate/time-series wire shapes. A visual dashboard editor or a collection of chart components is not required.

Expose provider search as the documented semantic screen request. The kernel owns its existing URL-state modal and authentication, makes the underlying page inert, and signals refresh when a successful import closes. Task 07 connects this signal to the complete shared mutation-refresh mechanism; the source can refetch through the current page registration seam in this task.

## Acceptance Criteria

- [x] Browser search and sort apply only declared fields/choices and use a deterministic tie-breaker.
- [x] Search/sort changes reset cursor/count identity and ignore stale requests without changing the stored base query.
- [x] Grid/list/table selection does not change result membership or search meaning.
- [x] URL search/sort/layout inputs override scoped stored/default layout preferences and preserve unrelated dialog parameters.
- [x] A configured entity table uses explicit ordered columns and the same selection source.
- [x] General results tables accept non-entity rows with stable typed composite keys and optional entity navigation.
- [x] Missing/null/duplicate row keys fail clearly; two distinct event rows for one entity are not collapsed.
- [x] Named row, aggregate, and time-series results retain their real output structures without fake entity IDs or unsupported cursor controls.
- [x] Explicit formatting and null-cell behaviour use general primitives rather than restored card-slot contracts.
- [x] Provider add is available only when configured, uses the existing kernel modal, and retains pushed/direct-entry close behaviour.
- [x] Non-functional filter controls are removed; arbitrary filter editing is not added.
- [x] Tests cover query meaning, general result decoding, controls, and provider-add integration through a real page.

## Verification

Adapt saved-view recipe, route, search, layout, and provider-add tests. Add focused general-table identity and named-output tests. Preserve independent result schemas with recipes; do not test Effect Schema or TypeScript assignment itself.

## User Stories Addressed

- [User story 7](./tracer.md#user-stories): explicit search/sort/layout/count/add behaviour.
- User story 8: general row tables.
- User story 9: dashboard data outputs beyond entity rows.

## Implementor Notes

Record the final query source names/bindings and provider-add page signal used by Tasks 07 and 10.

- The kernel `entity-browser` reads its named rows source through `sourceName`. Search fields and sort choices name projected fields, and every request adds the projected entity ID as a deterministic tie-breaker. Search, sort, and layout use merged URL keys; scoped storage supplies the layout fallback.
- Grid, list, and configured table layouts share the same selection query. Search or sort changes replace the result identity and clear pagination/count state, while layout changes preserve membership.
- The kernel `results-table` reads one named rows source, paginates with its configured page size, and encodes non-null composite keys as type-tagged stable JSON. Entity links are optional and do not become row identity.
- Table cells support text, date, number, boolean, JSON, and managed assets through the shared SDK asset resolver. Null values render as empty cells.
- Custom pages execute ordinary saved-view `dataSources` through page-owned recipes and Effect decoders. Focused browser coverage proves native rows, grouped aggregate items, and time-series buckets without synthetic entity identities.
- Provider add uses the semantic `provider-search-screen` bridge request with the configured stable owner plugin ID and entity-schema slug. The kernel owns the pushed URL modal, makes the iframe inert, and sends one narrow `page-refresh` signal after import; Task 07 replaces this seam with shared mutation-completed refresh.
- Client API version remains `1`. Bridge protocol version `3` adds provider search and page refresh messages, and compiler version `4` invalidates artifacts for the updated runtime bundle.
- Verified the affected `saved-view.test.ts` and `composed-views.test.ts` browser suites, focused contract/recipe/backend/client/compiler tests, and package checks during implementation.
