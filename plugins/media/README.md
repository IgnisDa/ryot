# Media Plugin

Media plugin owns media schemas, relationships, saved views, providers, operations, automations, and bindings. Generic plugin manifest and sandbox mechanics live in `@ryot-app/plugin-kit/README.md`.

Provider declarations explicitly identify their root entity schema. Saved views do not carry sandbox script declarations.

## Client

The Media client provides a static workspace placeholder and a `show` entity renderer. The renderer
queries five client-owned RyotQL recipes (summary, overview, seasons, season episodes, activity) and
renders a hero (backdrop, scrim, poster-sampled tint), a summary header (poster, title, identity line,
genres, fact row, expandable description, status rail), and three tabs: Overview (image gallery, cast
& crew, production companies, recommendations), Episodes (season selector, season header with
progress, next-up, episode rows), and Activity (summary figures, per-season coverage, timeline,
spoiler-gated reviews). Entity-to-entity links navigate through `PluginLink`.

The hero declares its art height to the frame, which uses it as the bar's collapse threshold and as
the height of the box it draws the art into; the art fills that box and does no device arithmetic of
its own. The page takes every layout decision from the `compact` boolean `useRyotViewport()` reports,
never a `md:` utility: a media query inside the iframe measures the iframe, which is the window minus
the kernel's sidebar, so between roughly 768px and 1032px it would draw the compact layout inside the
desktop shell. That includes the hero, whose two art heights are the same decision.

Managed artwork loads through the authenticated client asset capability. `client.assets.resolve`
takes 1–64 locators, so the page canonicalizes and dedupes the locators a screen currently needs,
resolves them in chunks of 64, and refreshes each chunk shortly before its signed URLs expire. Remote
images load directly and are not batched.

A few affordances are deliberately inert pending real operation wiring: the monitoring toggle, Manage
collections, Log activity, Write review, View all images, and View complete history.

All five Show queries declare SDK entity interest. The show is foreground interest from the first
request; the selected season is also foreground for its episode query. Loaded collections, people,
companies, recommendations, seasons, and episodes are visible interest for the queries that display
them. Activity uses season IDs, watch-day episode IDs, and episode/collection entities referenced by
events, never event IDs. The SDK owns active-screen subscription handling and refresh scheduling.
Failed refreshes keep the last successful content and show a small retry status; initial failures
still use the query's error screen.

Interest is limited to loaded recipe results and their existing row limits, not every related entity
or an inferred dependency graph. Entity update hints can refresh those queries, but this does not
promise general realtime updates for mutations, events, relationships, or unloaded children.

Every row the Show page draws carries its own `populationStatus` and `translationStatus`, selected
once through `entitySyncSelection`, so the screen marks what is still arriving instead of drawing a
row that is indistinguishable from one that failed. The marks themselves come from
`@ryot-app/client-ui-sdk/sync` and are the same ones the kernel's saved views use: a shimmering art
well with a pip while a poster or still is still being fetched, a violet pip beside a name that is
still the provider's own language, a count line in each overview section header, and a settle ring
around the summary block when its work lands. `ManagedAssetImage` is only the adapter that resolves
a locator from context; the well, the monogram, and the animation belong to the SDK.

The settle ring fires on commit rather than on arrival: `useShowEntitySettle` stages an update when
the frame lands and the screen commits from an effect keyed on its query data, so nothing is marked
until the new values are actually on screen. The chip under the description says only that a
translation is in flight, because the plugin document is never told which language the reader
prefers — the bridge does not carry it, and naming a language the screen cannot read would be a
guess.

Workspace discovery, mutations, and progress/monitoring/library write flows beyond the Show page
remain deferred.

## Client source roots

- `backend/` is the sandboxed archived backend; it may import the sandbox SDK and `shared/`.
- `client/` is the archived client plugin; it may import the client SDK/UI packages and `shared/`.
- `shared/` is the plugin's neutral query layer: RyotQL recipes, lifecycle expression builders, and
  other logic both sides need. It may import only `@ryot-app/plugin-kit`, never `backend/` or
  `client/`. `shared/` is importable from the other two roots; the reverse is never allowed.

## Images

Media images use `{ type, url/key, purpose }`; remote assets use `url`, local and S3 assets use `key`, and `purpose` is required. Valid purposes are `cover`, `backdrop`, `profile`, `logo`, `still`, `screenshot`, and `artwork`.

