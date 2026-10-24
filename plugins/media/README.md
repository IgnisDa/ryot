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

The canonical sync selection includes `relatedPopulationStatus` as `{ availability, state }`.
Queued, running, and retrying related work shows a progress notice. Failed work shows "Couldn't load"
with Try again, which retries population through the kernel. Saved credits, companies,
recommendations, groups, and extra rails stay visible beside either notice, including partial data.
Idle missing data is not actively loading. Translation failures keep available text visible and
offer a separate translation retry using the user's trusted language preference.

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

| Schema            | Activity measure          | Distinct behavior                                                                  |
| ----------------- | ------------------------- | ---------------------------------------------------------------------------------- |
| Movie             | Canonical minutes         | Cover/backdrop and watch providers                                                 |
| Music             | Canonical minutes         | Stored duration is seconds, displayed `m:ss`; square cover                         |
| Book / Comic Book | Pages                     | Book supports unlinked creators; Comic Book has person credits only                |
| Manga             | Chapters                  | Cumulative chapter progress with optional volume; no group or creator credits      |
| Anime             | Episodes                  | Episode progress; no group; future airing schedule, with next episode in summary   |
| Audiobook         | Canonical minutes         | Author/Narrator credits, unlinked contributors, square cover                       |
| Visual Novel      | Canonical minutes         | No group; developer person credits; screenshots are gallery-only                   |
| Video Game        | Recorded `timeSpent` only | Community time-to-beat is never consumed time; IGDB artwork appears in the gallery |

Flat summaries return `{ summary, entitySchemaSlug }`; activity returns completion count, consumed
amount, unknown count, repair state, truncation, and events. Unknown measures render lower-bound totals,
not zero. Anime/Manga progress labels use the latest recorded position; the in-progress percentage is
that position divided by the episode or chapter total when both are known, else the latest recorded
percentage.
`shared/consumption-recipes.ts` reads fresh canonical contributions. Pending or failed repair replaces
the detail figures with an explicit state. Independent numbered items remain separate activity rows;
their editor supports item number/unit, chapter volume context, date precision, and recorded time.
Schemas without a
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
- `activity-recipes.ts` reads canonical title completions, minutes, and active observations over
  52 local Monday-start weeks, with source reviews in the same period. Episode activity counts toward
  its parent. Date-only and timed observations combine on their calendar day; unknown dates do not
  enter the bounded period. Pending/failed repair replaces the figures, heatmap, and shares.

The Home activity section and screen use the account reporting timezone, stable `{ timeZone }`
query input, execution-clock windows, and actual account-midnight/DST scheduling. They retain
refresh-failure state and link to Analytics. `activity-model.ts` is unchanged. Formatting, lint, and
whitespace passed; full Media tests, typecheck, and package check remain unrun.

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

### Signal Schedules

`manifest/signal-schedules.ts` reuses the Calendar source queries and the stored library summary:

- `show-episode-releases`, `podcast-episode-releases`, `anime-airing-releases`, and `flat-releases`
  emit `media.released` for monitored library media on the release day. Season-0 specials are
  skipped, and the root's `providerCheckedAt` must be within 72 hours, otherwise delivery waits for
  the monitoring sweep.
- `in-progress-stale` and `on-hold-stale` emit `media.progress-stale` once when the stored lifecycle
  state has had no activity for 7 or 14 days. The occurrence includes the latest activity, so new
  activity starts a new period. Both require a validated Pro key.
- `show-episodes-available` and `podcast-episodes-available` emit `media.episodes-available` when the
  stored next airing of an unmonitored caught-up series arrives; monitored series already receive
  `media.released`. Monitoring is never enabled implicitly.

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

`providerRating` is always 0-100, rounded to 2 decimals. Providers with native /5 scales (Audible)
are multiplied by 20 and /10 scales (MyAnimeList, MangaUpdates) by 10; AniList, TMDB, IGDB, and VNDB
already report /100. Spotify and Listen Notes store popularity scores, not ratings.

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

Translation entry manifests declare each supported entity schema and the canonical properties
needed to address it. Root translations select no properties. TMDB show children select the parent
show ID and season number, plus the episode number for episodes. TVDB show children select the
parent show ID; iTunes episodes select the parent podcast ID. No other canonical properties enter
translation execution snapshots.

## Operations

Operation inputs/outputs live outside sandbox entries. Expected media failures use
`MediaSandboxError`; recipe failures use `RyotqlRecipeDecodeError`, and host failures retain
`SandboxHostError`. List operations return aligned per-item misses rather than failing the whole
operation. `resolve-episodes` instead echoes unique caller indexes; missing, duplicate, or unexpected
indexes fail the workflow. Episode lookup uses one database query per reference and resolves only an
unambiguous visible candidate. Podcast references can match an episode number or an exact title
within the resolved podcast; local source episode indexes are not provider episode numbers.

