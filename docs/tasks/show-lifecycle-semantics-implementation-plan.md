# Show Lifecycle Semantics Implementation Plan

## Objective

Replace historical `eventExists` flags for shows and podcasts with one chronological lifecycle model that:

- Produces exactly one current parent state.
- Treats parent completion as an explicit consumption-cycle boundary.
- Lets later regular-episode activity start a new cycle.
- Lets parent `backlog`, `dropped`, and `on_hold` interrupt episode-derived activity.
- Does not combine episode completions from different cycles.
- Never infers completion from an empty episode set.
- Distinguishes `caught_up` from explicit or terminal-series `complete`.
- Keeps event history append-only and derives state at read time.

This is a greenfield breaking change. Do not retain the old recipe names, result fields, historical existence semantics, or compatibility adapters.

## Locked Decisions

No product decisions remain open for this implementation.

### Event order

Every lifecycle comparison uses this descending total order:

1. `occurredAt`
2. `createdAt`
3. `id`

Do not use `createdAt` as the primary order. This is required for historical imports.

### Parent lifecycle states

Use this public state union for shows and podcasts:

```ts
type EpisodicLifecycleState =
	| "untracked"
	| "backlog"
	| "in_progress"
	| "on_hold"
	| "dropped"
	| "caught_up"
	| "complete";
```

`review` is not a lifecycle event and never competes with these states.

The latest aggregate lifecycle signal determines state:

| Latest signal                                                               | Current parent state |
| --------------------------------------------------------------------------- | -------------------- |
| No signal                                                                   | `untracked`          |
| Parent `backlog`                                                            | `backlog`            |
| Parent `on_hold`                                                            | `on_hold`            |
| Parent `dropped`                                                            | `dropped`            |
| Parent `complete`                                                           | `complete`           |
| Regular episode `progress` or `complete`, incomplete current-cycle coverage | `in_progress`        |
| Regular episode `progress` or `complete`, complete current-cycle coverage   | `caught_up`          |

There is no hard-coded event-type priority. Chronology wins. A later regular-episode event resumes after `backlog`, `on_hold`, `dropped`, or `complete`. A later parent event interrupts episode activity.

### Consumption-cycle boundaries

Do not create a `media-consumption-cycle` entity and do not store mutable current state.

Use `event.sessionEntityId` to identify the episodic aggregate:

- A show parent lifecycle event uses `sessionEntityId = show.id`.
- A regular show-episode `progress` or `complete` event uses `sessionEntityId = show.id`.
- A podcast parent lifecycle event uses `sessionEntityId = podcast.id`.
- A podcast-episode `progress` or `complete` event uses `sessionEntityId = podcast.id`.
- A show special episode in season 0 has no parent session and does not affect parent state.
- Review events do not need a parent session.

Infer cycle boundaries from ordered parent `complete` events. For current-state reads and automations, the active cycle starts strictly after the latest parent `complete` in the full ordered history. Ignore child events at or before that boundary. If no parent completion exists, the cycle starts at the beginning of history.

This inferred boundary is intentional. It allows a backdated imported event to enter the correct chronological interval without rewriting existing events or assigning a persisted cycle ID.

### Episode state

Replace `hasProgress` and `isComplete` with one field:

```ts
type EpisodeLifecycleState = "untracked" | "in_progress" | "complete";
```

Resolve it from the episode's latest `progress` or `complete` event using the total order. A later progress event after completion therefore reports only `in_progress`.

Do not expose `hasEverProgressed` or `hasEverCompleted` in these detail recipes. Event history already provides historical facts, and no current in-repository consumer requires these booleans.

### Coverage

Show coverage uses regular seasons only:

- A regular season has `seasonNumber > 0`.
- At least one regular season must exist.
- Every regular season must contain at least one show episode.
- At least one required episode must exist overall.
- Every required episode's latest `progress` or `complete` event after the cycle boundary must be `complete`.
- A later `progress` after an episode `complete` removes that episode from current-cycle coverage.
- Season 0 and its episodes neither satisfy nor block parent coverage and do not drive parent state.

