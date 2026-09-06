# Media Plugin

The Media plugin owns media schemas, relationships, saved views, providers, operations, automations,
and bindings. Generic package layout, manifest, and sandbox rules belong to the
[Plugin Kit](../../packages/plugin-kit/README.md). Provider declarations identify their root entity
schema; saved views do not declare sandbox scripts.

## Client

The plugin client supplies a workspace home and `show`, `movie`, `music`, `book`, `podcast`, and
`video-game` entity renderers. Entity links use `PluginLink` so the kernel resolves canonical entity
routes.

`client/media/` owns everything the screens share and carries no schema copy.

Show and Podcast are episodic: the parent's state, coverage, and activity derive from its episodes.
Each is one `mediaEpisodicRecipes` config in `shared/<slug>-recipes.ts` and one
`defineEpisodicMediaSchema` descriptor in `client/<slug>/schema.tsx`, and gets a fixed
`Overview | Episodes | Activity` tab set. The only structural difference is where episodes hang:
show episodes hang off a season (`show-to-show-season` then `show-season-to-show-episode`), podcast
episodes hang off the parent (`podcast-to-podcast-episode`). `EpisodicKindConfig` in
`shared/lifecycle-expressions.ts` carries that difference, and `shared/episodic-recipes.ts` builds
every query from it.

Episode lists are cursor-paged top-level row queries with a Load more control, never nested includes,
because only a top-level rows query exposes `pageInfo.nextCursor`. Every page owns its query and its
managed assets, so Load more appends a page without refetching the ones on screen. Container-level
counts - a season header's episode and watched totals, a podcast's played count - come from the
container query's own aggregates, never from a loaded page, which would be wrong once the page is
partial. Show season episodes list ascending and offer the first untracked episode after the last
completed one as "Next up"; podcast episodes list newest first and offer the newest unplayed episode.
Show's activity coverage is one bar per season with specials last; podcast's is a single Episodes bar.

Podcast providers (iTunes and ListenNotes) emit no person or company credit relationships, so its
credits arrive as `unlinkedCreators`, the way Book's do. They also ship cover art only - no backdrops,
and episode artwork is square `cover` rather than show's `aspect-video` `still` - so the podcast hero
uses art height at both widths.

Movie, Music, Book, and Video Game are flat, non-episodic schemas. Each is one `mediaFlatRecipes` config in
`shared/<slug>-recipes.ts` - the fields its entity schema declares and a measure for activity totals -
and one `defineFlatMediaSchema` descriptor in `client/<slug>/schema.tsx` holding its copy, facts,
artwork aspect, and hero height. The factories build the summary, overview, activity, and
presentation recipes, queries, screen, and row and card presentations. Every flat summary recipe
returns `{ summary, entitySchemaSlug }`, and every activity recipe returns
`{ completionCount, consumedAmount, unknownAmountCount, truncated, events }`.

A schema selects only fields its own entity schema declares. `watchProviders` exists on `movie` and
`show` alone, so it lives in `mediaWatchProviderSelection`. A section that renders such a field is
descriptor-provided: the descriptor's `overviewTrailing` is called with the summary and the divider
state the overview computed, and it appends its sections after the relations. Movie and Show pass
`mediaWatchProvidersTrailing` for "Where to watch"; `client/media/` owns no schema-specific section.

A schema also declares which image purposes stand in for its hero backdrop, because not every
provider ships one. `backdropPurposes` is an ordered list and defaults to `["backdrop"]`; the first
purpose an image matches wins, and the same list drives the hero's managed-asset set.

Flat overviews add a "Part of" section listing the entity's group and its other members. The
relationship is authoritative from the group side, so the subject is excluded from its own rail, the
section is hidden when the group is absent or has no other members, and member covers join the
overview's managed-asset set.

Movie and Music measure activity in minutes, falling back to runtime or `duration / 60` when a
completion records no time spent; Music renders `duration` (seconds) as `m:ss`. Music and Book
providers ship only cover art, so their heroes use art height at both widths.

Book measures pages: its total sums the book's `pages` over completions and renders as `640+` when a
completed book has no page count. Book overviews add the entity's `unlinkedCreators` to the credit
rails as non-clickable tiles - `Publisher` with the companies, every other role with the people - and
they do not count toward sync marks. The group section names the book series.