Providers put the preferred foreground image at `images[0]` when one is available; otherwise, the first available image remains the default. Within each purpose, preserve provider order. URL deduplication retains the first classification. Localized image overlays may replace the complete `images` array for a language; an omitted overlay keeps the canonical images.

## Provider Details

Provider details normalize source-specific payloads into common entity properties and relationship groups. Consumers query those properties and relationships without branching on provider identity. Providers emit authoritative empty groups when a supported relationship category has no source data, allowing refresh to remove stale relationships; an empty group remains a valid result for consumers.

## Operations

Every media operation accepts a list and returns `results`. Per-item misses are values such as `status: "notFound"` or `entityId: null`, not operation failures.

`resolve-episodes` adds caller-assigned `index` to each input and echoes it in result. Calling workflow rejects duplicate, missing, or unexpected indexes; correlation never relies on result position. Other operations preserve positional alignment.

### Metadata Lookup

`metadata-lookup` verifies its integration uses `ryot_browser_extension`; kernel integration auth only establishes enabled integration and owner. It composes movie and show TMDB search scripts in-process, with movie first because result position contributes to match score.

### IGDB Search Choices

IGDB video-game search choices are provider-owned dynamic metadata loaded through `search-options` and cached by the backend.

### Episode Resolution

`resolve-episodes` builds one query document per reference. Query is rooted at episode entity and uses correlated parent traversals so filtering stays in PostgreSQL and each candidate appears once regardless of relationship count.

Exactly one candidate resolves; zero or ambiguous candidates return `null`. RyotQL applies executing-user visibility. Script must not fetch candidate episodes and filter them in memory.

### Media Monitoring

Status, enable, and disable accept at most 50 entity IDs. Their RyotQL document enforces global, provider-backed, monitorable, and visibility constraints. Monitoring status correlates the caller's visible `media-monitoring` relationship and reads its `targetEntityId` as the library identifier without loading an endpoint entity.

- Enable loads caller library and atomically creates `in-library` plus `media-monitoring` relationships.
- Disable removes only `media-monitoring`.
- Unsupported or invisible targets return `notFound` while results remain input-aligned.

Monitoring cron pages through the pinned `media-monitoring-targets` RyotQL script, deduplicates global monitored entity IDs, and invokes kernel provider population in refresh batches of at most 100. The system-scope script exposes global plugin-owned media and cross-user plugin-owned monitoring relationships, but no user-owned endpoint entity fields. Query access remains plugin-schema scoped in the pinned script; durable child dispatch stays in the workflow. Kernel uses concurrency four and deterministic index-derived child IDs.

## Imports

The Trakt importer accepts one of three explicit inputs:

- User mode: `{ source: "trakt", mode: "user", username }` imports the user's history, ratings, watchlist, lists, and collection.
- List mode: `{ source: "trakt", mode: "list", url, collection }` imports movies and shows from a public Trakt list into the named Ryot collection.
- Export mode: `{ source: "trakt", mode: "export", exportUploadToken: { token, expiresAt } }` imports a Trakt data-export ZIP without using the Trakt API.

List URLs must use `trakt.tv` or `www.trakt.tv` and the `/users/{username}/lists/{slug}` path. Query parameters, fragments, and a trailing slash are allowed. User and list imports require the configured `traktClientId` plugin setting; export imports do not.

Trakt export ratings and comments can target movies, shows, show seasons, or show episodes.

## Lifecycle

Media entities use six event schemas: `backlog`, `progress`, `complete`, `dropped`, `on_hold`, and `review`. `host/schemas/entity.ts` owns which event schemas and properties each entity supports.

Provider imports run `automation.media-library-membership-on-import` after provider population for every eligible media schema. The automation queries the importing user's library and idempotently creates `in-library`; it is separate from the event-based `policy.media-library-membership` that handles lifecycle and collection membership.

### Episode Tracking

Shows and podcasts record progress on `show-episode` and `podcast-episode`, not parent entities. Anime and manga store episode, volume, or chapter position on their own progress, dropped, and on-hold events. Complete events always represent whole entity and carry no episode fields.

Show-season completion is derived from its episodes and is not writable as a season event.

### Current State