Every editable media/group/creator/child schema declares `/<schema>/new`, `/<schema>/$entityId/edit`,
and a manifest `editor` generated from `shared/media-entity-editors.ts`. Media and group editors own
their outgoing genre, related-game, and member links; media and credit-bearing group editors also own
incoming person and company credits, so creator editors declare no links. Show seasons, show episodes,
and podcast episodes declare their container link as a `parent` and are deletable. The shared entity
editor saves through the kernel editor save; the creation hook adds library membership except for
these children. Relationship targets are chosen in the kernel entity picker for the related schema.
Custom media, creator, and group details expose **Edit** only for owned, non-provider entities with an
editor declaration. Saves retain declared fields, nested values, assets, and untouched links. Entity
and relationship baselines reject stale edits without overwriting newer work. Duplicate actions are
not provided.

Container links declare `userWritePolicy: source-owner`, so only owned custom shows, seasons, and
podcasts receive user children; provider inventories stay read-only. They also declare
`retention: composition`, so the kernel keeps or deletes a provider show or podcast together with its
seasons and episodes. `media-trending` declares `retention: root` while an item trends. Episodes tabs of owned custom
parents offer **Add season**, **Add episode**, **Edit season**, and **Edit episode**; create routes
carry `parent` plus starting `seasonNumber`/`episodeNumber` search values. Season numbers are
immutable after creation, so episode season numbers match their season. Deletion is refused while
an episode has history or a season has episodes.

The API-source before policy `media.custom-publish-year` derives a missing `publishYear` from a
valid full `publishDate` on custom media creation and update, including direct API writes. An
explicit year is preserved even when the date changes. Year-only metadata remains valid; partial
or invalid date strings do not produce a year. Provider population and historical import sources
are outside this policy.

`metadata-lookup` is restricted to `ryot_browser_extension` and searches TMDB movies before shows.
IGDB dynamic search options come from its provider and are backend-cached.

Monitoring status/enable/disable accept at most 50 visible, global, provider-backed monitorable
entities. Enable atomically adds library membership and monitoring; disable removes monitoring only.
Their schemas live in `shared/media-monitoring-operations.ts` for backend and client use. The summary
monitoring switch disables during a write, reports failures inline, and refreshes queries on success.
Invalid targets return aligned misses. Demo sessions can read status and resolve episodes, but
monitoring changes, ownership changes, and custom saves are protected.

The monitoring cron pages the live target query in stable entity-ID order and retains each target-page
result as durable workflow activity evidence before refreshing bounded provider batches with
deterministic child IDs. It does not build a global in-memory snapshot or deduplicate across the sweep;
user-owned fields are not exposed by the global query.

Provider-backed root detail screens expose **Refresh provider data**, request activity, retry, and
the last successful details check. Shared population admission coalesces matching monitoring and
manual work; a completed manual refresh has a one-minute cooldown. Full refresh includes the root,
child inventory and declared related groups, not recursive graph refresh. Current-language translation
is checked even when canonical content is unchanged. Custom entities stay on the editor path, and
provider children refresh through their parent. Existing monitoring-change detectors still run.

`media-ownership-set` accepts at most 50 visible built-in media entities and merges `owned` and an
optional `ownedOn` date into each `in-media-library` relationship, adding library membership when
absent and preserving integration-reported ownership sources. Removing ownership clears `ownedOn`.
Integrations only report ownership, so a later sync can mark manually unowned media as owned again.
Its schemas live in `shared/media-ownership-operations.ts`. Switching ownership on asks for the date,
defaulting to today and rejecting future days; switching it off writes immediately. Integration metadata lookup uses integration auth.

Imports populate media at the `base` level, without credits or other relationship groups. Monitoring
association notifications for imported media therefore arrive when the media is first opened in the
foreground (which populates its `full` level) or at the next monitoring sweep, not at import time.

The detail header's **Your data** menu uses the protected `media-user-data` operation. **Remove from
library** is a confirmed destructive clear, not a membership-only toggle: it removes the caller's
history, reviews, ownership, monitoring, collection memberships, and correction evidence. Shows,
seasons and podcasts include their child data, including sessionless specials and retained historical
children. Provider metadata, custom metadata, and structural relationships remain. Imports and
integrations, including runs already in progress, can add the item and its events again; there is no
blocked-item state. Retrying a completed removal replays its result without deleting newly added data.

**Merge my data into…** selects an existing item of the same schema and definition owner. Explicit
history and reviews keep their IDs and dates; similar records are not deduplicated. Collection and
monitoring memberships combine, with destination property values and ranks winning conflicts and
source-only values retained. Recorded show children match by season/episode number; podcast children
also require a matching trimmed, case-insensitive title. Missing or ambiguous matches reject the
whole operation with the affected identities and instructions to refresh or correct metadata before
trying again. Frozen completion evidence and explicit correction decisions transfer with remapped
entity references; temporary correction checkpoints and coverage are reset. Both actions use the
kernel's [entity user-data owner](../../kernel/backend/src/modules/entities/user-data/README.md),
immutable submission identities, and atomic stale-state checks.

