# app-client rewrite — cheatsheet

Working notes for the `apps/app-client` rewrite (Expo). Captures the decisions and
build order agreed while planning. The old app lives in `apps/app-client-backup/`
(reference only, not authoritative). Backend it talks to is `apps/app-backend/`.

## Locked decisions

- **Fresh start, keep nothing wholesale.** `app-client-backup/` is a reference. The
  valuable part of the old app was its backend-facing spine (contract client, auth,
  instance-URL resolution) — that logic is being re-implemented, not the UI.
- **No gluestack UI.** Dropped entirely. Disliked the look/feel.
- **No jotai, no react-query.** This is an Effect-heavy app. State + data come from
  **effect-atom** (`@effect/atom-react`). effect-atom ships an `HttpClient`
  integration, so react-query is unnecessary.
- **Contract-derived client.** `AppContract` is an Effect Platform `HttpApi`, so the
  typed client is derived from it (`AtomHttpApi` / `HttpApiClient.make(AppContract)`)
  instead of a hand-written runner. The old `contract-client.ts` + `query.ts` +
  jotai `atoms.ts` triad collapses into one Effect runtime.
- **Custom design system is the primary visual layer**, not native Expo UI. The
  settled mockup (`tmp/app-client-palette/sixth.html`) is a custom design (serif Lora
  headings, warm-orange accent, custom cards/pills/tab bar) — not default iOS/Material.
  nativewind + the tokens render on **web** too. Expo UI is reserved for a few genuinely
  native touches behind `.ios.tsx` platform files (context menu `•••`, pickers, haptics).
- **Web stays** (same codebase). This is why the custom design system wins over Expo UI,
  which has zero web support.
- **Tracker = context switcher, not a nav tree.** See "Tracker model" below.

## Visual design (`sixth.html`)

- **Typography:** Lora (serif) headings, Outfit body. Both installed
  (`@expo-google-fonts/lora`, `@expo-google-fonts/outfit`).
- **Accent:** warm orange (pills, primary buttons, active tab, progress bars).
- **Surfaces:** custom cards, rounded pills/chips, custom bottom tab bar.
- **Status semantics:** Done (green), Playing (orange), Planned (blue).
- **Both light and dark** ramps required.
- **Tabs:** Home / Search / Library / You — generic, _not_ per-tracker.
- **Library pills:** All / Movies / Shows / Books — these are entity schemas _within_
  one tracker, not trackers.

## Tokens vs. primitives (the Phase 0 vs Phase 4 question)

- **Tokens ≠ design system.** `global.css` holds Phase 0 **tokens** (raw values: colors,
  fonts, radii, spacing).
- **Primitives** (`Text`, `Screen`, `Card`, `Pill`/`Chip`, `Button`, `ProgressBar`,
  cover `Image`, `StatusBadge`, rating stars) are Phase 4 — components that _spend_ those
  tokens. They don't exist yet. That's why the design system reappears in Phase 4.

## Refactoring already-built components

- The auth screens built in Phase 3 (`modules/auth/form.tsx`) already use the tokens
  correctly but **copy-paste recipes** (accent button, input, card styles inline).
- **Yes, they get a light refactor** to consume the primitives — but **defer it until the
  film tracer bullet** (Phase 5) gives a _second_ consumer, so the primitive isn't designed
  around auth alone.

## Tracker model (the key architectural decision)

Backend hierarchy (in `app-backend`): **Tracker → entity schemas → saved views**.

- Trackers (`media`, `fitness`, + user-created) are user-owned, orderable, disableable
  rows with icon/accent/description — "workspace/context" shape, not "navigation section".
- Entity schemas hang off a tracker (media → movie/show/book/…; fitness →
  exercise/workout/measurement/…).
- Saved views belong to a tracker (+ usually an entity schema).

**Decision: a context switcher, not a nav tree.** Reasons:

1. Backend already treats tracker as a scope, not a route.
2. The mockups assume it (generic tabs, no tracker tree anywhere).
3. A multi-level tree is high-friction for a 2-item list.