Podcast coverage requires at least one episode, and every episode must be currently complete after the cycle boundary.

A required episode is every episode entity currently connected through the applicable show-season or podcast relationship. Do not filter required episodes by `entity.populatedAt`, publish date, or release date.

### Caught up and complete

`caught_up` means current-cycle episode coverage is complete but no authoritative parent completion currently closes the cycle.

Parent `complete` is authoritative regardless of episode history. It may be manual, imported, or automatic.

Automatic parent completion is allowed only for terminal media. Normalize production status case-insensitively and treat these values as terminal:

- `Ended`
- `Canceled`
- `Cancelled`

Unknown or any other status remains `caught_up` after full coverage. Do not guess that an unknown status is terminal.

When a caught-up show or podcast changes to a terminal production status, create its parent completion automatically. This handles metadata reaching `Ended` after the user already watched all episodes.

Automatic parent completion is evaluated only after a child `complete` event or a parent production-status transition. Relationship changes, season-number changes, and episode removal may alter derived coverage but do not emit a parent completion by themselves. They still update the derived state immediately. A later bound event or explicit manual completion can close the parent.

### Season completion

Remove the `complete` event schema from `show-season`. Season completion is derived from its episodes and is not an independently writable lifecycle state. No current implementation consumes parent season completion events.

### Podcast parity

Apply the same lifecycle and cycle rules to podcasts in the same change. The current podcast recipes have the same historical-existence defects. Leaving them unchanged would create two incompatible meanings for episodic lifecycle state.

## Existing Code to Replace

The problematic code is in `plugins/media/query-recipes.ts`:

- `eventExists` at lines 52-60 performs historical existence checks.
- `showSeasonInclude` at lines 69-128 independently selects `hasProgress` and `isComplete`.
- `episodeCount` and `showRegularSeasonCount` at lines 165-229 permit empty `0 == 0` coverage.
- `inProgressShowsRecipe` at lines 258-320 permanently excludes any parent with any completion.
- `completedShowsRecipe` at lines 322-387 ignores parent completion and current episode state.
- `podcastProgressRecipe` at lines 406-495 repeats the same defects.

Delete these helpers and recipes instead of adapting them.

## Implementation Steps

### 1. Add reusable chronological event expressions

Update `packages/ryotql-recipes/src/events.ts` and `packages/ryotql-recipes/src/events.test.ts` with generic builders used by both application recipes and sandbox recipes:

- `eventOrderDescending(event)` returning descending `occurredAt`, `createdAt`, and `id` expressions.
- A lexicographic `eventIsAfter` predicate for comparing an event table row with another event row or selected boundary expressions.
- A `latestEventField` helper built with RyotQL `first(...)`, accepting the correlated `where`, selected field, and standard event order.

Keep these helpers domain-neutral. Do not put media slugs or lifecycle mapping in `@ryot/ryotql-recipes`.

Re-export only the helpers needed by sandbox code from `packages/sandbox-sdk/src/ryotql.ts`. Add or adjust SDK tests only if the export surface has focused coverage already.

The RyotQL executor already supports correlated `first(...)` with `ORDER BY ... LIMIT 1` in `apps/app-backend/src/modules/ryotql/executor.ts`; no query-language or executor extension should be necessary.

### 2. Add media lifecycle schemas and recipes

Create `plugins/media/operations/lifecycle-recipes.ts`. Import Effect Schema and RyotQL builders through `@ryot/sandbox-sdk/effect` and `@ryot/sandbox-sdk/ryotql` so the same recipes compile inside sandbox scripts.

Colocate each recipe's selected result schema, decoder, and decoded type in this file.

Implement configuration-driven helpers for the two aggregate kinds:

```ts
type EpisodicKindConfig =
	| {
			kind: "show";
			parentSchemaSlug: "show";
			episodeSchemaSlug: "show-episode";
			parentSeasonRelationshipSlug: "show-to-show-season";
			seasonEpisodeRelationshipSlug: "show-season-to-show-episode";
	  }
	| {
			kind: "podcast";
			parentSchemaSlug: "podcast";
			episodeSchemaSlug: "podcast-episode";
			parentEpisodeRelationshipSlug: "podcast-to-podcast-episode";
	  };
```

Show resolution additionally traverses `show-to-show-season` and `show-season-to-show-episode` and returns the season number.

Provide named recipes for:

- Resolving an episode to its parent aggregate and, for shows, its season number.
- Reading the latest aggregate lifecycle signal through `sessionEntityId`.
- Reading the latest parent completion boundary.
- Resolving one episode's latest `progress` or `complete` event after a boundary.
- Computing valid current-cycle coverage for list and detail queries.
- Returning required episode IDs and a typed, paginated stream of current-cycle child `progress` and `complete` events in ascending total order for automation replay.
- Reading the complete current parent lifecycle snapshot needed by query recipes and automations.

The lifecycle snapshot must include at least:

```ts
{
	state: EpisodicLifecycleState;
	coverageComplete: boolean;
	parentEntityId: string;
	boundaryCompleteEventId: string | null;
	coverageClosingEvent: {
		id: string;
		createdAt: string;
		occurredAt: string;
	} | null;
}
```

For automations, define `coverageClosingEvent` as the event for the most recent false-to-true coverage transition in the active cycle. A duplicate `complete` while coverage is already complete is not a closing event.

Derive it by replaying the paginated child-event stream in ascending `(occurredAt, createdAt, id)` order over the current required episode set. Track each required episode's latest state, record a closing event only when coverage changes from false to true, and clear coverage when later progress reopens an episode. At the closing transition, also retain the latest complete event for every required episode. Return `agreedConsumedOn` only when all those completion inputs contain the same nonempty `consumedOn` value.

Keep list and detail state filtering in RyotQL. Only automation closure detection uses chronological replay in the sandbox.

Stay within RyotQL's maximum correlated depth of three. For show coverage, use outer show -> regular-season aggregate -> episode aggregate -> sibling `first(...)` expressions. Do not nest the parent-boundary `first(...)` inside the episode-event `first(...)`. Instead, select the episode's latest lifecycle tuple and the parent's latest completion tuple independently, then require the episode tuple to be newer and its slug to be `complete`. A latest episode event at or before the parent boundary is uncovered. Podcast coverage uses the same shape without the season level.

Do not decode generic `RowItem` values in consumers. The recipe owns decoding and returns typed values.

### 3. Assign aggregate sessions during event policy evaluation

Create `plugins/media/scripts/automations/episodic-session-policy.sandbox.ts` and its adjacent test.

Manifest:

```ts
{
	kind: "automation",
	name: "Media Episodic Session Policy",
	slug: "policy.media-episodic-session",
	capabilities: ["executeRyotql"],
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
}
```

Behavior:

- Parent show or podcast lifecycle draft: replace `sessionEntityId` with its own entity ID.
- Show-episode progress or complete draft: resolve the parent show and season.
- Regular show episode: replace `sessionEntityId` with the parent show ID.
- Season 0 show episode: clear `sessionEntityId` by returning `null` in the replacement body.
- Podcast-episode progress or complete draft: replace `sessionEntityId` with the parent podcast ID.
- Missing or ambiguous parent relationship: skip the event with a clear reason rather than creating an event that cannot participate in deterministic state.
- Ignore reviews by not binding this policy to review event slugs.

Always replace caller-supplied session values. Do not trust an API, import, or integration to select another aggregate.

Register the policy in `plugins/media/manifest.ts` at a position after `trigger.integration-progress-policy` at position 100 and before `policy.media-library-membership` at position 1000. Use position 200.

Bind it to:

- `show:backlog`
- `show:complete`
- `show:dropped`
- `show:on_hold`
- `show-episode:progress`
- `show-episode:complete`
- `podcast:backlog`
- `podcast:complete`
- `podcast:dropped`
- `podcast:on_hold`
- `podcast-episode:progress`
- `podcast-episode:complete`

Update `plugins/media/script-catalog.ts` to register the script, and update `plugins/media/manifest.test.ts` to assert the bindings and position.

Because imports and integrations already create events through the standard event workflow, do not add import-specific session fields. The policy is the single assignment path.

### 4. Expose and preserve normalized event sessions

Event subscription snapshots currently omit the stored `sessionEntityId` and `createdAt`. Add both fields before changing completion automations.

Update:

- `packages/sandbox-sdk/src/automation.ts`
- `apps/app-backend/src/modules/events/event-create-workflow-live.ts`
- `apps/app-backend/src/modules/events/event-create-workflow-live.test.ts`
- `apps/app-backend/src/modules/automations/subscription-execution-workflow.ts`
- `apps/app-backend/src/modules/automations/subscription-execution-workflow.test.ts`
- `apps/app-backend/src/modules/entities/lifecycle-dispatch.ts`
- `apps/app-backend/src/modules/automations/lifecycle-dispatch.test.ts`
- `plugins/media/scripts/automations/automation-test-utils.ts`

Add optional `sessionEntityId` and required `createdAt` to `AutomationEventSnapshot` and `LifecycleEventSnapshot`. Add `sessionEntityId` to the local `CreatedEvent` schema and carry the policy-normalized stored value through lifecycle dispatch and subscription dispatch as `automation.source.after.sessionEntityId`.

Then update `plugins/media/scripts/automations/auto-complete-on-full-progress.sandbox.ts` and its tests. When 100 percent show-episode or podcast-episode progress creates the episode `complete` event, copy `event.sessionEntityId` into the generated event. The session policy will validate and normalize it again.

Do not change the existing anime and manga repeated-pass coverage behavior in this task.

### 5. Automatically close terminal episodic parents

Create one `plugins/media/scripts/automations/auto-complete-episodic-parent.sandbox.ts` automation and its adjacent unit test. Use one script for both child-completion events and parent production-status updates because `claimPersistentValue` keys are scoped by script ID; separate scripts with the same textual key would not coordinate.

Use this exact manifest:

```ts
{
	kind: "automation",
	name: "Auto-Complete Episodic Parent",
	slug: "automation.media-auto-complete-episodic-parent",
	capabilities: [
		"executeRyotql",
		"createEvents",
		"listEventSchemas",
		"claimPersistentValue",
	],
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
}
```

Bind this script as:

- An event subscription for `show-episode:complete`.
- An event subscription for `podcast-episode:complete`.
- An entity update automation for `show` alongside `automation.media-entity-updated`.
- An entity update automation for `podcast` alongside `automation.media-entity-updated`.

Branch on `automation.source.kind`.

For an episode-complete event:

1. Require the child event to have the resolved parent in `sessionEntityId`.
2. Load the current snapshot using the latest parent completion in full ordered history as the boundary.
3. Ignore a triggering child event at or before that boundary.
4. Replay current-cycle child events to derive the latest false-to-true `coverageClosingEvent`.
5. Return unless current state is `caught_up` and coverage is valid.
6. Return when production status is not terminal.

For a show or podcast entity update:

1. Read `before.properties.productionStatus` and `after.properties.productionStatus`.
2. Continue only when status changes from nonterminal or unknown to terminal.
3. Resolve and replay current-cycle coverage.
4. Return unless current state is `caught_up` and coverage is valid.

Both branches then use the same completion path:

1. Build claim key `media-parent-completion:<parentId>:<boundaryCompleteEventId-or-initial>`.
2. Call `claimPersistentValue` with that key and `PARENT_COMPLETION_CLAIM_TTL_SECONDS = 3600`.
3. Return when `claim.claimed` is false.
4. Reload and replay lifecycle state after obtaining the claim. Require it still to be `caught_up` with valid coverage.
5. Create a parent `complete` event with `sessionEntityId = parent.id`.
6. Set `occurredAt` and `completedOn` to the coverage-closing child event's `occurredAt`.
7. Set `completionMode: "custom_timestamps"` and include `consumedOn` only when replay returned one agreed nonempty value.