`media-review-create` saves a review on a visible media, group, creator, season, or episode owned by
this plugin. Create and update accept a rating, nonblank text, or both; an empty review is rejected.
Both inputs carry nullable `text` and `rating` fields. Ratings use the finite 0–100 scale, including
zero and decimals. Text is trimmed; absent content is omitted from event properties. The spoiler
flag is stored only with text. Updates remove cleared content and preserve other declared fields,
including imported positional metadata. Imported rating-only reviews need no placeholder text.
The header and empty review activity tab open the same **Rate or review** composer, with the rating
first and spoiler controls shown only when text exists. Clearing both fields while editing asks the
user to retain content or delete the review. Writes remain protected in demo sessions and use the
existing replay receipts and stale-update snapshots. Successful writes refresh active queries
through the client SDK mutation notification. Review changes do not log consumption, and deleting
the last review does not remove library membership.

`media-activity-log` writes one logged activity for a builtin media item: a completion, progress
(percent for flat media, cumulative position for anime and manga), a backlog/on-hold/dropped status,
or completions for up to 500 show or podcast episodes of one parent. Dates must satisfy
`startedOn ≤ finishedOn ≤ submittedAt`; "now" and unknown dates use `submittedAt`. Writes are chunked
by the event batch limit with `<submissionId>:<chunk>` idempotency keys, so a retried submission
writes nothing twice. After a `saved` write of an entry with a source, it appends the trimmed source
to the settings list of the item's type (a show or podcast for episodes) unless a case-insensitive
match exists or the list holds 30; status entries never do. A settings read or write failure is
logged and never changes the result. It is protected in demo sessions. The header and the empty activity tab open
the same Log activity sheet. The sheet, quick log button, episode quick mark, review composer, and
ownership and monitoring toggles hand their writes to the kernel's background submissions: dialogs
close once the kernel accepts, a finished completion opens the review composer instead, and the
shell tray owns the outcome and Retry. Toggles show the requested state optimistically and roll back
visibly when the settled outcome is a failure.

`media-activity-update`, `media-activity-delete`, `media-review-update`, and `media-review-delete`
edit or remove recorded history and are protected in demo sessions. The host scopes event writes to
the caller and to this plugin's event schemas but not to particular schemas, so each operation first
reads its targets through an explicit allow-list: `complete`, `item-complete`, `progress`, `dropped`, `on_hold`, and
`backlog` on built-in media and episodes for activity, and `review` on library members for reviews.
`list-state`, `add-to-media-library`, kernel collection events, and other plugins' events are
refused. Inputs carry `submittedAt` and the background submission ID; edits use the
`<submissionId>:write` key. Updates and single-record deletes send the row's full snapshot as a
`fields` precondition (every current property and every absent editable one), so a concurrent
change is reported as stale instead of merged. Edits never touch `entityId` or `sessionEntityId`.
The field matrix in `shared/media-activity-fields.ts` mirrors the declared event schemas; a field
the schema does not declare, and a stored record carrying keys its schema no longer declares, are
refused. Progress follows the logging rules: a position on Anime/Manga, a percent elsewhere. Moving
a date sets `occurredAt` (and `startedOn` where declared); an unknown date keeps `occurredAt` so
history is not reordered. Deletes accept up to 500 unique IDs, validate every 100-ID chunk before
the first write, and delete chunks in input order with `<submissionId>:<chunk>` keys. IDs that
resolve to nothing pass through as host no-ops, so a retry after a partial commit replays the same
chunks. A failure after a committed chunk returns `incomplete` for Retry; an earlier failure is a
rejection.

Activity and review rows in the Activity tab and complete history offer a row menu. Delete names
the number of records a folded row stands for; Edit appears only when the row is one completion,
progress update, or review, and opens the Log activity fields or the review composer. Aggregated
daily watches in an episodic summary carry no record IDs and are edited from complete history.
Collection, library, and synced list-state rows have no menu.

History creation, edits, and deletions reconcile automatic completions. Full-progress corrections
can create or remove their derived completion; episode corrections repair the affected parent and
subsequent consumption cycles. Explicit completions are never removed by inference. Editing an
automatic completion makes it explicit; deleting one suppresses that occurrence without deleting its
supporting history. A later independent repeat can complete again. Correction-created completions
skip Jellyfin delivery; repairing history never replays notifications or retracts external messages.
Library membership and monitoring are unchanged by history correction.

## Imports

`workflow.media-import` uses its admitted `source-parser` selection. Generic admission, capture,
reporting, cancellation, and replay contracts belong to
[imports](../../kernel/backend/src/modules/imports/README.md). Independent imports append history and
can duplicate earlier activity.

| Source  | Behavior                                                                                                                                                                                                                                                                                                         |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IMDb    | Watchlist/ratings CSV. Ratings 1–10 become reviews 10–100. Rating or rated date creates an undated completion; review dates do not establish consumption dates. Dates accept `YYYY-MM-DD` or `YYYY/MM/DD`. Rows with neither rating nor date create backlog; malformed values fail per row.                      |
| Trakt   | `user` imports history/ratings/watchlist/lists/collection; `list` imports a public user list; `export` imports an uploaded ZIP without API calls. API modes need `traktClientId`. List URLs are restricted to Trakt's `/users/{username}/lists/{slug}`. Export ratings/comments may target episodes and seasons. |
| Spotify | Extended-history ZIP: each `trackdone` Spotify-track source row is independent, including equal `(track, ts)` pairs. Six-play transport groups do not change listening-event counts. Exact `ms_played` supplies recorded minutes; absent duration stays unknown.                                                 |

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
  Created events use playback time, frozen track-duration estimates in minutes, and Spotify consumption identity. Only
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

