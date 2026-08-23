# Media Plugin

The Media plugin owns media schemas, relationships, saved views, providers, operations, automations,
and authored lifecycle hooks. Generic package layout, manifest, and sandbox rules belong to the
[Plugin Kit](../../packages/plugin-kit/README.md). Provider declarations identify their root entity
schema; saved views do not declare sandbox scripts.

## Client

The plugin client supplies a workspace home and `show`, `anime`, `movie`, `music`, `book`, `manga`,
`podcast`, `audiobook`, `comic-book`, `visual-novel`, `video-game`, the six `*-group` schemas,
`person`, and `company` entity renderers. Person and company register only a detail page and keep the shared media row and card. Entity links
use `PluginLink` so the kernel resolves canonical entity routes.

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
partial. Episode counts cover the aired episodes and add the unaired ones as upcoming, so the summary
header reads e.g. "10/10 aired · 3 upcoming". Show season episodes list ascending and podcast
episodes newest first. "Next up" is not derived from a page: the summary resolves it server-side with
`episodicNextUpInclude` (see Lifecycle), and the episode list renders it at the head of the one
container that holds it - the matching season for a show, the feed for a podcast.
Show's activity coverage is one bar per season with specials last; podcast's is a single Episodes bar.

A show's episode orders (see Images And Providers) are presentational only. `showSeasonsRecipe`
returns them as `episodeOrders`; a picked order regroups the Episodes tab through
`showOrderEpisodesRecipe` and `showOrderGroupCoverageRecipe`, which select the show's episodes by
external id. Watch history stays on the `show-episode` entities, and next up, coverage, caught-up,
auto-complete, and activity keep the default seasons.

The Episodes tab offers an order picker ("Aired order" first, then each order) only when the show has
orders. The pick is per device in plugin storage under `episode-order:<showEntityId>`, holding the
order's `externalId`; aired order, or a stored id the show no longer offers, removes the key. The tab
reads storage before it queries the seasons. A picked order replaces the season chips with its groups,
heads each group with its coverage, and pages the group's episode ids by offset in group order, each
row labelled with its origin season and episode. Next up appears only in aired order.

Podcast providers (iTunes and ListenNotes) emit no person or company credit relationships, so its
credits arrive as `unlinkedCreators`, the way Book's and Audiobook's do. They also ship cover art only - no backdrops,
and episode artwork is square `cover` rather than show's `aspect-video` `still` - so the podcast hero
uses art height at both widths.

Movie, Music, Book, Manga, Anime, Audiobook, Comic Book, Visual Novel, and Video Game are flat,
non-episodic schemas. Each is one `mediaFlatRecipes` config in `shared/<slug>-recipes.ts` - the fields
its entity schema declares and a measure for activity totals - and one `defineFlatMediaSchema`
descriptor in `client/<slug>/schema.tsx` holding its copy, facts, artwork aspect, and hero height.
`mediaSummaryHeaderDetail` places the provider rating before the descriptor's facts and the production
status after them, for flat and episodic schemas alike. Every descriptor takes its aspect from
`mediaSchemaAspects`, and both the header art and the recommendation tiles follow it, so Music,
Podcast, and Audiobook render square there. The factories build the summary, overview, activity, and
presentation recipes, queries, screen, and row and card presentations. A schema needing a query
beyond the shared overview set adds it through `extraOverviewQueries` on its config rather than
re-wrapping the recipe. Measures come from
`mediaTimeSpentMeasure`, with an optional entity fallback, or `mediaEntityCountMeasure`. Every flat
summary recipe returns `{ summary, entitySchemaSlug }`, and every activity recipe returns
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
overview's managed-asset set. A schema whose entity has no group at all - Manga and Anime - declares
neither `groupSlug` nor `group` copy, so no group query is issued and the section is never built.

The shared activity event selection covers the fields every flat schema records. A schema that stores
its own position on lifecycle events declares `activityEventFields` on its `mediaFlatRecipes` config;
those fields are appended to the event selection and reach the descriptor's progress row label as its
second argument.

Movie and Music measure activity in minutes, falling back to runtime or `duration / 60` when a
completion records no time spent; Music renders `duration` (seconds) as `m:ss`. Music and Book
providers ship only cover art, so their heroes use art height at both widths.

A schema whose providers store credits without a linked entity declares
`mediaUnlinkedCreatorsOverviewQueries` as its `extraOverviewQueries`. Both engines read the resulting
`creators` overview key and add its `unlinkedCreators` to the credit rails as non-clickable tiles -
`Publisher` with the companies, every other role with the people - and they do not count toward sync
marks. Book, Audiobook, and Podcast declare it.