The one-hour claim serializes concurrent attempts. Subscription execution does not schedule a retry after failure or claim expiry. After failed event creation, only a later bound occurrence can retry once the claim expires. Once a parent completion exists, the post-claim full-history boundary check prevents a duplicate after expiry.

Register the script in `plugins/media/script-catalog.ts`, all four bindings in `plugins/media/manifest.ts`, and focused assertions in `plugins/media/manifest.test.ts`.

Do not merge this behavior into `media-entity-updated.sandbox.ts`; that script owns monitoring signals.

### 6. Replace detail and list query APIs

Refactor `plugins/media/query-recipes.ts` to consume the lifecycle expressions from `plugins/media/operations/lifecycle-recipes.ts`.

Detail recipe output changes:

- `showDetailRecipe` includes parent `state: EpisodicLifecycleState`.
- Each show episode includes `state: EpisodeLifecycleState`.
- `podcastDetailRecipe` includes parent `state: EpisodicLifecycleState`.
- Each podcast episode includes `state: EpisodeLifecycleState`.
- Remove `hasProgress` and `isComplete`.

Replace these exports:

- Remove `inProgressShowsRecipe`.
- Remove `completedShowsRecipe`.
- Remove `inProgressPodcastsRecipe`.
- Remove `completedPodcastsRecipe`.
- Remove their result types.

Add:

```ts
showsByLifecycleStateRecipe({ state, entityId?, after?, limit? })
podcastsByLifecycleStateRecipe({ state, entityId?, after?, limit? })
```

Both recipes return identity fields plus the resolved `state`. Filtering must happen in the RyotQL document before pagination; do not fetch a page and filter in the recipe map.

Support every state in `EpisodicLifecycleState`, including `untracked`, so callers need no separate historical predicates.

Keep the lifecycle state schema and decoded type colocated with the recipes that own the result. If both operation and public query recipes need the type, define it once in `plugins/media/operations/lifecycle-recipes.ts` and import it.

No app-client production consumer currently imports the four removed list recipes. The only in-repository consumers to update are tests under `tests/src/tests/plugins/media/query-recipes-results.test.ts`.

### 7. Remove writable show-season completion

Update `plugins/media/schemas/entity-schemas.ts`:

- Change `show-season.eventSchemas` from `[complete]` to `[]`.

Update manifest/schema tests that snapshot or enumerate event schemas. Do not add a replacement season event.

### 8. Add chronological query indexes and migration

Update `apps/app-backend/src/lib/infrastructure/db/schema/tables/events.ts`:

- Replace `event_user_entity_schema_slugx` with a correctly named composite index covering `userId`, `entityId`, `eventSchemaSlug`, `occurredAt DESC`, `createdAt DESC`, and `id DESC`.
- Add `event_user_session_order_idx` covering `userId`, `sessionEntityId`, `occurredAt DESC`, `createdAt DESC`, and `id DESC`.

Keep the simple indexes unless `EXPLAIN` shows they are redundant for existing non-lifecycle access patterns. Do not remove unrelated indexes speculatively.

From `apps/app-backend`, run:

```sh
bun run db:generate
```

Commit the generated migration under `apps/app-backend/src/drizzle/`. There is no production data to backfill. Do not add a session backfill or compatibility migration.

### 9. Update documentation

Update `plugins/media/README.md`:

- Define the seven parent states.
- State that reviews do not participate in lifecycle state.
- Define aggregate sessions through `sessionEntityId`.
- Define inferred cycle boundaries from ordered parent completions.
- Define regular-season coverage and all nonempty guards.
- Define specials as episode-only state.
- Define `caught_up` versus `complete` and terminal production statuses.
- Document that show-season completion is derived and not writable.
- Document podcast parity.