### Consumption source facts

`shared/consumption.ts` and `manifest/schemas/consumption.ts` define the retained source contract.
Progress, completion, independent item, dropped and on-hold events carry these fields. Backlog, reviews and AniList
`list-state` are not consumption observations.

| Field                           | Stored meaning                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `consumptionBasis`              | `{ unit, property?, total? }`. Unit is `minutes`, `pages`, `episodes` or `chapters`. `total` is a finite nonnegative metadata estimate, never a recorded amount. Omission means metadata was unavailable; zero remains a known zero.                                                                                                                                                                                |
| `progressPages`                 | Finite nonnegative cumulative pages, on Book/Comic Book progress or status events. Exclusive with percent and positional progress. No rounding or conversion to percent on submission.                                                                                                                                                                                                                              |
| `progressPercent`               | Source-supported percent in `(0, 100]`, retained without decimal rounding. Exclusive with page/episode/chapter quantities. Missing denominator does not establish an absolute amount.                                                                                                                                                                                                                               |
| `animeEpisode` / `mangaChapter` | Cumulative consumed-through position. Anime uses integer episodes; Manga permits fractional chapters in stored facts. `mangaVolume` remains separate volume evidence, never a chapter conversion.                                                                                                                                                                                                                   |
| `timeSpent`                     | Finite nonnegative cumulative minutes in this run, including on progress. Original manual time is recorded evidence. Empty means unknown; explicit zero is known.                                                                                                                                                                                                                                                   |
| `calendarDate`                  | Valid `YYYY-MM-DD` date-only evidence. Keep this calendar day in every reporting timezone. Never use it in hourly activity.                                                                                                                                                                                                                                                                                         |
| `dateUnknown`                   | `true` means no reliable consumption date. Cannot coexist with `calendarDate`. The row's `occurredAt` is then only a deterministic ordering timestamp.                                                                                                                                                                                                                                                              |
| `sourceRun`                     | Optional nonblank source-owned identity, at most 200 characters. All observations from one independent imported run share it. Distinct explicit source records use distinct identities, even when their other fields match. Immutable on edits. No entity/event references are embedded in this identity.                                                                                                           |
| `sourceProgress`                | Optional immutable `{ unit: "episodes" \| "chapters" \| "volumes", position: number, percent: number }`, retaining a source's ambiguous position/percent pair, including partial volume-only evidence. Position is nonnegative; percent is `[0, 100]`. This raw evidence does not itself establish consumption and never drives automatic completion.                                                               |
| `consumedItem`                  | Required on Anime/Manga `item-complete` only: `{ unit: "episodes" \| "chapters" \| "volumes", position: number, volume?: number }`. One event records one independent item; its position is identity, not quantity. Anime requires a nonnegative integer episode number. Manga permits nonnegative fractional chapter/volume numbers. Optional `volume` is chapter context only and contributes no volume quantity. |

When both date fields are absent, `occurredAt` must be an actual observed instant. Importers must
classify precision from source evidence, not timestamp shape. A midnight timestamp does not establish
date-only precision. When a historical date/precision cannot be supported, retain the original
ordering timestamp and mark the observation undated instead of fabricating hourly activity.

Manual import runs namespace source identity with the ingestion run and original row/event indexes.
Baseline progress and its explicit AniList/MyAnimeList completion share a run; independent repeats
and numbered items retain separate identities across paging. Goodreads/StoryGraph count-derived
repeats are undated except for the latest supported read date. Hardcover, Grouvee date-only history,
and Movary calendar history retain calendar dates. IMDb rating dates do not date consumption.
Watcharr fallback timestamps and imported status snapshots remain undated. Spotify preserves every
explicit record, including equal track/timestamp pairs; milliseconds convert exactly to minutes,
with missing duration distinct from recorded zero.
Live Spotify track duration is metadata, so it supplies frozen basis rather than recorded listening time.

Basis mapping is fixed: movies/audiobooks/show episodes/podcast episodes use `minutes/runtime`;
music uses `minutes/duration` with the source seconds divided by 60; visual novels use
`minutes/lengthMinutes`; books/comics use `pages/pages`; anime uses `episodes/episodes`; manga uses
`chapters/chapters`. Games use `{ unit: "minutes" }` with no metadata estimate. Show/Podcast parents
use `{ unit: "episodes" }` with no total; parent completion never supplies child duration.

The single `media.consumption` before-policy captures a missing basis on creation across runtime
writers. Updates retain the original basis, including an unavailable total. Supplying an explicit
amount corrects the observation without rewriting the retained metadata. A supplied historical basis
must use the target's unit/property mapping. Automatic completions must supply retained evidence;
they cannot recapture current providers. A create carrying `sourceRun` must supply its basis, including
an explicitly unavailable total. Historical restore/migration supplies these facts directly.