Book measures pages: its total sums the book's `pages` over completions and renders as `640+` when a
completed book has no page count. The group section names the book series.

Manga measures chapters: its total sums the manga's `chapters` over completions and renders as `120+`
when a finished manga has no chapter count. Both importers write one progress event per chapter, so
its activity rows name the recorded position - "Volume 3, Chapter 45", "Chapter 45", or "Volume 3" -
and fall back to the percent phrasing only when neither was recorded. None of its three providers
(AniList, MyAnimeList, MangaUpdates) emits person or company credits, so both rails render empty and
stay hidden, and manga issues no `unlinkedCreators` query to fill them. Only AniList ships a banner,
so the manga hero uses art height at both widths and keeps the default `backdrop` purpose.

Anime measures episodes: its total sums the anime's `episodes` over completions and renders as `24+`
when a finished anime has no episode count. No provider emits anime episodes as entities, so the
schema is flat and its progress lives on its own lifecycle events; both importers write one per
episode, so its activity rows name the recorded episode - "Episode 12" - and fall back to the percent
phrasing only when none was recorded. AniList emits studio credits and MyAnimeList emits none, and
neither emits person credits, so the cast rail renders empty and stays hidden. Its overview adds an
"Airing schedule" section through `overviewTrailing`. AniList stores the full schedule, every aired
episode included, so the section keeps only entries still to air, orders them soonest first, caps them
at six, and hides itself when none remain, which also drops MyAnimeList's single premiere-dated entry
once it has passed; the first of those entries is also the summary's next-episode fact. Only AniList
ships a banner, so the anime hero uses art height at both widths.

Audiobook measures time like Movie, falling back to `runtime` when a completion records no time
spent. Audible emits Author and Narrator person credits, `unlinkedCreators` for contributors without
an ASIN, and no company credits, so the companies rail stays hidden. It ships square covers and no
backdrops, so the hero uses art height at both widths. The group section names the audiobook series.

Comic Book measures pages like Book, and the group section names the comic book series. Metron emits
person credits and no company credits or `unlinkedCreators`, so the companies rail stays hidden and
no creators query is issued. It ships covers only, so the hero uses art height at both widths.

Visual Novel measures time, falling back to `lengthMinutes` when a completion records no time spent,
and reads with the "read" verb. It has no group. VNDB developers are stored as person credits with the
`Developer` role, so the people rail is titled "Developers". Its screenshots appear only in the
overview gallery, not as a backdrop, so the hero uses art height at both widths.

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

### Groups

`movie-group`, `audiobook-group`, `book-group`, `comic-book-group`, `music-group`, and
`video-game-group` are groups: each is one `mediaGroupRecipes` config in `shared/<slug>-recipes.ts`
over its member's `mediaFlatRecipes`, and one `defineGroupMediaSchema` descriptor in
`client/<slug>/schema.tsx`. The member schema comes from `mediaGroupMemberSlugs`, and members hang
off the group through `<group>-to-<member>`. The tab set is `<Members> | Overview | Activity`, and
the screen opens on Members.

Members are a cursor-paged top-level row query with Load more, like episode lists, because a comic
series can hold hundreds of issues. They are ordered by the relationship `order`, then name, then ID,
and each row is the member schema's own flat row with its `order` as a leading position.

A group records no lifecycle of its own, so the header status is "N of M <verb>": M counts the linked
members and N those with at least one `complete` event, both aggregated on the group row. The status
row is hidden when the group has no members. `parts` is a separate fact, and rows and cards show the
same two labels.

Most group providers (Audible, Hardcover, Metron, IGDB) ship no images. When a group's own `images` is
empty, the recipe replaces it with the `cover` images of its first member by `order`, so the header,
hero, gallery, managed assets, rows, and cards all read the same artwork.

The overview holds the gallery and, for `creatorGroupTargetSlugs` only, the person and company credit
columns; those credits never select `character`. A group without credits issues no overview query.
When the overview has neither images nor credits, it shows a "Nothing more to show" notice. Activity
is the group's own reviews and collection changes, the same as creators.

### Creators

