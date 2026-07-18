# Media Plugin

Media plugin owns media schemas, relationships, saved views, providers, operations, automations, and bindings. Generic plugin manifest and sandbox mechanics live in `@ryot/plugin-kit/README.md`.

## Operations

Every media operation accepts a list and returns `results`. Per-item misses are values such as `status: "notFound"` or `entityId: null`, not operation failures.

`resolve-episodes` adds caller-assigned `index` to each input and echoes it in result. Calling workflow rejects duplicate, missing, or unexpected indexes; correlation never relies on result position. Other operations preserve positional alignment.

### Metadata Lookup

`metadata-lookup` verifies its integration uses `ryot_browser_extension`; kernel integration auth only establishes enabled integration and owner. It composes movie and show TMDB search scripts in-process, with movie first because result position contributes to match score.

### Episode Resolution

`resolve-episodes` builds one query document per reference. Query is rooted at episode entity and uses correlated parent traversals so filtering stays in PostgreSQL and each candidate appears once regardless of relationship count.

Exactly one candidate resolves; zero or ambiguous candidates return `null`. Query engine applies executing-user visibility. Script must not fetch candidate episodes and filter them in memory.

### Media Monitoring

Status, enable, and disable accept at most 50 entity IDs. Shared query enforces global, provider-backed, monitorable, and visibility constraints.

- Enable loads caller library and atomically creates `in-library` plus `media-monitoring` relationships.
- Disable removes only `media-monitoring`.
- Unsupported or invisible targets return `notFound` while results remain input-aligned.

Monitoring cron pages through pinned `activity.media-monitoring-targets` query, deduplicates global monitored entity IDs, and invokes kernel provider population in refresh batches of at most 100. Query access stays in activity; durable child dispatch stays in workflow. Kernel uses concurrency four and deterministic index-derived child IDs.

## Lifecycle

Media entities use six event schemas: `backlog`, `progress`, `complete`, `dropped`, `on_hold`, and `review`. `schemas/entity-schemas.ts` owns which event schemas and properties each entity supports.

### Episode Tracking

Shows and podcasts record progress on `show-episode` and `podcast-episode`, not parent entities. Anime and manga store episode, volume, or chapter position on their own progress, dropped, and on-hold events. Complete events always represent whole entity and carry no episode fields.

### Current State

State is derived, never stored. Latest event of each type is ordered by `occurredAt`, then `createdAt`, then `id`. Event type is current when its latest event is newer than every competing lifecycle type.

`dropped` and `on_hold` interrupt progress. Later progress resumes it. Progress after completion starts another consumption cycle; repeated completions are valid.

### Recording Flows

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

### Integration Progress Policy

`trigger.integration-progress-policy` applies only to integration-origin progress events. Its global manifest binding is disabled only with integration itself.

Policy order is:

1. Skip values below configured minimum.
2. Clamp values above configured maximum to 100.
3. Skip duplicate post-clamp progress for same consumption key.
4. Debounce repeated 100-percent progress within `scheduler.progressUpdateThresholdHours`, default two hours.

Consumption key combines `consumedOn` with relevant episodic subitem fields. Event sinks, not this policy, fill missing `occurredAt`; automatic completion reuses that timestamp.