Correction occurrences retain `expectedConsumptionBasis`, `expectedCalendarDate`,
`expectedTimeSpent` and `expectedSourceRun` beside existing expected ordering/date/source properties.
Progress-derived output copies those values; coverage-derived parent output has only the parent
episode basis and closing date evidence. Nested properties compare structurally, including after
restore. Existing `completionKey` identifies derived output; editing it still makes it explicit, and
deleting it retains suppression. Source facts introduce no new typed entity references. The existing
user-state policy clears source events and occurrence evidence, transfers frozen occurrence evidence
on merge, and resets only correction checkpoints/temporary coverage.

Migration ordering and identity: use one deterministic `sourceRun` per original source occurrence
(for example `seen:<source-id>`), shared by its baseline and explicit completion. Do not deduplicate
independent completed source records. Do not manufacture intermediate amounts from update timestamps.
If a partial positional row does not prove consumed-through units, keep its original pair in
`sourceProgress`, leave the interpreted position absent, and retain any independently measured manual
time. The existing lifecycle replay still needs its separate reopening/boundary audit.

For an independently completed numbered Anime/Manga item, write `item-complete`, not `complete`
or cumulative `progress`. Retain one event and one original source identity per occurrence, even when
the same item number repeats. Do not add `animeEpisode`, `mangaChapter`, `mangaVolume`, or
`progressPercent`. Keep the target's normal basis mapping (Manga uses chapters even for a volume
occurrence); the consumed item provides its exact unit. These events do not change title status or
trigger title completion. They use normal library admission and activity edit/delete ownership.

### Canonical allocation

`shared/consumption-allocation.ts` separates bounded run planning from replay. A plan retains five
recorded high-water anchors; replay retains five recorded amounts and progress fractions. Neither
state grows with history length. Callers supply ordered observations and retained automatic/suppressed
boundary evidence. A named `sourceRun` groups only that source's observations. Unnamed explicit
completions close local runs. Independent numbered items never advance or reset a local progress run.

Recorded quantities take precedence over estimates through their last recorded high-water anchor.
The positive increases in recorded amounts are attributed to their own observations. Lower or equal
readings add nothing. Earlier percentage observations stay active evidence when their estimate is
superseded; no negative quantity is emitted. After the last quantity anchor, new percentage intervals
can contribute a frozen estimate. Any recorded minutes suppress metadata-time estimation for that
run; later unmeasured progress has missing duration coverage instead of an invented remainder.

| Evidence in one run                                                                 | Allocation                                                                    |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Pages 40 → 70 → complete, frozen total 100                                          | Recorded 40 + 30, estimated 30.                                               |
| Percent 40 at total 100 → 40 at total 200 → 70 at total 200 → complete at total 200 | Estimated 40 + 0 + 60 + 60. A denominator change alone adds nothing.          |
| Percent 40 with unavailable total → 70 at total 100 → complete at total 100         | Missing first interval, estimated 30 + 30; no retrospective fill.             |
| Percent 40 at total 100 → exact pages 70 → complete                                 | Earlier estimate superseded, recorded 70 on its own date, estimated 30.       |
| Movie 90% at runtime 200 → explicit completion with 60 recorded minutes             | Earlier estimate superseded, recorded 60; original runtime evidence retained. |
| Movie recorded 120 minutes at 50% → completion without time                         | Recorded 120, missing completion duration; no metadata remainder.             |
| Game minutes 300 → 120 → 300                                                        | Recorded 300 + 0 + 0. Editing the original 300 replays the run.               |
| Complete with unavailable runtime / complete with recorded zero                     | Missing minutes / known zero minutes; both remain completion occurrences.     |

Automatic completions supply occurrence counts but no second quantity or active observation. Parent
Show/Podcast completions supply title counts, never child minutes. Manga volume annotations on
cumulative chapter progress are not consumed volumes; only explicit volume occurrences establish
that quantity. Date-only observations retain their calendar date, unknown dates stay undated, and
reporting periods filter contributions after complete run repair.

`backend/consumption-step.sandbox.ts` pages ordered source-run groups and local run boundaries using
`backend/contracts/consumption-recipes.ts`. Each step retains one plan/replay cursor, reads at most
eight 50-row pages, and publishes at most 100 updates for its own event schema. Checkpoints are
validated and limited to 16 KiB UTF-8. Focused host tests exercise 2,200 observations across 1,100
independent runs, a 1,200-observation unfinished run, and 100,000 observations on one title. The long
title uses multibyte source identity and serialized checkpoints between actual script invocations;
each invocation publishes at most 100 updates. Database execution remains a separate gate.

Readiness reads correction state and `eventScope.revision` together. Publication requires finished
correction covering that revision. Correction seeds typed `consumption-dependency` rows in 50-child
pages. Child streams scan all dependency pages before publishing or parking, including when an early
parent is stale. The manifest's one-hop `through` inputs wake children after parent input changes and
evidence moves/deletes. Review, list-state, item, and library-admission writes also schedule correction.
Child correction excludes sessioned sources whose completion repair belongs to the parent.

