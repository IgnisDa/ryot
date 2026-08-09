# Media Plugin

- Read `README.md` before changing operation contracts, monitoring, or lifecycle behavior.
- Keep operation input/output schemas in `backend/contracts/operations.ts`, outside sandbox entrypoints. Workflow consumers import `Schema` from `@ryot-app/sandbox-sdk/workflow`.
- Media signal definitions own notification message vocabulary and select `automation.media-notification`; do not move either into kernel.
- Keep `backend/lib/title-parsing.ts` and `backend/lib/title-matching.ts` within sandbox compiler ES2022 support; do not use `toReversed`.
- Contract or lifecycle changes must update `README.md`, manifest bindings, scripts, and focused tests together.
- Sandbox scripts report non-fatal failures through the `log` host capability, never `console.warn`.
- Entity-presentation recipes and RyotQL lifecycle expression builders live in `shared/`. `shared/media-recipes.ts` owns the schema-agnostic selections and query shapes; `shared/show-recipes.ts` and `shared/movie-recipes.ts` compose their own recipes over them instead of sharing one parameterized recipe.
- One shared card and row presentation covers every media schema except `show` and `movie`; its loader takes the schema slug from the batch's references.
- Import media, show, and movie recipes straight from `shared/media-recipes`, `shared/show-recipes`, and `shared/movie-recipes`; never re-export them through `host/query-recipes.ts`, which owns only the podcast, suggestion, trending, and saved-view recipes.
- `client/` must not restate schemas that `shared/` owns.
- `client/media/` holds the schema-agnostic client layer both detail screens compose; it carries no `Show` or `Movie` symbol and no screen-specific copy. Lifecycle labels, beat wording, row labels, marker tones, and section actions are passed in from `client/show/` or `client/movie/`.
- Take every sync mark - art wells, pips, the settle ring, the translation chip, the count line - from `@ryot-app/client-ui-sdk/sync`. Use `ManagedAssetProvider`, `managedAssetKey`, and `useManagedAssetUrl` from `@ryot-app/client-sdk/react`; media code only adapts domain image values and forwards display state to `EntityArtWell`.
- Select sync state through `entitySyncSelection` in `shared/entity-selections.ts`, which `entityIdentitySelection` already spreads. A selection that builds its own identity fields, such as the credit and recommendation selections, spreads it too; no recipe writes those two columns by hand.
- Fill the hero box the frame sizes: declare the art height below the bar and draw with `absolute inset-0`, never a safe-area inset or bar height of the plugin's own.
- Take every layout decision in `client/` from the `compact` boolean `useRyotViewport()` reports, threaded down as a prop from the screen. Never write a `md:`, `sm:`, or `lg:` utility here: a media query inside the plugin document measures the iframe, not the viewport the kernel resolved `compact` from.