State is derived from append-only history, never stored. All comparisons use descending `occurredAt`, `createdAt`, then `id` order so imported historical activity enters its correct chronological interval.

Shows and podcasts have exactly one current state:

- `untracked`: no parent or regular-episode lifecycle signal exists.
- `backlog`: the latest aggregate signal is a parent backlog event.
- `in_progress`: the latest signal is regular-episode progress or completion, but current-cycle coverage is incomplete.
- `on_hold`: the latest aggregate signal is a parent on-hold event.
- `dropped`: the latest aggregate signal is a parent dropped event.
- `caught_up`: the latest signal is regular-episode activity and current-cycle coverage is complete.
- `complete`: the latest aggregate signal is an authoritative parent completion.

Reviews do not participate in lifecycle state. Parent backlog, on-hold, dropped, and complete events interrupt episode-derived activity. A later regular-episode progress or completion resumes activity without an event-type priority.

An episode has one `untracked`, `in_progress`, or `complete` state from its latest progress or completion event. A progress event after completion therefore makes the episode `in_progress`.

### Aggregate Sessions and Cycles

The episodic session policy assigns `sessionEntityId` to the aggregate. Parent events use their own ID. Regular show-episode events use the show ID, podcast-episode events use the podcast ID, and season-zero special events have no parent session. Missing or ambiguous episode parents reject the event. Caller-supplied session values are always replaced.

The active consumption cycle starts strictly after the latest parent completion in the total event order. Child events at or before that boundary cannot contribute to current coverage. A later regular-episode event starts a new cycle without a persisted cycle entity or mutable state.

Show coverage considers only seasons with `seasonNumber > 0`. Coverage requires at least one regular season, at least one episode in every regular season, at least one required episode overall, and every required episode's latest current-cycle event to be complete. Season zero neither satisfies nor blocks parent coverage, and special activity affects only that episode.

Podcast coverage has the same cycle rules and requires at least one connected episode whose latest current-cycle event is complete. Required episodes come from current relationships without populated, publish-date, or release-date filters.

`dropped` and `on_hold` interrupt progress. Later progress resumes it. Progress after completion starts another consumption cycle; repeated completions are valid.

### Recording Flows

`progressPercent` is normalized with half-up rounding to two decimal places before validation.

- Historical completion: create one `complete` event with `completionMode: "custom_timestamps"` when dates are known, otherwise `"unknown"`. Set top-level `occurredAt` to historical completion time.
- Immediate completion: create one `complete` event with `completionMode: "just_now"`.
- Active tracking: begin with progress, append progress events, and finish with `progressPercent: 100`; use `dropped` or `on_hold` to stop early.

No preceding progress event is required for direct completion.

### Automatic Completion

`trigger.auto-complete-on-full-progress` runs after creation of progress event at 100 percent.

- Non-episodic media creates complete event immediately, reusing triggering `occurredAt` for event timestamp and `completedOn`.
- Anime and manga complete only when progress events cover every required episode or chapter. Empty or incomplete coverage does nothing.
- Coverage walks chronological progress and resets after full pass, allowing repeated completions for rewatches.

`consumedOn` is inherited through server-owned automation metadata.

Full show or podcast coverage first produces `caught_up`. It becomes `complete` automatically only when production status is `Ended`, `Canceled`, or `Cancelled`, matched case-insensitively. Unknown and continuing statuses remain caught up. A transition to a terminal status also evaluates existing caught-up coverage.

Automatic episodic parent completion runs only after a child completion or parent production-status transition. Relationship and season-number changes update derived coverage immediately but do not create a completion by themselves. The parent completion timestamp comes from the latest false-to-true coverage transition in the active cycle; repeated completion while already covered does not move it. A common nonempty `consumedOn` is copied only when every required episode completion agrees.

### Integration Progress Policy

`trigger.integration-progress-policy` applies only to integration-origin progress events. Its global manifest binding is disabled only with integration itself.

Policy order is:

1. Skip values below configured minimum.
2. Clamp values above configured maximum to 100.
3. Skip duplicate post-clamp progress for same consumption key.
4. Debounce repeated 100-percent progress within `scheduler.progressUpdateThresholdHours`, default two hours.

Consumption key combines `consumedOn` with relevant episodic subitem fields. Event sinks, not this policy, fill missing `occurredAt`; automatic completion reuses that timestamp.