Person and Company are creators: each is one `mediaCreatorRecipes` config in
`shared/<slug>-recipes.ts` and one `defineCreatorMediaSchema` descriptor in `client/<slug>/schema.tsx`,
with a fixed `Overview | Activity` tab set. A creator is the source of its credit relationships
(`person-to-<target>`, `company-to-<target>`), so the overview reads them in reverse. It is one query
over the creator row with one include per target schema, each correlated to the creator as the
relationship source and joined on the target, because a RyotQL document allows at most 10 named
queries and there are 13 targets. A missing creator decodes as an empty page for every target. Each
target is its own rail, titled and ordered by `client/creator/credit-sections.ts`: Movies, Shows,
Anime, Books, Comic books, Manga, Visual novels, Video games, Game collections, Albums, Tracks,
Audiobooks, Podcasts. Tiles take
their target schema's aspect from `mediaSchemaAspects`. Empty rails are hidden, the overview reads as
empty only when every rail is, and its loading and error notices are titled "Credits".

Media credits sort newest `publishYear` first with unknown years last, then by name and ID. Group
targets (`music-group`, `video-game-group`) declare no year, so their credits sort by name and ID and
never select `publishYear`. Each rail loads 12 credits and offers "View all" only when the query
reports more. A tile names the credit's roles, then "as <character>"; the character is selected only
on `person-to-<media>` credits.

Activity counts reviews alone - creators carry no lifecycle - and merges the creator's collection
events newest first, loading 60 of each. Its figures are Reviews plus the Span, or Latest when either
list was truncated, and the empty state offers "Write review". The action rail is Monitoring, In
library, Collections, and Write review; there is no status, ownership, or Log activity.

The header has no rating or production status. Person facts are Born (with age while alive), Died
(with the age at death), Birthplace, and Gender; a partial provider date stays as written and gets no
age, as does a date after today. Company facts are Founded and Headquarters. Links are Website and
"<provider> page", shown only for http(s) addresses, and
alternate names render as at most four chips. Person profile art is 2:3; a company logo is square and
contain-fit. Both use the art-height, tint-only hero.

Layout uses only the `compact` value from `useRyotViewport()`, not responsive Tailwind variants,
because iframe media queries measure the content frame rather than the kernel viewport. Hero art fills
the box sized by `ScreenFrame`; it declares art height below the bar and adds no safe-area or bar
offset.

Managed artwork uses `ManagedAssetProvider` and `useManagedAssetUrl` from
`@ryot-app/client-sdk/react`. The SDK deduplicates locators, resolves batches of at most 64, retains
resolved URLs while refreshing, and renews them before expiry. Media code only collects domain image
locators and adapts remote images, which load directly.

The workspace home reads cross-schema recipes from `shared/`. `shared/lifecycle-list-recipes.ts`
lists in-library media by lifecycle state, most recent lifecycle activity first:
`episodicByLifecycleStateRecipe` takes a show or podcast `EpisodicKindConfig` and carries the same
`nextUp` the summary resolves, and `flatByLifecycleStateRecipe` covers every flat builtin schema in
one query with its progress percent and the latest progress event's anime or manga position.
`shared/discovery-recipes.ts` holds `latestCompletionSuggestionsRecipe` - suggestions not yet in the
library from the latest completion that still has any, so an exhausted completion falls back to an
earlier one - and `trendingLatestMediaRecipe`, which reads each schema's own latest trending batch
and orders by rank then schema so the schemas interleave; the trending refresh ranks each schema from 1. Both drop NSFW titles but keep entities
whose `isNsfw` is unknown. `shared/airing-recipes.ts` returns one tile per show with its soonest
unwatched regular episode in a local date window and how many unwatched episodes share that date,
and anime whose airing schedule has an entry before an instant bound. Airing candidates are in the
library and either in progress (or caught up, for shows) or monitored through `media-monitoring`.
`shared/activity-recipes.ts` reads the activity section between two instants the client derives
from local midnights of the last 52 Monday-start weeks: completions of builtin media (episodes
excluded), their minutes from the event's `timeSpent` or else the entity's `runtime`, reviews, daily
counts of `progress` and `complete` events bucketed in the viewer's IANA time zone (`UTC` when `Intl`
reports none), and the same events per builtin media type, where an episode counts toward its
episodic parent through the `EpisodicKindConfig`s and the label is the entity schema's name.

Detail queries declare entity interest only for loaded recipe results: the subject entity and, for
Show, the selected season are foreground, while displayed related entities - collections, credits,
recommendations, group siblings, and an episodic parent's next-up episode - are visible. Activity declares entity IDs referenced by
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