Update the lifecycle decision in `docs/decisions.md` where it describes event-derived media state. Keep rationale in that document and operational details in the plugin README.

## Required Tests

### Generic chronological helpers

In `packages/ryotql-recipes/src/events.test.ts`, assert the exact three-column order and lexicographic comparison shape. Do not test TypeScript-only passthrough behavior.

### Session policy unit tests

In `plugins/media/scripts/automations/episodic-session-policy.test.ts`, cover:

- Parent show event assigns itself.
- Parent podcast event assigns itself.
- Regular show episode resolves and assigns its show.
- Season 0 episode clears a supplied session.
- Podcast episode resolves and assigns its podcast.
- Supplied incorrect session is replaced.
- Missing parent skips with a stable reason.

### Parent auto-completion unit tests

In `plugins/media/scripts/automations/auto-complete-episodic-parent.test.ts`, cover:

- Incomplete coverage creates nothing.
- Zero regular seasons creates nothing.
- Only season 0 creates nothing.
- One empty regular season creates nothing.
- One complete season plus another empty season creates nothing.
- Nonterminal full coverage remains caught up and creates nothing.
- Unknown production status remains caught up.
- Terminal full coverage creates one parent completion.
- Parent completion timestamp comes from the coverage-closing child event.
- Rewatch coverage ignores episode completions before the latest parent completion.
- Episode complete followed by later episode progress is not covered.
- A duplicate episode completion while already caught up is not a new coverage-closing event.
- Concurrent final-candidate simulation uses one claim key and creates one parent event.
- Podcast requires a nonempty complete episode set.
- Continuing to Ended completes a caught-up parent.
- Unknown to Canceled completes a caught-up parent.
- `Cancelled` spelling is terminal.
- Status case does not matter.
- Nonterminal to nonterminal does nothing.
- Terminal transition with incomplete coverage does nothing.
- Terminal transition while current state is on hold or dropped does nothing.
- A terminal metadata transition uses the prior coverage-closing event rather than the entity update time.
- A terminal transition while on hold followed by a later child completion resumes to caught up and creates the parent completion.

### Event snapshot plumbing tests

In `apps/app-backend/src/modules/events/event-create-workflow-live.test.ts`, `apps/app-backend/src/modules/automations/lifecycle-dispatch.test.ts`, and `apps/app-backend/src/modules/automations/subscription-execution-workflow.test.ts`, assert that the stored, policy-normalized `sessionEntityId` and event `createdAt` reach `automation.source.after` unchanged.

### Query recipe live tests

Replace the historical flag assertions in `tests/src/tests/plugins/media/query-recipes-results.test.ts` and split lifecycle scenarios into a focused file if the existing file becomes unwieldy.

Cover the complete transition matrix with explicit `occurredAt` values:

1. No events is only `untracked`.
2. Episode progress is only `in_progress`.
3. Parent on hold after progress is only `on_hold`.
4. Progress after on hold is only `in_progress`.
5. Parent dropped after progress is only `dropped`.
6. Progress after dropped is only `in_progress`.
7. Manual parent complete without episode completions is only `complete`.
8. Progress after parent complete is only `in_progress`.
9. Full regular-episode coverage on a continuing show is only `caught_up`.
10. Full coverage on an ended show eventually creates parent completion and is only `complete`.
11. A complete first cycle followed by one completed rewatch episode remains `in_progress`, not caught up or complete.
12. A full second cycle produces a second parent completion.
13. Episode complete at T1 followed by progress at T2 yields episode `in_progress` only.
14. Backdated creation order does not beat newer `occurredAt`.
15. Equal `occurredAt` uses `createdAt` deterministically in live persistence tests. Assert the final `id` tie-break in the exact RyotQL order-expression unit test because supported event APIs do not let a live test control `createdAt`.
16. No seasons, only specials, and an empty regular season never report coverage.
17. Special episode activity changes only that episode state, not the show state.
18. Podcast state follows the same parent interruption, manual completion, caught-up, and rewatch rules.
19. Removing a required relationship can change derived coverage to caught up but does not emit an automatic parent completion without a later bound event.