`shared/consumption-recipes.ts` provides current/previous totals, recorded/estimated/missing coverage,
date attribution, repair counts, trends, hourly activity, title rankings, and review aggregates.
Its public input remains `{ reference, selection, now, timeZone, entityId? }`. `current.items` and
`previous.items` group by `mediaType`, with completion/activity counts and each unit's `Recorded`,
`Estimated`, and `Missing` fields. Additive `trends`, `hourly`, `rankings`, and `reviews` retain bounded
page information. Trends retain separate date/instant precision rows on normalized calendar buckets;
consumers sum both precision rows for one media-type bucket. Hourly activity excludes date-only and
undated observations. Rankings use active observations, with entity identity as the stable tie-break.
Reviews use their own recorded review date and expose rated-count coverage beside the average.
All consumption sections share the report's repair state; ready-only partial amounts must not be
presented as complete while any source is pending or failed.
One full-history coverage query retains repair and undated counts. Current and previous quantity
queries apply the reporting period before aggregation, rather than repeating the same period condition
inside each measure. Their decoder joins coverage back by media type, retaining zero quantities for
types whose dated history falls outside the period. The complete report uses seven named queries.

Home, flat-detail, and episodic lifetime metrics use canonical contributions. Current episode coverage
and lifecycle status remain separate. Episodic activity never replaces missing frozen time with current
provider runtime. Library rating and completion columns read live source/canonical rows; relationship
projections cache only lifecycle fields. Pending repairs yield null completion totals/dates. The last
completion timestamp uses only timed evidence; date-only completions do not invent an instant.
See [the production benchmark entry](benchmarks/README.md) for the reusable source fixture and query
cases. The Analytics summary, charts, ranking/records, contribution registration, and manifest UI
work is in progress, not complete; no runtime UI acceptance is claimed. Home reporting-timezone,
midnight boundary, and Analytics-link ownership are implemented as described above. Database
repair/restore correctness remains an open acceptance gate. On 2026-10-29, the owner accepted the
current query speed as adequate and waived the former warm-p95 targets as release blockers; this does
not claim a p95 pass or close the separate correctness/readiness gates.

### Order 16 query gate evidence

#### Current performance status — owner decision (2026-10-29)

The owner accepted the current canonical seven-query implementation as adequately fast: the latest
normal-period single diagnostic was 946.445084 ms and the all-time single diagnostic was 2,591.592 ms.
These are not p95 results, and no complete 20-warm-sample acceptance run was captured. The owner
waived the former 500 ms / 2,000 ms warm-p95 targets as release blockers for the current
implementation; these numeric targets remain historical benchmark guidance only. Stop further Media
query optimization for this implementation. The shared-scan, projection-prefilter, and four-query
candidates remain unimplemented and not production-approved. This does not approve floating-point
behavior changes, a new SQL shape, framework, dependency, or reduced correctness/readiness.

#### Latest all-time single-execution diagnostic (2026-10-29)

The all-time report completed all seven named queries (`current`, `previous`, `rankings`, `hourly`,
`trends`, `coverage`, and `reviews`) in one execution per query. The first recipe took **2,591.592
ms**; decoded totals matched source expectations. This is one synthetic-fixture diagnostic, not a
p95. The owner accepted this current speed as adequate; no all-time p95 was measured. The
manifest and artifacts are under
`/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/media-all-time-diagnostic-20261029/result-a/`.

#### Rejected projection-stream prefilter diagnostic (2026-10-29)

Do not implement the scoped projection-relation prefilter. Its one raw sample per query regressed
both current-total queries; exact raw equality does not make it a performance improvement:

| Query             | Baseline (ms) | Candidate (ms) | Exact raw equality |
| ----------------- | ------------: | -------------: | ------------------ |
| All-time current  |       637.092 |        668.732 | Yes                |
| All-time coverage |       234.939 |        230.186 | Yes                |
| Month current     |       147.018 |        180.678 | Yes                |

These are single raw executions, not p95s. All raw rows were bit-exact, but the all-time-current
and month-current queries regressed; no production patch was proposed. Full method, limits, and
evidence: `/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/projection-stream-prefilter-20261029/REPORT.md`.

#### Latest durable normal-period report diagnostic (2026-10-29)

The current period report uses seven named queries. The latest synthetic ready-projection fixture has
100,000 observations across 400 titles and 1,000 reviews; it does not prove ordinary writer,
correction, or runtime-publication behavior. One full first-recipe execution took 946.445084 ms,
including durable writes. Each named query ran once, with no warm samples:

| Query    | First execution (ms) |
| -------- | -------------------: |
| Current  |              165.109 |
| Previous |              141.002 |
| Rankings |              139.152 |
| Hourly   |              139.563 |
| Trends   |              149.388 |
| Coverage |              195.089 |
| Reviews  |                3.801 |

The public decoded output matched the earlier `source-date-base-a` capture exactly. That baseline
matched its independent oracle across 29,418 scalar values. This equality is correctness evidence,
not a p95 result. The owner accepted this current speed as adequate; no normal-period p95 was
measured. Earlier 1.228 s and 2.479 s diagnostic timings are historical, not current-path
performance. A four-query candidate was rejected: it took 3,822 ms versus 1,169 ms, including
2,269 ms JIT, and changed fractional reassociation. The repository was not changed by that prototype.

