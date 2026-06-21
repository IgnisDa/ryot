# Media Plugin

Media plugin owns media schemas, relationships, saved views, providers, operations, automations, and bindings. Generic plugin manifest and sandbox mechanics live in `@ryot-app/plugin-kit/README.md`.

Provider declarations explicitly identify their root entity schema. Saved views do not carry sandbox script declarations.

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

Media entities use six event schemas: `backlog`, `progress`, `complete`, `dropped`, `on_hold`, and `review`. `backend/schemas/entity-schemas.ts` owns which event schemas and properties each entity supports.

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