Episode orders are TMDB-only and exist on `show` alone: TMDB's episode groups (original air date,
absolute, DVD, digital, story arc, production, TV). `episodeOrders` is a list of
`{ externalId, name, type, description, groups: [{ name, order, episodeExternalIds }] }` in TMDB's list
order, with groups and their episodes sorted by TMDB's `order`. Episodes are referenced by the same
provider external id as the `show-episode` entities rather than by season and episode number, because
an order's positions are its own and only the id joins it back to stored episodes. Orders of an unknown
type are dropped, and details always emit the property, so an empty array clears removed orders on
refresh.

Provider details normalize source data into common properties and relationship groups. Consumers do
not branch on provider identity. Supported relationship categories emit authoritative empty groups so
refresh can remove stale relationships.

## Operations

Media operations accept lists and return `results`. Per-item misses are values such as
`status: "notFound"` or `entityId: null`, not operation failures. Most operations preserve positional
alignment. `resolve-episodes` instead echoes caller-assigned unique indexes, and its workflow rejects
missing, duplicate, or unexpected indexes.

Demo sessions may read monitoring status and resolve episodes. Enabling or disabling monitoring is
protected. Integration-authenticated metadata lookup does not use demo access policy.

`metadata-lookup` accepts only the `ryot_browser_extension` integration. It composes movie and show
TMDB search with movie first because result position affects matching. IGDB game search options are
provider-owned dynamic metadata loaded through `search-options` and cached by the backend.

Episode resolution uses one RyotQL document per reference with correlated parent traversal. Exactly
one visible candidate resolves; zero or multiple candidates return `null`. Candidate filtering stays
in PostgreSQL rather than loading episodes for in-memory filtering.

Monitoring status, enable, and disable accept at most 50 entity IDs and enforce global,
provider-backed, monitorable, and user-visible targets, so the header hides the Monitoring toggle
for an entity without a provider. Enable atomically creates `in-media-library` and `media-monitoring`;
disable removes only `media-monitoring`; invalid or invisible targets return input-aligned
`notFound` results.

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

Media entities use `add-to-media-library`, `backlog`, `progress`, `complete`, `dropped`, `on_hold`, and
`review` events.
`host/schemas/entity.ts` defines support by entity type. State is derived from append-only history,
ordered by descending `occurredAt`, `createdAt`, then `id`; it is never stored separately.

The manifest declares stable lifecycle hook identities, and every media automation script declares a
minimal input projection. The kernel retains complete immutable trigger evidence, while each
invocation carries only the selected snapshot properties, parent properties, and derived
`changedProperties` required by that pinned script, plus authored `automation.hookMetadata`.
Ordinary RyotQL queries read current user data only and cannot recover omitted or historical
trigger-time values.

`media.ensure-media-library-membership` is a required after hook bound to library-member entity creation,
provider-entity-import completion, every media event except `add-to-media-library`, and
`collection:add-entity-to-collection`,
whose target comes from the event properties rather than its collection subject. The `media-library`
entity schema is not a library member, so workspace bootstrap never links the library to itself. Its
script upserts `in-media-library` with `changeUserRelationships`, which emits a child relationship trigger
only when the upsert changes state. `media.record-media-library-membership-event` is a required after hook
on new `in-media-library` relationships; it records `add-to-media-library` at the relationship creation time for
each media library member. Repeated idempotent upserts and existing memberships do not create another
event. Both declare `executionScope: "user"`, so global population plans no run for them at all.

`media.association` and `media.relationship-sync` declare `frequency: "batch"`. Each run receives one
projected chunk of a write's relationship changes in `payload.items` and filters them itself:
association selects `roles` and reads every credited entity in the batch with one current-state query,
while relationship sync acts on the item the kernel marked as the population batch leader. Retained
batch chunking is item-count based; the runtime enforces 64 KiB separately after each script's
projection.

`media.entity-updated` is an async after hook on entity updates. It reads the immutable population
context from `payload.population` - `rootPreviouslyPopulated`, `scopeEntity`, and the selected parent
`seasonNumber` - and emits monitoring signals for production-status, release-date, episode, season,
and image changes. Its projection selects the entity fields it reads and compares `images` with
`unordered-array` semantics, so reordering alone does not enter `changedProperties`. Current-state
queries cannot recover those trigger-time values, so the projection carries them.

`media.episodic-session` is a before-event policy. It projects no event properties and returns only a
validated event patch for `sessionEntityId`; it does not return a replacement request. Policy patches
are chained in deterministic hook order, and the kernel validates the final event draft before the
write.

