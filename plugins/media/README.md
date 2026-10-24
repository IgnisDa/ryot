# Media Plugin

Media owns its schemas, relationships, views, providers, operations, and lifecycle hooks.
`shared/plugin-identity.ts` declares `ryot/media`. Generic authoring and execution contracts belong to
the [Plugin Kit](../../packages/plugin-kit/README.md); provider declarations identify their root
entity schema, while saved views reference client renderers rather than sandbox scripts.

## Client

`client/media/` contains schema-agnostic engines. Each schema configures a recipe factory in
`shared/<slug>-recipes.ts` and a descriptor in `client/<slug>/schema.tsx`:

| Family   | Recipes                | Descriptor                  | Pages                        |
| -------- | ---------------------- | --------------------------- | ---------------------------- |
| Flat     | `mediaFlatRecipes`     | `defineFlatMediaSchema`     | Overview, Activity           |
| Episodic | `mediaEpisodicRecipes` | `defineEpisodicMediaSchema` | Overview, Episodes, Activity |
| Group    | `mediaGroupRecipes`    | `defineGroupMediaSchema`    | Members, Overview, Activity  |
| Creator  | `mediaCreatorRecipes`  | `defineCreatorMediaSchema`  | Overview, Activity           |

Descriptors supply vocabulary, facts, artwork, and extra sections, not engine copies. Engine tests
live in `client/media/` and shared recipe tests; schema tests cover descriptor output.
`shared/media-schema-slugs.ts` owns builtin/group slug sets. `client/media/activity-copy.ts` owns
activity and progress verbs.

Activity tabs show a bounded summary. When older activity exists, View complete history opens the
shared detail modal with cursor-paged events. History merges entity, episode (for episodic media),
and collection events in descending occurrence/creation/ID order, using the last displayed event as
the boundary for every source. Episode history includes each completion and progress log, rather
than the summary's daily watches and latest progress milestones. Coverage truncation alone does not
expose the history button. History reuses the summary's row renderers and the shared SDK pagination.

Recipe extensions use `extraOverviewQueries`, `activityEventFields`, and
`mediaUnlinkedCreatorsOverviewQueries`. Extra relationship rails use `overviewRails`; their items
participate in visible IDs, managed assets, and emptiness checks. Summary-sourced sections use
`overviewTrailing`. Only Movie and Show select `mediaWatchProviderSelection` and render
`mediaWatchProvidersTrailing`. `mediaSummaryHeaderDetail` adds rating before descriptor facts and
production status afterward; creator headers have neither.

The canonical sync selection includes `relatedPopulationStatus`. While it is `pending` (and the base
population has not failed), the overview's relation sections (credits, companies, recommendations,
groups and extra rails) show their loading notice; when it is `failed` they show "Couldn't load" with
Try again, which retries the population through the kernel.