Video Game measures `timeSpent` alone, with no fallback: `timeToBeat` is a community estimate of the
game, not a record of your play, so a completion with no recorded time stays unknown and the total
renders as `24h+`. Its overview adds two summary-sourced sections through `overviewTrailing` - "How
long to beat" showing the hastily, normally, and completely paces, and "Platforms" listing each
platform release with its date and region when the provider recorded them. The summary decodes the
whole `timeToBeat` object because all three paces are shown; rows and cards need one figure, so they
select `timeToBeat.normally` directly through the variadic property accessors in
`shared/entity-selections.ts`. Only `name` is guaranteed
there: Giant Bomb emits platform names alone, and the v10 migration strips null keys. Video games
ship cover art plus IGDB artwork rather than a backdrop, so the schema declares
`backdropPurposes: ["artwork"]` and gets the full backdrop hero at wide widths.

Layout uses only the `compact` value from `useRyotViewport()`, not responsive Tailwind variants,
because iframe media queries measure the content frame rather than the kernel viewport. Hero art fills
the box sized by `ScreenFrame`; it declares art height below the bar and adds no safe-area or bar
offset.

Managed artwork uses `ManagedAssetProvider` and `useManagedAssetUrl` from
`@ryot-app/client-sdk/react`. The SDK deduplicates locators, resolves batches of at most 64, retains
resolved URLs while refreshing, and renews them before expiry. Media code only collects domain image
locators and adapts remote images, which load directly.

Detail queries declare entity interest only for loaded recipe results: the subject entity and, for
Show, the selected season are foreground, while displayed related entities - collections, credits,
recommendations, and group siblings - are visible. Activity declares entity IDs referenced by
events, not event IDs. Update hints refresh active queries without promising general realtime updates
for unloaded data or arbitrary mutations.

The Show and Movie overviews read watch providers from their summary recipe and show only the viewer's region,
derived from `Intl`. The section is hidden when that region is unknown or does not carry the title,
because a global list answers no question the reader asked. Providers are grouped by offer kind in
contract order and named alphabetically within a group. TMDB sources this data from JustWatch, which
the section credits.

Rows select `populationStatus` and `translationStatus` through `entitySyncSelection`. Visual marks and
the missing-artwork surface come from `@ryot-app/client-ui-sdk/sync`; media wrappers do not own asset
batching, expiry, placeholders, or animations. Settle marks are committed after new query data renders.
Translation UI does not name the preferred language because the bridge does not expose it.

## Images And Providers

Media images use `{ type, url/key, purpose }`. Remote images use `url`; local and S3 images use `key`.
Purpose is one of `cover`, `backdrop`, `profile`, `logo`, `still`, `screenshot`, or `artwork`.

Providers place the preferred foreground image first when available, preserve provider order within
each purpose, and retain the first classification when URLs repeat. A localized overlay may replace
the complete image array; omission keeps canonical images.

Watch providers are TMDB-only and exist on `movie` and `show` alone; no other source exposes the
data. Every country TMDB reports is retained, because provider-populated entities are global and no
user region is known at population time; filtering by region belongs to the reader. An entry is one
country, holding TMDB's watch link for that country and the services carrying the title there, each
with how it is offered: `stream`, `free`, `ads`, `rent`, or `buy`. The property is country-rooted
because the link is a property of the country, not of a service. Countries are sorted, a country
naming no service is omitted, and offers keep that fixed order, so repeated population of unchanged
data produces an identical value.

Provider details normalize source data into common properties and relationship groups. Consumers do
not branch on provider identity. Supported relationship categories emit authoritative empty groups so
refresh can remove stale relationships.

## Operations

Media operations accept lists and return `results`. Per-item misses are values such as
`status: "notFound"` or `entityId: null`, not operation failures. Most operations preserve positional
alignment. `resolve-episodes` instead echoes caller-assigned unique indexes, and its workflow rejects
missing, duplicate, or unexpected indexes.

`metadata-lookup` accepts only the `ryot_browser_extension` integration. It composes movie and show
TMDB search with movie first because result position affects matching. IGDB game search options are
provider-owned dynamic metadata loaded through `search-options` and cached by the backend.

Episode resolution uses one RyotQL document per reference with correlated parent traversal. Exactly
one visible candidate resolves; zero or multiple candidates return `null`. Candidate filtering stays
in PostgreSQL rather than loading episodes for in-memory filtering.

Monitoring status, enable, and disable accept at most 50 entity IDs and enforce global,
provider-backed, monitorable, and user-visible targets. Enable atomically creates `in-library` and
`media-monitoring`; disable removes only `media-monitoring`; invalid or invisible targets return
input-aligned `notFound` results.

The monitoring cron pages the pinned target query, deduplicates global entity IDs, and refreshes
providers in batches of at most 100. The pinned query may expose global plugin-owned media and
cross-user monitoring relationships, but not user-owned endpoint fields. Durable child IDs are
deterministic and provider calls use concurrency four.

## Imports

The Trakt importer has three tagged modes:

- `user` imports a user's history, ratings, watchlist, lists, and collection.
- `list` imports a public `trakt.tv` user list into a named Ryot collection.
- `export` imports a Trakt export ZIP by upload token without calling Trakt.

User and list modes require `traktClientId`; export does not. List URLs allow only `trakt.tv` or
`www.trakt.tv` with `/users/{username}/lists/{slug}`. Export ratings and comments can target movies,
shows, seasons, or episodes.

## Lifecycle

Media entities use `backlog`, `progress`, `complete`, `dropped`, `on_hold`, and `review` events.
`host/schemas/entity.ts` defines support by entity type. State is derived from append-only history,
ordered by descending `occurredAt`, `createdAt`, then `id`; it is never stored separately.

Post-write media automations receive compact source references. They load the immutable trigger with
`automationOccurrenceRecipe(automation.occurrenceId)` through
`executeRyotqlRecipe(host.executeRyotql, ...)`; automations that need subscription metadata load
`automationRunRecipe(automation.runId)` through the same path when the run ID is present. These
occurrence snapshots preserve the trigger-time before/after values. Queries for lifecycle,
relationships, or entities instead read current state, which may have changed before the automation
executes. Media RyotQL should use explicit projections for only the fields the automation needs.

Provider imports run `automation.media-library-membership-on-import` after population and idempotently
create `in-library`. Membership uses the compact `provider-entity-import` reference directly because
it already contains the imported entity ID, schema slug, provider ID, and external ID; it does not load
the occurrence snapshot first. This is separate from the event-based
`policy.media-library-membership` used for lifecycle and collection changes.

Shows and podcasts track progress on child episodes. Anime and manga store episode, volume, or chapter
position on their own lifecycle events. Complete events represent the whole entity and carry no
episode fields. Show-season completion is derived and not directly writable. Reviews do not affect
lifecycle state.

For shows and podcasts, current state means:

| State                                       | Meaning                                                               |
| ------------------------------------------- | --------------------------------------------------------------------- |
| `untracked`                                 | No parent or regular-episode lifecycle signal                         |
| `backlog`, `on_hold`, `dropped`, `complete` | The latest aggregate signal has that state                            |
| `in_progress`                               | Latest regular-episode activity has incomplete current-cycle coverage |
| `caught_up`                                 | Latest regular-episode activity has complete current-cycle coverage   |

Flat, non-episodic media has no coverage to derive from, so its state is the slug of its latest
`backlog`, `progress`, `complete`, `dropped`, or `on_hold` event, with `progress` reading as
`in_progress` and no event at all reading as `untracked`. There is no `caught_up` state. Movie events
carry no `sessionEntityId` - `policy.media-episodic-session` assigns one only for shows, podcasts,
and their episodes - so the completion boundary for flat media is entity-scoped rather than
session-scoped, and the reported `progressPercent` is the latest progress strictly after that
boundary, or null when the only progress precedes it.

Parent aggregate signals interrupt episode-derived activity; later regular-episode progress resumes
it. An episode is `untracked`, `in_progress`, or `complete` from its latest progress/completion event.
Progress after completion starts another cycle.

The episodic session ID is the aggregate ID. Regular child events use their show or podcast parent;
season-zero specials have no parent session. Missing or ambiguous parents reject the event, and
caller-supplied session IDs are replaced.

The active cycle begins strictly after the latest parent completion. Show coverage requires every
episode in every regular season (`seasonNumber > 0`) to have a latest current-cycle completion; season
zero neither satisfies nor blocks coverage. Podcast coverage requires every currently related episode.
Empty coverage is never complete.

`progressPercent` uses half-up rounding to two decimals. Historical completion records
`completionMode: "custom_timestamps"` when dates are known, otherwise `"unknown"`; immediate
completion uses `"just_now"`. Direct completion needs no preceding progress event.

Progress at 100 percent automatically completes non-episodic media. Anime and manga complete only
after full required coverage, resetting coverage after each full pass to allow repeats. Shows and
podcasts first become caught up and auto-complete only when production status is `Ended`, `Canceled`,
or `Cancelled`, case-insensitively. Relationship changes recompute coverage but do not create a
completion by themselves. Parent completion time is the latest false-to-true coverage transition in
the active cycle; repeated evaluation while covered does not move it. `consumedOn` is copied only when
all required child completions agree on one non-empty value.

Integration-origin progress policy applies minimum filtering, maximum clamping to 100, duplicate
suppression by consumption key, then 100-percent debounce using
`scheduler.progressUpdateThresholdHours` (default two hours). Event sinks supply missing timestamps;
automatic completion reuses the triggering timestamp.