**Correction — it's a context swap, not a filter.** The tracker _redefines what every tab
means_ (Search in media = TMDB movie lookup; Search in fitness = exercise database. Home in
media = "Continue watching"; Home in fitness = today's workout). The verb changes too
("Mark watched" vs. log a set). So budget for **N tabs × M trackers** (per-tracker screens),
not one shared screen with a `where tracker = …` clause.

**Build the seam now, the widget later:**

- Add an `activeTrackerAtom` (default `media`, persisted like the server URL). Every screen
  reads the active tracker from it.
- **Do not build the switcher widget yet** — you'd be switching between one thing (YAGNI,
  and the mockups don't even show where the control lives). It becomes a small additive
  piece once fitness exists: it flips the atom, context-aware tabs re-render.

## Build order

Phases 0–3 are **done**. Current structure uses `src/modules/*`, `src/api/app-api.ts`,
`src/app/*` (expo-router).

- **Phase 0 — Deps & config** ✅ effect, @effect/platform, @effect-atom/atom-react,
  @ryot/contract, @ryot/ts-utils, @ryot/ryotql, better-auth, @better-auth/expo,
  expo-secure-store, react-native-mmkv, expo-image, lucide-react-native, Lora/Outfit fonts.
  tsconfig paths + babel, theme tokens into `global.css`.
- **Phase 1 — Instance-URL store** ✅ cloud vs self-hosted, trailing-slash strip, backed by
  MMKV/localStorage, exposed as an atom (`modules/server/*`).
- **Phase 2 — Data spine** ✅ `Atom.runtime` providing `HttpClient` (base URL
  `serverUrl + "/api"`, `credentials: "include"`, auth-header middleware). `AppContract`
  client derived via `AtomHttpApi`. Proven with unauthenticated `system.health` /
  `system.config`.
- **Phase 3 — Auth** ✅ better-auth expo client on secure-store; bridges the imperative
  cookie into the Phase-2 header middleware. onboarding → auth (login/signup/OIDC/2FA) →
  reset-password, `(app)` auth-guard layout (`modules/auth/*`, `src/app/(app)/*`).

**Next up:**

- **Phase 3.5 — Tracker seam.** Add `activeTrackerAtom` (default `media`, persisted).
  Not the widget — just the seam every screen reads.
- **Phase 4 — Design system + tab shell.** Theme (light/dark, Lora/Outfit), primitives
  (`Text`, `Screen`, `Card`, `Pill`, `Button`, `ProgressBar`, cover `Image`, `StatusBadge`,
  stars), bottom tab navigator (Home/Search/Library/You) replacing the old rail/sheet.
- **Phase 5 — Tracer bullet: film, end to end.** Library home (`Continue` + `Your library`)
  → entity detail (hero, Mark watched, Overview/Cast/Related tabs, In collections, metadata)
  → the `Mark watched` mutation. Exercises the whole stack once: `@ryot/ryotql` recipe
  → `RyotQLGroup` (`/ryotql`) → atom → render, plus `EventsGroup` for the write.
  Reads `activeTrackerAtom` = media. Reuse ported entity-detail/media logic; only view +
  atom wiring is new. **This also triggers the Phase-3 auth-component refactor.**
- **Phase 6 — Breadth.** Search (`EntitiesGroup`/`EntityImportGroup`),
  Library filters, Collection/saved-view screen (`SavedViewsGroup`, `CollectionsGroup`),
  You/settings.
- **Phase 7 — More media types.** Shows (S/E progress), games (hours played), books — each
  reuses the Phase-5 entity-detail framework with type-specific sections/progress semantics.
- **Phase 8 — Cross-cutting.** Trackers CRUD, media monitoring, interest SSE stream (natural
  fit for an effect-atom stream), imports, integrations, god-mode. **The switcher widget
  lands here**, once fitness gives it something to switch to.

## Sequencing rule

**Phases 2 → 3 → 5 are the spine.** Get one endpoint, then auth, then one full vertical
slice working before spreading wide — that's where the effect-atom / `AtomHttpApi` /
better-auth seams bite. One full vertical slice (film) before any breadth.

## Logic that ports from `app-client-backup/` (framework-agnostic pure TS)

- `features/entity-detail/*.ts` (model, people, companies, groups, collections, duration) + tests
- `features/media/overview-utils.ts`, `features/saved-view/runtime.ts` + table logic
- `lib/entity-image.ts`, `lib/form-utils.ts`, `lib/navigation-data.ts`, `lib/server.ts`

**Discarded:** `components/ui/*` (gluestack), `components/shell/*` (rail/sheet),
`lib/atoms.ts` + `lib/query.ts` (jotai/react-query), the `contract-client.ts` Effect-runner.
