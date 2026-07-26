# Media Plugin

- Read `README.md` before changing operation contracts, monitoring, or lifecycle behavior.
- Keep operation input/output schemas in `backend/contracts/operations.ts`, outside sandbox entrypoints. Workflow consumers import `Schema` from `@ryot-app/sandbox-sdk/workflow`.
- Media signal definitions own notification message vocabulary and select `automation.media-notification`; do not move either into kernel.
- Keep `backend/lib/title-parsing.ts` and `backend/lib/title-matching.ts` within sandbox compiler ES2022 support; do not use `toReversed`.
- Contract or lifecycle changes must update `README.md`, manifest bindings, scripts, and focused tests together.
- Show recipes and RyotQL lifecycle expression builders live in `shared/`.
- Import show recipes straight from `shared/show-recipes`; never re-export them through `host/query-recipes.ts`, which owns only the podcast, suggestion, trending, and saved-view recipes.
- `client/` must not restate schemas that `shared/` owns.
- Size the Show hero art band from `useRyotSafeArea() + SCREEN_BAR_HEIGHT`. The hook reports the device inset alone, while the frame draws content under its own sticky bar, so the bar height is the plugin's to add.