A later remaining-cost analysis summed six period pipelines at 933.104 ms. Even if coverage were free,
738 ms remains; freshness costs less than 1 ms. At that historical checkpoint, no plausible small fix
met the then-active 500 ms target, and no 20-warm-sample p95 acceptance run was complete. The user
approved only a read-only generic shared-scan feasibility prototype, now complete. Its strongest five
period pipelines took 233.851 ms;
unchanged coverage took 377.029 ms and reviews 3.818 ms, for 614.699 ms total SQL. This excludes
runtime, decode, and artifact overhead. It is one uncontrolled-host execution, not a p95 or a
controlled speedup from the loaded 1,704.675 ms baseline.

The prototype materialized only 7,700 candidate rows with native guarded scalars; individual
aggregates, grouping, ordering, and limits stayed unchanged, with no subtotal regrouping. All 82
private assertions passed (30 + 30 semantics, 6 + 6 source order, 10 fallback); retained-month raw
and public results matched exactly. Source hashes for 14 files were unchanged, and defaults, indexes,
data, and captures were preserved. See `media-shared-scan-prototype-20261029/RESULTS.md`.

This does not prove production eligibility for arbitrary floating-point `SUM` transition order. The
combined statement has one 30-second timeout instead of separate 30-second per-named-query timeouts,
and result-byte accounting is unresolved. Production use remains unauthorized; this prototype is
not a production implementation or an acceptance pass. The main implementation will not adopt it
as-is. The former warm-p95 targets are waived as release blockers for the current implementation;
no p95 pass is claimed, and no further Media query optimization is approved.

#### Earlier durable full-report diagnostic (2026-10-29)

This earlier capture used the same synthetic ready fixture. It was one execution only, not a p95 run.
The full first recipe took 2,478.794 ms including durable writes. Its captured per-query times were:

| Query    | First execution (ms) |
| -------- | -------------------: |
| Current  |              530.812 |
| Previous |              445.677 |
| Rankings |              409.318 |
| Hourly   |              395.073 |
| Trends   |              472.418 |
| Coverage |              208.457 |
| Reviews  |                3.261 |

An independent oracle found zero differences across 53 comparison groups, 29,418 scalar values,
and 14,841 numeric values. The capture covered current and previous results for four media types,
384 ranking groups with the first 100 ordered rows (`hasMore: true`), 232 trend rows, four hourly
rows, all four coverage rows, and 58 reviews (43 rated; rating sum 2,900). It did not cover nonzero
missing/pending/failed states, DST, other periods, later ranking pages, or historical-type-only zero
rows. Earlier 16–20 second runs in a three-warm-run loop were interrupted; no p95 was obtained.
These remain historical failed evidence.

The initial direct RyotQL subtotal probe was rejected on 2026-10-28; its temporary recipe and runner
were removed. It used cumulative high-water differences within completion boundaries, with the
reporting filter outside history calculation. It was not a complete canonical report and did not
resolve all changed-denominator, suppression or mixed recorded/estimated allocation cases.

Disposable PostgreSQL 18 database `order16_media_gate` contains one account, 1,000 game titles,
100 observations per title (90 progress and 10 completion rows; 100,000 total), with repeated runs.
The fixture's modulo-day ordering puts each title's last generated completion first and leaves a final
unfinished run. Event indexes match
the relevant existing user/entity/schema/order and JSON indexes; no limits or caches were changed.
The real RyotQL executor generated the SQL. No legacy source database was changed.

| Probe                                             | Result                                                                                                                                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account-wide minutes subtotal                     | First execution hit the existing 30-second statement timeout; no p95 claimed.                                                                                                   |
| One title, 100 observations, same account dataset | First execution 2,483.85 ms; 20 subsequent executions, warm nearest-rank p95 6,619.00 ms. Local concurrent Order 16 work was running.                                           |
| Bounded response                                  | One aggregate row, 81 bytes; no grouped-result truncation.                                                                                                                      |
| Shape                                             | One named query, one root join, correlated depth 2; document 47,011 bytes, generated SQL 38,933 bytes.                                                                          |
| `EXPLAIN (ANALYZE, BUFFERS)` on the title probe   | Aggregate over nested-loop/index scans; 88,976 shared-hit blocks, zero read blocks; planning 2.31 ms, execution 2,451.634 ms. JIT compiled 182 functions and took 2,371.218 ms. |

This is lower-bound failure evidence, not acceptance of a full report. At that historical checkpoint,
benchmark guidance called for at least 20 warm executions of the complete canonical report: p95 ≤500 ms
for normal periods and ≤2 s for all-time over 100,000 observations/account, with first-execution and
real-dump results separate. The owner later waived those former targets as release blockers for the
current implementation; no p95 pass is claimed.
The raw generated SQL, parameters and full plan are retained in the session temporary artifact
`media-consumption-gate-small.log`; the timeout is in `media-consumption-gate.log`. These direct-query
results do not measure the current bounded projection implementation. Its database correctness,
restore rebuild, and publication acceptance remain separate gates for complete Order 16 acceptance;
they do not describe whether UI implementation has started.

### Order 16 retention runtime (2026-10-29)