For each parent-state transition, execute `showsByLifecycleStateRecipe` or `podcastsByLifecycleStateRecipe` for all competing states and assert the entity appears in exactly one result. Do not only assert that one expected list contains it.

Also assert detail recipe output contains one `state` field and no `hasProgress` or `isComplete` fields.

### End-to-end policy tests

Extend the live media event tests under `tests/src/tests/plugins/media/events/`:

- Creating regular show-episode progress persists `sessionEntityId = show.id`.
- Creating a special episode event leaves `sessionEntityId` absent.
- Creating parent hold, dropped, and complete persists `sessionEntityId = parent.id`.
- Imported and integration-origin episode events pass through the same assignment policy.
- A 100 percent regular episode progress creates an episode completion with the same session.

Keep sandbox behavior tests in the plugin package and production-path persistence tests in `tests/src/tests/plugins/media/`.

## Validation Commands

Run focused checks first, then package checks:

```sh
bun turbo --filter=@ryot/ryotql-recipes test --only -- 'src/events.test.ts'
bun turbo --filter=@ryot/media-plugin test --only -- 'manifest.test.ts'
bun turbo --filter=@ryot/media-plugin test --only -- 'scripts/automations/episodic-session-policy.test.ts'
bun turbo --filter=@ryot/media-plugin test --only -- 'scripts/automations/auto-complete-episodic-parent.test.ts'
bun turbo --filter=@ryot/media-plugin test --only -- 'scripts/automations/auto-complete-on-full-progress.test.ts'
bun turbo --filter=@ryot/app-backend test --only -- 'src/modules/events/event-create-workflow-live.test.ts'
bun turbo --filter=@ryot/app-backend test --only -- 'src/modules/automations/lifecycle-dispatch.test.ts'
bun turbo --filter=@ryot/app-backend test --only -- 'src/modules/automations/subscription-execution-workflow.test.ts'
bun turbo --filter=@ryot/tests test --only -- 'src/tests/plugins/media/query-recipes-results.test.ts'
bun turbo --filter=@ryot/tests test --only -- 'src/tests/plugins/media/events/automations.test.ts'
```

Then run package-wide tests:

```sh
bun turbo --filter=@ryot/ryotql-recipes test
bun turbo --filter=@ryot/media-plugin test
bun turbo --filter=@ryot/app-backend test
```

For `@ryot/tests` final acceptance, run each changed standard test file separately with the documented form:

```sh
bun turbo --filter=@ryot/tests test --only -- '<changed-standard-test-file>'
```

Run required checks:

```sh
bun turbo --filter=@ryot/ryotql-recipes check
bun turbo --filter=@ryot/media-plugin check
bun turbo --filter=@ryot/app-backend check
bun turbo --filter=@ryot/tests check
```

The backend commands are mandatory because the event table and compiled sandbox runtime change. Do not report completion if migration generation, sandbox compilation, focused lifecycle tests, or backend checks fail.

## Done Criteria

- Every show and podcast appears in at most one current lifecycle-state query.
- Current state follows the ordered latest signal, not historical existence.
- Manual parent completion is authoritative.
- Parent hold and dropped events interrupt episode activity.
- Later regular-episode activity resumes after parent interruption or completion.
- Rewatch coverage never reuses completions from a prior cycle.
- Empty, specials-only, and empty-regular-season shows cannot become caught up or automatically complete.
- Continuing and unknown-status media become caught up, not automatically complete.
- Terminal full coverage observed after a child completion or production-status transition emits an authoritative parent completion.
- Detail APIs expose one current state instead of contradictory booleans.
- Show-season completion is no longer writable.
- Event indexes match entity and aggregate chronological queries.
- README, decision record, manifest, script catalog, migration, unit tests, and live tests agree with the implementation.
