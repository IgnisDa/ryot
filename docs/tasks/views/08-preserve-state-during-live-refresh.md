# Preserve State During Live Refresh

**Parent Plan:** [Composable Views Tracer](./tracer.md)

**System Design:** [Composable Views](./README.md)

**Status:** done

**Depends On:** [07 - Complete The Collection Workflow](./07-complete-the-collection-workflow.md)

## What To Build

Keep the composed page current when entity population/translation completes or the application returns from the background, without collapsing expanded rows, clearing form input, or creating duplicate requests. Complete the shared refresh integration started by the persisted action.

Follow [Queries, Assets, And Refresh](./tracer.md#queries-assets-and-refresh). Reuse current query caching, entity-interest aggregation, refresh scheduling, settle tracking, and limits. Do not add another connection, cache framework, polling loop, or automatic query-dependency analyser.

Several presentations can watch one entity through the shared runtime. Use the common page scroll root for visible-item tracking, preserve foreground priority before applying the total cap, and release interest from inactive screens. Loaded offscreen entities are not automatically foreground work.

Active-screen state defaults to active and is currently supplied only by the plugin router, so anything outside a plugin page counts as permanently active. Keep that ownership explicit here rather than assuming it, because Task 11 brings kernel screens onto the same query surface and they need their own owner of that state before their queries declare interest.

Add the kernel lifecycle hint for background return and deduplicate it with existing focus refresh. Refresh callbacks and query handles must coalesce repeated hints, retain a pending hint during in-flight work, and reject completion for obsolete inputs. Keep previous successful data visible on refresh errors.

A mutation that completes after navigation refreshes the currently active page and marks retained inactive data stale for later activation; it must not refetch hidden screens. This is page freshness, not arbitrary form persistence across iframe replacement.

## Acceptance Criteria

- [ ] Multiple components' interest is combined through the existing connection and deduplicated by entity ID.
- [ ] Foreground priority survives runtime and kernel capping ahead of visible-only interest.
- [ ] List visibility uses the shared scroll root and inactive screens release active interest.
- [ ] Population/translation completion refreshes the appropriate data and updates sync/settle display.
- [ ] Background return produces one effective refresh rather than duplicate kernel, iframe, and query-focus requests.
- [ ] Concurrent hints coalesce; a hint arriving during a request produces the necessary later refresh rather than being lost.
- [ ] Search/input/route identity changes prevent obsolete responses from replacing current data.
- [ ] Refresh failures preserve previous content and provide an error/retry state.
- [ ] Expanded rows and unrelated dialog/form state survive ordinary data refresh with stable React keys.
- [ ] Hidden retained screens do not refetch until reactivated, and disposed callbacks/interest owners do not leak.
- [ ] Mutation completion after navigation follows the documented active-page/stale-retained-page rule.
- [ ] Tests cover real completion signals and browser-visible state preservation, not just manual component prop replacement.

## Verification

Extend SDK query/entity-refresh tests, kernel entity-interest aggregation tests, and existing media refresh-state tests. Use a hermetic population/translation completion path in the browser test. Preserve an expanded workout or Pokemon section while a different displayed value updates, and verify that an open dialog is not remounted.

## User Stories Addressed

- [User story 12](./tracer.md#user-stories): state-preserving refresh after mutations.
- User story 13: shared entity-interest and background updates.
- User story 14: correct active-screen and scroll-root behaviour on mobile.

## Implementor Notes

Record refresh scheduling/identity decisions and the tests that prove state preservation. Do not describe this as general real-time query support.

- `RyotProvider` now routes browser focus, host page refresh, mutation completion, ordinary query refresh, and custom `usePageRefresh` callbacks through one batched page-refresh registry. Registry generations mark retained inactive consumers stale without fetching them; reactivation performs one catch-up, and a hint received during an in-flight request schedules one later refresh.
- `usePageRefreshRequest` gives SDK internals a narrow way to request that shared refresh without misreporting entity completion as a mutation. Query atoms remain responsible for rejecting obsolete input completions and retain their previous successful value when refresh fails.
- `EntityResults` observes each rendered item with the active plugin screen's existing scroll root. It declares only intersecting entity IDs as visible interest, clears demand when items or retained screens become inactive, and leaves foreground interest to callers that explicitly require it. Existing runtime and kernel aggregation continue deduplicating owners and cap foreground IDs before visible IDs.
- Population and translation completion for a visible presentation request a shared page refresh, so selection references, presentation batches, summaries, and settle display update together. Presentation refresh failures now keep the previous component mounted with its local state and expose retry instead of replacing it with an error item.
- Kernel visibility return and Capacitor resume send the existing page-refresh bridge message. The iframe's own focus signal enters the same scheduler, so simultaneous lifecycle hints coalesce without a new wire message or polling path.
- Focused SDK tests cover viewport interest, inactive cleanup, retained-screen catch-up, in-flight hints, obsolete input protection, refresh failure/recovery, and stable component state. Kernel tests cover visibility and native-resume delivery and listener cleanup.
- The affected composed-view browser suite uses a delayed hermetic provider through the production entity-interest WebSocket. It proves sync and Pokemon data update while expansion, collection review state, dialog identity, iframe identity, and the React root remain intact. The Task 07 live mutation, pagination, and reload assertions remain separate and unchanged in behavior.