An earlier Media retention runtime was **2/3, not acceptance**. Merge passed, clear/reuse passed, and
restore setup wait timed out after 180,003 ms. There is no accepted restore result; source facts
observed before the stale assertions do not prove restored data. Generic automatic restore repair
admission is now implemented, but full retention and restore acceptance remain open. The
minimal-fixture correction is active; no restore pass or manual retry is claimed. No restore diagnosis
is claimed. Evidence:

- Main run: `/Users/diptesh/.local/share/opencode/shell/69c95d6aa34813057528c971b0d0be7ab227f764/sh_1856a5aae0019qzjhlx6ENsrv3.out`
- Server: `/tmp/ryot-e2e-server-logs-MXbcut/ryot.log`
- PostgreSQL: `/tmp/ryot-e2e-postgres-98717.log`

Support is declared by `manifest/schemas/entity.ts`. State comes from editable history ordered by
`occurredAt`, source creation time, then source order, not a separately stored state. Automatic
completions retain their source-order keys so their later insertion or repair cannot move them past
same-time activity. Explicit records use their own creation time and ID. Hooks use pinned projections of
immutable trigger evidence; current-state RyotQL cannot reconstruct omitted historical values.

| Hook family                     | Responsibility                                                                                                                                                                                                                                                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Library membership              | Required user-scoped entity/provider-import and event-batch hooks merge `in-media-library` properties without clearing annotations. The library never links to itself. A required batch hook (`batchMaxItems` 80) records `add-to-media-library` once per newly created membership in one write; idempotent upserts do not. |
| Association / relationship sync | Batch hooks filter projected changes; association resolves credits together, and sync uses the population batch leader. Item-count chunks remain subject to the separate invocation byte limit.                                                                                                                             |
| Entity updated                  | Async population hook compares projected trigger-time fields, treating image order as irrelevant, and emits monitoring signals.                                                                                                                                                                                             |
| Episodic session                | Before-event policy patches only `sessionEntityId`; missing/ambiguous parents reject the event and caller session IDs are replaced.                                                                                                                                                                                         |
| Completion reconciliation       | A required batch hook (`batchMaxItems` 60) groups history creates, updates, and deletes by entity/session and requests durable user work. The async terminal-status hook uses the same worker. Atomic evidence/output/checkpoint writes with a scalar source revision and per-record guards reject stale repair.            |
| Review / collection pushes      | Review includes kernel collection reviews; Radarr/Sonarr observe collection additions. Notifications/pushes have one attempt and no automatic external retry.                                                                                                                                                               |

Membership batch hooks run after the written prefix, so later items in that request cannot depend on
their effects. All membership hooks use user execution scope; global population plans none. Batch
hooks must filter items themselves and remain idempotent across chunks. The two batch limits above
stay under the 32 KiB item share of the invocation context (about 430-byte event items and
350-byte relationship items) and within the 100-item host read and event-write limits.

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

Auto-completion replays paged source history in order, resetting coverage at each explicit or inferred
cycle boundary. Terminal production status (`Ended`, `Canceled`, or `Cancelled`, case-insensitive)
is required for a new Show/Podcast completion. User-owned events on the media library retain the
checkpoint (`history-correction`), occurrences (`completion-occurrence`), individual required episodes
(`completion-episode`), and temporary cycle coverage (`history-coverage`). These events do not cause
library admission. Evidence is pageable, never one history-sized JSON value. Later provider changes
do not rewrite frozen episode inventories or positional totals. Relationship changes still affect live
coverage without creating history.
Completion time follows the closing coverage event; consumption source is copied only when all
supporting completions agree. Source corrections can change that time or invalidate the completion.
Each step commits evidence, outputs, and its checkpoint atomically against the subject's event-scope
revision and each updated record's expected revision. Background work runs one correction job at a
time per subject, so that job is the only writer of the subject's records; the library event scope is
not guarded and the unchanged library entity is not rewritten, so corrections for other subjects do
not invalidate each other. A per-subject inventory fingerprint (required and total episode counts,
the latest episode, season, and link timestamps, and the subject's update time) is stored when a
snapshot begins and checked at the start of each later snapshot and publish step. An unfrozen
inventory restarts capture if the fingerprint changes between pages. A change landing during the
publish step itself is recorded as read, matching the rule that later provider changes do not rewrite
a past completion. A retained inventory is not recaptured. Each invocation runs at most eight steps,
then admits a deterministic continuation. Source and evidence reads are paged; inventory writes contain
at most 50 episodes, and audit, prune, and sweep handle up to 25 records per step.
Conflicts reread and retry up to five times, then yield to a fresh durable continuation. Ten
consecutive continuations that commit no step fail the job; any committed step resets the count. Large
repairs can become visible in stages. The Activity tab shows pending or failed work and offers Try
again, which starts a fresh chain, without rolling back the recorded source facts.
The shared background-work record exposes job status without exposing its execution input or pins;
Try again admits a new keyed job rather than replaying a failed child's cached result.

100% progress completes other flat media. Anime/Manga complete when a progress event's
position reaches the episode or chapter total, or its percent is 100; no completion is written when
an equal-or-later completion exists, so repeated delivery stays idempotent and a later repeat
completes again. Completion needs no preceding progress. Source percentages retain their precision.
A completion's `occurredAt` is its completion time unless date-only or unknown evidence is present; unknown
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