Episodic parent auto-completion runs one script through two user-scoped hooks.
`media.auto-complete-episodic-parent` is required and targets only `show-episode:complete` and
`podcast-episode:complete`. `media.auto-complete-on-status-change` is async and targets the
`media.status.changed` signal, so a production status turning terminal fans out one run per
media-monitoring owner instead of a global run during population; the signal carries
`entitySchemaSlug` so the script can select show or podcast coverage.

`media.review-created` targets `review` events including `collection:review`; the radarr and sonarr
push hooks target `collection:add-entity-to-collection`. `media.notification`, `media.radarr-push`,
and `media.sonarr-push` read inline payloads and declare one attempt with no automatic external
retry.

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

Coverage is judged over aired episodes only, so `caught_up` is time-dependent: a show whose remaining
episodes have not aired reads `caught_up`, and reads `in_progress` again once one of them airs.

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

One episode display state, `episodeDisplayStateExpression`, drives the episode lists, the watched and
in-progress counts, and next-up. Once a new cycle has begun - a regular-episode progress or
completion after the parent's latest completion - it is the episode's current-cycle state; until then
it is the episode's lifetime latest state, so a completed show still lists what was watched and a
rewatch starts from a clean list. Season-zero specials have no parent session and sit outside cycles, so they
always show their lifetime latest state.

`episodicNextUpInclude` resolves next-up as a limit-1 include over the required episodes, judged by
display state: the `in_progress` episode wins (lowest position for a show, newest for a podcast).
Otherwise a show offers the lowest untracked episode positioned after its highest completed one,
compared on `(seasonNumber, episodeNumber)`, and has none without that anchor or with nothing after
it; untracked gaps before the anchor are skipped. A podcast offers its newest untracked episode.

The episodic session ID is the aggregate ID. Regular child events use their show or podcast parent;
season-zero specials have no parent session. Missing or ambiguous parents reject the event, and
caller-supplied session IDs are replaced.

The active cycle begins strictly after the latest parent completion. `episodicEpisodeQuery` defines
the required episodes once: for a show, the aired episodes of every regular season
(`seasonNumber > 0`); for a podcast, every currently related aired episode. An episode has aired when
its `publishDate` is on or before the server's UTC `currentDate()`; a null or malformed date counts as
aired. Coverage requires every required episode to have a latest current-cycle completion. Season zero
and seasons with nothing aired neither satisfy nor block coverage. Empty coverage is never complete.

Episodic parent auto-completion reads that state with one parent-rooted RyotQL snapshot query over
the same required episodes. For each required episode, the query selects the first completion after both the parent completion
boundary and that episode's latest progress. This preserves progress reopening and keeps duplicate
completions from moving the coverage-closing event without paging through raw event history. The
latest covering completion across episodes closes coverage, and `consumedOn` is copied only when all
covering completions agree on one non-empty value. The automation reads the snapshot again after its
completion claim, so a successful run makes two bounded RyotQL host calls.

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

Integration progress admission runs in `import.write-chunks`, after provider population and episode
resolution supply the event subject's entity ID and schema. It applies minimum filtering, maximum
clamping to 100, duplicate suppression by consumption key, and 100-percent debounce using
`progressUpdateThresholdHours` (default two hours). Numeric rounding remains `AppSchema.normalize`
behavior. Event sinks supply missing timestamps; automatic completion reuses the triggering timestamp.

The media-local chunk input carries optional `integration: { integrationId, importRunId }`, and
resolved episode events carry `subjectEntitySchemaSlug` alongside `subjectEntityId`. Admission uses
the latest matching progress event by entity, schema, `consumedOn`, and anime/manga subitem, including
events already admitted in this batch. Failed population remains an import failure.

Completion claims use the JSON-encoded array
`["media.integration-progress.v1", integrationId, entityId, entitySchemaSlug, "progress", consumedOn, subitemSignature]`.
The subitem signature keeps `animeEpisode`, `mangaVolume`, `mangaChapter` order with `key=value`
comma joining, and missing consumption or subitem values use empty strings. The stable integration ID
keeps debounce across import runs; import-run IDs are not claim-key parts. Persistent claims are
host-scoped by user and provider-or-script ID, so the user-scoped Redis key is
`ryot:sandbox:cache:user:<userId>:<writeChunksScriptId>:<JSON-encoded claim array>`. A denied claim
suppresses only when matching recent 100-percent history exists.

Media population carries the import's canonical lifecycle command and derives a deterministic
population item identity from the import command and group index. The kernel generic-import writer
derives entity, relationship, collection, and event command identities from the same root command.
The source item index and event index are preserved for attribution when admission filters events.