Header artwork purpose and aspect come from descriptors and `mediaSchemaAspects`. Detail screens
have no hero and register every managed image locator once, including images beyond the gallery
preview. Home airing tiles prefer episode stills, then backdrops, then covers. Managed URLs, expiry,
placeholders, and sync marks
come from the [client SDK](../../packages/plugin-client-sdk/README.md) and
[UI SDK](../../packages/plugin-ui-sdk/README.md#sync-marks), not media wrappers.

### Flat And Episodic Schemas

Show and Podcast derive parent state from episodes through `EpisodicKindConfig`. Shows traverse
seasons; podcasts traverse episodes directly. Episode lists are top-level cursor-paged queries,
never includes. Shared SDK pagination appends individual requests and preserves page-local asset
scopes; container counts come from aggregates rather than loaded pages. Show episodes ascend;
podcast episodes are newest first. Next-up resolves server-side
independently of loaded pages.

Show episode orders affect presentation only. A device-local `episode-order:<entityId>` preference
selects an order by external ID; default or missing orders clear the preference. Alternate orders
regroup and page episode IDs while retaining their original episode labels. Lifecycle, coverage,
and next-up always use default seasons; next-up appears only in aired order.

| Schema            | Activity measure                         | Distinct behavior                                                                  |
| ----------------- | ---------------------------------------- | ---------------------------------------------------------------------------------- |
| Movie             | Minutes, falling back to runtime         | Cover/backdrop and watch providers                                                 |
| Music             | Minutes, falling back to `duration / 60` | Stored duration is seconds, displayed `m:ss`; square cover                         |
| Book / Comic Book | Pages                                    | Book supports unlinked creators; Comic Book has person credits only                |
| Manga             | Chapters                                 | Cumulative chapter progress with optional volume; no group or creator credits      |
| Anime             | Episodes                                 | Episode progress; no group; future airing schedule, with next episode in summary   |
| Audiobook         | Minutes, falling back to runtime         | Author/Narrator credits, unlinked contributors, square cover                       |
| Visual Novel      | Minutes, falling back to `lengthMinutes` | No group; developer person credits; screenshots are gallery-only                   |
| Video Game        | Recorded `timeSpent` only                | Community time-to-beat is never consumed time; IGDB artwork appears in the gallery |

Flat summaries return `{ summary, entitySchemaSlug }`; activity returns completion count, consumed
amount, unknown count, truncation, and events. Unknown completion measures render lower-bound totals,
not zero. Anime/Manga progress labels use the latest recorded position; the in-progress percentage is
that position divided by the episode or chapter total when both are known, else the latest recorded
percentage.
`mediaTimeSpentMeasure` and `mediaEntityCountMeasure` own the shared calculations. Schemas without a
group omit both `groupSlug` and group descriptor copy. Unlinked credits appear as non-clickable
creator tiles and do not contribute sync marks.

Games use `video-game-to-video-game` from original to derivative. IGDB `version_parent` takes
precedence over `parent_game`; Bundle edges are omitted. Reverse lookups write outgoing groups
authoritatively unless their page cap truncates the result, in which case writes are additive.
Incoming groups remain authoritative. Overview rails group derivatives by relationship kind;
bounded ordering favors ports/remakes/remasters over mods/DLC. Game type is shown unless Main Game.
Time-to-beat fields may be absent; only platform names are guaranteed across providers.

### Groups

Groups use `mediaGroupMemberSlugs` and `<group>-to-<member>` relationships. Members are cursor-paged
by relationship order, name, and ID, using the member schema's presentation. A group has no lifecycle:
its completed/total label is aggregated over members, while Activity contains reviews and collection
changes. Empty groups hide completion status.

Without its own artwork, a group uses its first ordered member's covers consistently across all
presentations. `creatorGroupTargetSlugs` controls credit-bearing groups; other groups issue no
overview query. Group credits never select `character` or undeclared `publishYear`.

### Creators

Person and Company retain shared media cards/rows and supply detail pages. Their overview reads
source-side credit relationships in one creator-rooted document with an include per target, avoiding
the named-query limit. Rails are ordered/titled by `client/creator/credit-sections.ts`; media credits
sort by descending year, then name/ID, and yearless group credits by name/ID. Only person-to-media
credits select characters. Rails are bounded and expose View all when more results exist. View all
opens a cursor-paged credits modal. Media and group overviews use the same modal for their full
people lists, including unlinked contributors. Credit pages preserve overview ordering, roles, and
declared character fields. The credits and image gallery share the detail modal frame.

Creators have no lifecycle, ownership toggle, or Log activity action. Activity combines reviews and
collection changes. Person facts use provider birth/death data without inventing ages for partial or
future dates. Person art is portrait; company logos are square and contain-fit. Only HTTP(S) links
are rendered.

### Home And Refresh

Cross-schema home recipes live in `shared/`; `manifest/query-recipes.ts` owns saved-view data sources.

- `lifecycle-list-recipes.ts` lists library media by current state and recent activity, reusing
  canonical episodic next-up and flat progress.
- `discovery-recipes.ts` selects suggestions from the latest completion that still has suggestions
  and interleaves the latest per-schema trending ranks. Both exclude known NSFW entries.
- `airing-recipes.ts` selects library shows/anime that are progressing or monitored, using the
  caller's date/instant window.
- `activity-recipes.ts` aggregates completions, consumed minutes, reviews, and daily progress over
  52 local Monday-start weeks. Episode activity counts toward its parent; timezone falls back to UTC.

Entity interest covers loaded subjects/selected seasons as foreground and displayed related entities
as visible. Activity declares referenced entity IDs, not event IDs. Settle marks commit after fresh
data renders. Hints do not promise arbitrary realtime updates or freshness for unloaded data.

### Calendar Sources

`manifest/calendar-sources.ts` contributes four kernel Calendar sources, each limited to the user's media
library through the subject's `in-media-library` link:

- `show-episodes` and `podcast-episodes` list episodes on their `publishDate`, including season-0
  specials (`S0 · E1`); art falls back from the episode to its show or podcast, and done follows the
  episode display state.
- `anime-airings` expands `airingSchedule` with a `jsonElements` join. The entry at UTC midnight of
  the anime's `publishDate` is the release row, not an airing. An episode is done when the anime is
  complete or the latest progress/list-state `animeEpisode` reaches it.
- `releases` lists flat media by `publishDate`, captioned with the schema name; an anime with timed
  airings shows both its release and `Episode 1`.

## Images And Providers

### Genres

Root media links to `genre` entities through typed outgoing `<schema>-to-genre` relationships.
Genres have no lifecycle, library membership, monitoring, artwork, or detail page. Summary chips
read relationship targets; saved views filter by entity IDs with any/all/none and empty/not-empty
operators. Choice search uses existing visible links of the selected media type.

All metadata providers use the local `genre.media-catalog` provider. Its identities use Unicode
NFC, collapsed whitespace, lowercase names, and explicit aliases; punctuation is preserved.
Display names are deterministic, with canonical names for known genres. Details reconstruct names
locally without network calls; search offers a small built-in set. Previously unknown names from
explicit genre fields remain valid. AniList tags, Giant Bomb themes, and MangaUpdates categories
are not genres. Open Library subjects, VNDB tags, Google Books categories, and Audible category
ladders contribute only recognized genre labels, without arbitrary compound-name splitting.

Successful genre responses replace links authoritatively, including empty responses. Missing
classifications do not clear links; malformed data fails population. Genre relationship schemas
declare `userWritePolicy: source-owner`: user writes require ownership of the source entity, while
authorized global provider population maintains global links. Custom media uses the shared
relationship picker, including catalog import and inline private genre creation. Private genres
remain separate identities even when their names match catalog genres.

`allowNsfw` is an installation preference; entity language is kernel-owned. The user settings also
hold one "Where you consume" list per builtin media type (`consumedOnBook` through
`consumedOnVisualNovel`, mapped from schema slugs in `shared/consumed-on-settings.ts`): at most 30
sources of at most 100 characters, seeded with per-type defaults. The Log activity sheet suggests
the list for the item's type first, then the item's own history and recent sources, ignoring case. Images contain remote
URLs or managed keys plus a declared purpose. Providers prefer foreground art, preserve order within
purposes, and deduplicate URLs using their first classification. Translation may replace the entire
image array; omission preserves canonical images.

TMDB watch providers exist only on Movie/Show. Population retains every country; the client filters
to the viewer's known region and hides empty results. Country entries contain the watch link and
offers in `stream`, `free`, `ads`, `rent`, `buy` order. The UI credits JustWatch and sorts services by
name within each offer kind.

TMDB movie and show `details` honour the population `level`. `/movie/{id}` and `/tv/{id}` carry
`append_to_response` for watch providers (and, for shows, episode groups) at `base`, adding credits
and recommendations at `full`; `base` returns no credit or recommendation groups. Images stay a
separate `/images` call without a language. Show seasons are fetched through `/tv/{id}` appends,
at most 20 seasons per request.

TMDB Show `episodeOrders` contains external IDs, descriptions, and ordered groups of episode IDs.
Positions belong to the alternate order, so stored episodes join by provider external ID, not season
and episode number. Unknown order types are dropped; an empty list clears removed orders. Fetches
use only the HTTP budget left after the show, images and season-append calls and drop excess orders rather than failing
population.

TMDB companies return the first discover page of movies and shows from `details` with a
`{ page, totalPages }` continuation. The company `related` script fetches up to 40 further pages per
run, five at a time, and ends at the last page or TMDB's page 500.

Provider refresh emits authoritative empty relationship groups where supported so removed links can
be deleted. TMDB and TVDB cast credits and AniList staff voice credits preserve character names in
the person-to-media relationship's `character` field, separately from roles. Multiple names for one
credit are deduplicated and joined with `/`; missing names stay absent. Detail credit lists display
the recorded names as `as <character>`. Consumers use normalized properties, not provider-specific branches. Descriptions and
translations use canonical `restrictedMarkdown`; provider boundaries normalize rich input, including
VNDB BBCode and AniList spoilers. Clients never guess source syntax. See
[Markdown conversion](../../packages/plugin-backend-sdk/README.md#markdown-conversion).

## Operations

Operation inputs/outputs live outside sandbox entries. Expected media failures use
`MediaSandboxError`; recipe failures use `RyotqlRecipeDecodeError`, and host failures retain
`SandboxHostError`. List operations return aligned per-item misses rather than failing the whole
operation. `resolve-episodes` instead echoes unique caller indexes; missing, duplicate, or unexpected
indexes fail the workflow. Episode lookup uses one database query per reference and resolves only an
unambiguous visible candidate. Podcast references can match an episode number or an exact title
within the resolved podcast; local source episode indexes are not provider episode numbers.

Every editable media/group/creator schema declares `/<schema>/new` and a manifest `editor` generated
from `shared/media-entity-editors.ts`, listing only its owned outgoing relationships; seasons,
episodes, and incoming credits are not editable. The shared entity editor saves through the kernel
editor save; the existing creation hook adds library membership. Relationship targets are chosen in
the kernel entity picker for the target schema.

`metadata-lookup` is restricted to `ryot_browser_extension` and searches TMDB movies before shows.
IGDB dynamic search options come from its provider and are backend-cached.

Monitoring status/enable/disable accept at most 50 visible, global, provider-backed monitorable
entities. Enable atomically adds library membership and monitoring; disable removes monitoring only.
Their schemas live in `shared/media-monitoring-operations.ts` for backend and client use. The summary
monitoring switch disables during a write, reports failures inline, and refreshes queries on success.
Invalid targets return aligned misses. Demo sessions can read status and resolve episodes, but
monitoring changes and custom saves are protected. Integration metadata lookup uses integration auth.
The cron pages its pinned query, deduplicates global IDs, and refreshes bounded provider batches with
deterministic child IDs; user-owned fields are not exposed by that global query.

Imports populate media at the `base` level, without credits or other relationship groups. Monitoring
association notifications for imported media therefore arrive when the media is first opened in the
foreground (which populates its `full` level) or at the next monitoring sweep, not at import time.

`media-review-create` saves a review on a visible media, group, creator, season, or episode owned by
this plugin. It requires nonblank text, accepts an optional 0–100 rating and a spoiler flag, and is
protected in demo sessions. The header and empty review activity tab open the same composer;
successful writes refresh active queries through the client SDK mutation notification.

`media-activity-log` writes one logged activity for a builtin media item: a completion, progress
(percent for flat media, cumulative position for anime and manga), a backlog/on-hold/dropped status,
or completions for up to 500 show or podcast episodes of one parent. Dates must satisfy
`startedOn ≤ finishedOn ≤ submittedAt`; "now" and unknown dates use `submittedAt`. Writes are chunked
by the event batch limit with `<submissionId>:<chunk>` idempotency keys, so a retried submission
writes nothing twice. After a `saved` write of an entry with a source, it appends the trimmed source
to the settings list of the item's type (a show or podcast for episodes) unless a case-insensitive
match exists or the list holds 30; status entries never do. A settings read or write failure is
logged and never changes the result. It is protected in demo sessions. The header and the empty activity tab open
the same Log activity sheet.

## Imports

`workflow.media-import` uses its admitted `source-parser` selection. Generic admission, capture,
reporting, cancellation, and replay contracts belong to
[imports](../../kernel/backend/src/modules/imports/README.md). Independent imports append history and
can duplicate earlier activity.

| Source  | Behavior                                                                                                                                                                                                                                                                                                         |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IMDb    | Watchlist/ratings CSV. Ratings 1–10 become reviews 10–100. Rating or rated date creates completion; absent dates stay unknown. Dates accept `YYYY-MM-DD` or `YYYY/MM/DD`. Rows with neither rating nor date create backlog; malformed values fail per row.                                                       |
| Trakt   | `user` imports history/ratings/watchlist/lists/collection; `list` imports a public user list; `export` imports an uploaded ZIP without API calls. API modes need `traktClientId`. List URLs are restricted to Trakt's `/users/{username}/lists/{slug}`. Export ratings/comments may target episodes and seasons. |
| Spotify | Extended-history ZIP: each `trackdone` Spotify-track play is identified by `(track, ts)`. Six-play transport groups do not change listening-event counts.                                                                                                                                                        |

Rating scales belong to each source, not the rating value: Goodreads, StoryGraph, Hardcover, and
Grouvee use five points; MyAnimeList and Watcharr use ten; AniList exports use 100. MyAnimeList and
AniList imports write one cumulative progress event per entry (`animeEpisode` or `mangaChapter`);
AniList volumes ride on that event as `mangaVolume`. IMDb imports write no consumption source. Jellyfin imports keep played items without a
played timestamp with an unknown completion date; malformed nonempty timestamps fail per item.

Trakt's API and export parsers have separate compiler-derived configuration requirements. Setup checks
the selected installation/mode, not remote credential validity. Issues preserve source-record and
operation identity; reports exclude raw captures, credentials, and execution pins.

## Integrations

`workflow.media-integration` uses its admitted `integration-adapter` for collection and confirmation.
Imports and integrations share bounded application writers, but integration executable closures
exclude manual collectors. Adapter identities retain persistent cache namespaces. Collection stores
sorted artifacts and continuation before advancing; application never refetches captured source data.
The run guard covers collection through terminal settlement; independent sink deliveries remain
admitted while waiting for it.

Scheduled runs require readiness before admission. Accepted webhooks may wait for setup under the
fixed deadline documented by [imports](../../kernel/backend/src/modules/imports/README.md).
Release pins provider settings, progress thresholds, ownership sync, user settings, and revisions;
OAuth refresh remains live. Collector-wide failures fail the run, attributed record failures remain
partial results, and expected skips do not fail health. Disabled or unauthorized integrations are
rejected at ingress, not retained as recoverable source work.

- **Spotify:** OAuth-backed yank reads the latest 50 plays. Later syncs request a one-hour overlap
  before `lastFinishedAt`; the first considers every returned play. Trackless plays are skipped.
  Created events use playback time, duration in minutes, and Spotify consumption identity. Only
  receipt-confirmed creations claim `["media.spotify-play", integrationId, trackId, playedAt]`, expiring
  30 days after collection began. Confirmation replay neither refetches nor extends claims; HTTP
  failures expose status only.
- **Jellyfin:** official episode webhooks use series-level provider IDs only. Missing show IDs are
  resolved through TVDB's episode endpoint, or TMDB's IMDb/TVDB episode lookup followed by a
  series-name search verified against the season's episode IDs. Lookups are cached for one day;
  external-ID-only misses are retried on the next event. Unofficial payload handling is unchanged.
- **Komga:** requests authenticate with `X-API-Key`. A partly read manga chapter N writes position
  N-1 when N is an integer above 1 and nothing otherwise; a fully read chapter writes N. Manga never
  receive a chapter's own percent; other books keep whole-book percent. Metadata links can identify manga through AniList, MyAnimeList, and MangaUpdates, or books through
  Hardcover, OpenLibrary, and Google Books. Ownership uses the same provider mapping.
- **Emby:** episode IDs are never treated as show IDs. Explicit series IDs avoid lookups; otherwise
  episode external IDs or verified series/episode names and coordinates resolve the TMDB show.
  Only successful full-identity lookups are cached. Ambiguous or unresolved episodes fail per record.
- **Audiobookshelf:** yank reads the account's in-progress items and fetches each item's current
  progress. The account's progress count supplies an explicit snapshot limit, avoiding the upstream
  default of 25 items. The higher audio/ebook fraction becomes a progress event; finished items at
  100% are skipped. Audible ASINs identify audiobooks, ISBNs identify books, and iTunes IDs identify
  podcasts whose current episodes resolve by title after population. Continuations retain the source
  snapshot and acceptance time. Optional ownership sync pages all libraries separately without
  emitting progress. Finished history belongs to the manual import, not this integration.
- **YouTube Music:** first confirmed local-day observation records 35% progress, the next records
  100%, and the day's final ten minutes record 100% directly. Only created outcomes advance `:seen`
  and `:completed` claims; both expire at local midnight. Confirmation replay makes no source request
  and does not renew retention. History requests send the origin used by cookie authentication.
  Sign-in pages and unrecognized history layouts fail collection instead of reporting an empty day.

### AniList

AniList is a Pro yank using `integration.anilist`; `account` is required and `syncAnime`/`syncManga`
default true. OAuth has no scopes, PKCE, or refresh token; expired/revoked connections require
reconnection. Host configuration requires secret `anilistClientSecret` and `anilistClientId`, under
`RYOT_PLUGIN__RYOT__MEDIA__ANILIST_CLIENT_SECRET` and `RYOT_PLUGIN__RYOT__MEDIA__ANILIST_CLIENT_ID`.
The callback is `<FRONTEND_URL>/api/oauth-connections/providers/ryot/media/anilist/callback`.

Collection reads `MediaListCollection` in captured 100-entry windows, committing records before
advancing continuation. Confirmation performs no AniList request or cursor/checkpoint update.
Integration and metadata requests share the declared GraphQL-origin budget.

## Lifecycle

Support is declared by `manifest/schemas/entity.ts`. State comes from append-only history ordered by
`occurredAt`, `createdAt`, then ID, not a separately stored state. Hooks use pinned projections of
immutable trigger evidence; current-state RyotQL cannot reconstruct omitted historical values.

| Hook family                     | Responsibility                                                                                                                                                                                                                                                    |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Library membership              | Required user-scoped entity/provider-import and event-batch hooks merge `in-media-library` properties without clearing annotations. The library never links to itself. A newly created membership records `add-to-media-library` once; idempotent upserts do not. |
| Association / relationship sync | Batch hooks filter projected changes; association resolves credits together, and sync uses the population batch leader. Item-count chunks remain subject to the separate invocation byte limit.                                                                   |
| Entity updated                  | Async population hook compares projected trigger-time fields, treating image order as irrelevant, and emits monitoring signals.                                                                                                                                   |
| Episodic session                | Before-event policy patches only `sessionEntityId`; missing/ambiguous parents reject the event and caller session IDs are replaced.                                                                                                                               |
| Episodic completion             | Required episode-complete hooks and async terminal-status hooks use the same completion script; status signals fan out per monitoring user rather than running globally.                                                                                          |
| Review / collection pushes      | Review includes kernel collection reviews; Radarr/Sonarr observe collection additions. Notifications/pushes have one attempt and no automatic external retry.                                                                                                     |

Membership batch hooks run after the written prefix, so later items in that request cannot depend on
their effects. All membership hooks use user execution scope; global population plans none. Batch
hooks must filter items themselves and remain idempotent across chunks.

Flat schemas use their latest backlog/progress/completion/drop/hold signal; progress means
`in_progress`, no signal means `untracked`, and there is no `caught_up`. Completion boundaries are
entity-scoped, with progress reported only after the latest completion. `progressPercent` is optional
on progress, dropped, and on-hold events (above 0, at most 100); Show/Podcast parent dropped and
on-hold events carry neither percent nor position. A percent-less, position-less progress event means
"started". Anime `animeEpisode` and manga `mangaChapter` are cumulative ("consumed through N"),
carry no percent, and `mangaVolume` is an optional annotation, never a completion unit; the latest
position is the one on the latest progress or list-state event that carries one. Whole-entity
completion carries no episode fields. Reviews do not affect state.

Shows/Podcasts track child episodes. Parent aggregate signals can interrupt episode-derived activity;
later regular-episode activity resumes it. Complete aired coverage means `caught_up`, otherwise
activity means `in_progress`. A newly aired episode can therefore make a caught-up series incomplete.
Season completion is derived, never directly written.

Regular episodes share the parent session; season-zero specials are sessionless and outside cycles.
The active cycle begins strictly after the latest parent completion. Required episodes are aired
regular-season Show episodes or currently related aired Podcast episodes; null/malformed publication
dates count as aired, using the server UTC day. Empty coverage is never complete. Specials and empty
seasons neither satisfy nor block it.

`episodeDisplayStateExpression` owns list state, counts, and next-up. Before a new cycle starts it
uses lifetime state, preserving the completed list; afterward it uses current-cycle state. Progress
after completion reopens an episode. Next-up prefers an in-progress episode, then a show's first
untracked episode after its highest completed position, or a podcast's newest untracked episode.
Shows without a completion anchor have no next-up; earlier gaps are skipped.

Auto-completion reads one bounded parent snapshot, finds each required episode's completion after
both the parent boundary and its latest progress, and rereads after acquiring its completion claim.
Terminal production status (`Ended`, `Canceled`, or `Cancelled`, case-insensitive) is required for
Show/Podcast completion. Relationship changes recompute coverage but do not create completion.
Completion time is the latest false-to-true coverage transition and does not move on repeated
evaluation; consumption source is copied only when all required completions agree.

100% progress completes other flat media. Anime/Manga complete when a created progress event's
position reaches the episode or chapter total, or its percent is 100; no completion is written when
an equal-or-later completion exists, so repeated delivery stays idempotent and a later repeat
completes again. Completion needs no preceding progress. Percentages use half-up rounding to two
decimals. A completion's `occurredAt` is its completion time unless `dateUnknown` is true; unknown
dates stay out of per-day and per-type activity buckets but count in totals, and render as "Date
unknown". Distinct completion passes retain separate events and timestamps.

AniList writes `list-state` snapshots, not inferred progress/completion history. Snapshots contain
state, positions, repeat count, and partial dates at pinned observation time. Identical polls append
nothing even if source `updatedAt` changes, preserving later local actions. Missing remote entries
do not delete local history; ratings, notes, and custom lists are outside the integration.

Integration progress consumption sources are display names: Jellyfin, Emby, Plex, Kodi, Komga,
Audiobookshelf, YouTube Music, and Spotify; the browser extension keeps the page hostname.

Integration progress admission runs after population/episode resolution in `import.write-chunks`.
It accepts a percent or, for Anime/Manga, a position; an event with neither is rejected. Minimum
filtering, maximum clamping, and configured 100% debounce apply to percent only. Duplicate
suppression compares the latest committed or pending event of the same consumption source by position
for positional events, otherwise by percent. The run guard serializes competing deliveries; failed writes
leave no completion claim. Missing sink timestamps are supplied and auto-completion retains the
trigger's time. Numeric normalization stays schema-owned. Source/event indexes and deterministic
population/write identities preserve attribution when admission filters records.
