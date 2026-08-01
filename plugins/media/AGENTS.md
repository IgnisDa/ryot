# Media Plugin

- Read `README.md` before changing operation contracts, monitoring, or lifecycle behavior.
- Keep operation input/output schemas in `backend/contracts/operations.ts`, outside sandbox entrypoints. Workflow consumers import `Schema` from `@ryot-app/sandbox-sdk/workflow`.
- Media signal definitions own notification message vocabulary and select `automation.media-notification`; do not move either into kernel.
- Keep `backend/lib/title-parsing.ts` and `backend/lib/title-matching.ts` within sandbox compiler ES2022 support; do not use `toReversed`.
- Contract or lifecycle changes must update `README.md`, manifest bindings, scripts, and focused tests together.
- Sandbox scripts report non-fatal failures through the `log` host capability, never `console.warn`.
- Show recipes and RyotQL lifecycle expression builders live in `shared/`.
- Import show recipes straight from `shared/show-recipes`; never re-export them through `host/query-recipes.ts`, which owns only the podcast, suggestion, trending, and saved-view recipes.
- `client/` must not restate schemas that `shared/` owns.
- Take every sync mark — art wells, pips, the settle ring, the translation chip, the count line — from `@ryot-app/client-ui-sdk/sync`. `ManagedAssetImage` resolves a locator from context and forwards to `EntityArtWell`; never re-implement a placeholder, a monogram, or an animation here.
- Select sync state through `entitySyncSelection` in `shared/entity-selections.ts`, which `entityIdentitySelection` already spreads. A selection that builds its own identity fields, such as the credit and recommendation selections, spreads it too; no recipe writes those two columns by hand.
- Fill the hero box the frame sizes: declare the art height below the bar and draw with `absolute inset-0`, never a safe-area inset or bar height of the plugin's own.
- Take every layout decision in `client/` from the `compact` boolean `useRyotViewport()` reports, threaded down as a prop from the screen. Never write a `md:`, `sm:`, or `lg:` utility here: a media query inside the plugin document measures the iframe, not the viewport the kernel resolved `compact` from.
