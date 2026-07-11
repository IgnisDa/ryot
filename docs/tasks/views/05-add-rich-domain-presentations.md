# Add Rich Domain Presentations

**Parent Plan:** [Composable Views Tracer](./tracer.md)

**System Design:** [Composable Views](./README.md)

**Status:** done

**Depends On:** [04 - Browse Mixed Entities Automatically](./04-browse-mixed-entities-automatically.md)

## What To Build

Make the mixed browser useful: shows display media information, workouts display a compact image-free summary, and Pokemon display artwork, types, and expandable details. Load domain data in presentation batches through the contract from Task 04.

Follow [Public Components](./tracer.md#public-components), [Entity Presentations](./tracer.md#entity-presentations), and the asset portions of [Queries, Assets, And Refresh](./tracer.md#queries-assets-and-refresh). Register both grid and list exports for show, workout, and Pokemon. Reuse components and query recipes in their plugin pages where applicable.

Keep domain calculations and decoders in the owning plugin. Derive workout duration from stored start/end times and use real schema-backed set/exercise data for any extra summary shown. Omit unavailable data rather than inventing numbers. Do not add logging/editing workflows or new persisted summary fields for the demo.

Extract media's reusable managed-asset batching and expiry behaviour into the SDK while leaving domain asset collection in plugin code. Preserve placeholders and cached values during failed refresh. Ensure components adapt to their container width as well as the bridged outer compact mode. Keep the extraction's visual half where the artifact stylesheet scanner reaches it, per the same asset requirements; the kernel becomes its second caller in Task 12.

These presentation exports are new code, so build them from existing UI SDK components wherever an equivalent already exists rather than adding hand-rolled duplicates. The media show screen currently carries its own button, chip, tab bar, and status-message primitives; do not extend that pattern into the new exports, and do not refactor the existing ones here. Lifting those older primitives into the UI SDK is deliberately out of scope until more domains need them.

## Acceptance Criteria

- [x] Media provides useful `show-card` and `show-row` exports with artwork when available, name, release/status information, and stored progress/episode information.
- [x] Fitness provides `workout-card` and `workout-row` exports with date, duration, useful stored summary, and expandable detail.
- [x] Image-free workouts do not render or reserve an empty poster region.
- [x] Fixture provides `pokemon-card` and `pokemon-row` exports with artwork, types, and expandable abilities/measurements.
- [x] Recipes, schemas, and decoded types stay colocated with their owning plugin rather than moving domain knowledge into the kernel.
- [x] Visible batches do not issue a full detail request independently for every card.
- [x] Per-item React keys and expanded state remain stable across ordinary data replacement.
- [x] Common asset resolution deduplicates locators, observes existing batch limits, handles expiry, and uses SDK authority only.
- [x] New presentation exports use existing UI SDK components where an equivalent exists and add no new hand-rolled duplicates of them.
- [x] Domain pages reuse the relevant public components or shared domain pieces rather than maintain copied presentation logic.
- [x] All three presentations work in grid/list, mobile compact mode, and a narrow desktop container.
- [x] Local data/image/render failures leave other entities usable, with meaningful retry or fallback states.
- [x] Domain recipe and component tests prove useful displayed behaviour using deterministic stored data.

## Verification

Extend media's existing show recipe/refresh tests, add fitness presentation tests under its existing test surface, and exercise private Pokemon rendering through the browser fixture. Use actual production schemas. Do not rely on live PokeAPI or media responses.

## User Stories Addressed

- [User story 6](./tracer.md#user-stories): domain-appropriate rich presentations.
- User story 14: container-responsive and mobile content.
- User story 5: mixed results stay usable when individual presentations fail.

## Implementor Notes

- Added automatic media exports `show-card` and `show-row`, fitness exports `workout-card` and `workout-row`, and fixture exports `pokemon-card` and `pokemon-row`.
- Added plugin-owned batched RyotQL recipes and decoders for shows, workouts with correlated exercises and sets, and Pokemon. Presentations preserve entity order and local expansion state while adapting to compact and narrow containers.
- Moved generic managed-asset behavior to `@ryot-app/client-sdk/react` as `ManagedAssetProvider`, `useManagedAssetUrl`, `managedAssetBatches`, `managedAssetKey`, and `canonicalAssetBatchKey`. The SDK deduplicates and sorts locators, enforces the canonical 64-asset limit, refreshes before expiry, and keeps cached successful URLs when a refresh fails.
- Removed media's duplicate batching, keying, provider, resolution context, scheduling, and expiry implementation. Media retains only domain-specific image selection and its remote-or-managed adapter.
- Reused media show summary pieces on the show page and presentations, and shared fixture Pokemon artwork/details pieces between the detail page and presentations. Fitness presentations remain image-free and derive duration and expandable exercise/set detail from stored schema-backed data.
- Added deterministic recipe, component, managed-asset, and focused browser coverage. A presentation failure remains item-local through the Task 04 entity browser fallback and retry boundary.
