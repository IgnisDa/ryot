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
Related rails, credit lists, series members, and trending tiles use
`mediaLibrarySelection` to read the current user's `in-media-library` membership. Member titles
use a theme-aware amber tint and a small check mark labelled "In your library"; activity,
monitoring, and collection membership alone do not set this indicator.
Library-only saved views and home rails keep their normal titles.
Title table views (every entity-browser view except people, companies, and groups) end with a
"Your rating" `rating` column (`userRating`) built from the shared `averageUserRating` expression.
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

Show season selectors also use cursor pages. The activity logger's context includes one default
season, then its selector loads the full season list independently. Season totals and the next season
number come from aggregates, not the loaded season page.

Show episode orders affect presentation only. A device-local `episode-order:<entityId>` preference
selects an order by external ID; default or missing orders clear the preference. Alternate orders
regroup and page episode IDs while retaining their original episode labels. Lifecycle, coverage,
and next-up always use default seasons; next-up appears only in aired order.

| Schema            | Activity measure          | Distinct behavior                                                                   |
| ----------------- | ------------------------- | ----------------------------------------------------------------------------------- |
| Movie             | Canonical minutes         | Cover/backdrop and watch providers                                                  |
| Music             | Canonical minutes         | Stored duration is seconds, displayed `m:ss`; square cover                          |
| Book / Comic Book | Pages                     | Book supports unlinked creators; Comic Book has person credits only                 |
| Manga             | Chapters / Volumes        | Cumulative chapter or volume runs; chapters carry optional volume context; no group |
| Anime             | Episodes                  | Episode progress; no group; future airing schedule, with next episode in summary    |
| Audiobook         | Canonical minutes         | Author/Narrator credits, unlinked contributors, square cover                        |
| Visual Novel      | Canonical minutes         | No group; developer person credits; screenshots are gallery-only                    |
| Video Game        | Recorded `timeSpent` only | Community time-to-beat is never consumed time; IGDB artwork appears in the gallery  |

Flat summaries return `{ summary, entitySchemaSlug }`; activity returns completion count, consumed
amount, unknown count, processing state, truncation, and events. Unknown measures render lower-bound totals,
not zero. Anime/Manga progress labels use the latest recorded position; the in-progress percentage is
that position divided by the total of its unit (episodes, chapters or volumes) when both are known,
else the latest recorded percentage.
`shared/consumption-recipes.ts` reads canonical contributions. A pending or failed fold replaces
the detail figures with an explicit state. Independent numbered items remain separate activity rows;
their editor supports item number/unit, chapter volume context, date precision, and recorded time.
Schemas without a
group omit both `groupSlug` and group descriptor copy. Unlinked credits appear as non-clickable
creator tiles and do not contribute sync marks.

Games use `video-game-to-video-game` from original to derivative. IGDB `version_parent` takes
precedence over `parent_game`; Bundle edges are omitted. Reverse lookups page outgoing groups
through durable continuations and reconcile authoritatively only after complete coverage.
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
people and company lists, including unlinked contributors. Credit pages preserve overview ordering,
roles, and declared character fields. All credits are included without filters. The credits and image
gallery share the detail modal frame.

Creators have no lifecycle, ownership toggle, or Log activity action. Activity combines reviews and
collection changes. Person facts use provider birth/death data without inventing ages for partial or
future dates. Person art is portrait; company logos are square and contain-fit. Only HTTP(S) links
are rendered.

All People lists explicitly saved people and people credited on the current user's saved media or
credit-bearing groups. Credit-based inclusion does not save the person or change their library badge.
Credits on another user's library alone do not include a person. Other saved views retain their
explicit library-membership scope.

### Home And Refresh

Cross-schema home recipes live in `shared/`; `manifest/query-recipes.ts` owns saved-view data sources.

- `lifecycle-list-recipes.ts` lists library media by current state and recent activity, reusing
  canonical episodic next-up and flat progress.
- `discovery-recipes.ts` selects suggestions from the latest completion that still has suggestions
  and interleaves the latest per-schema trending ranks. Both exclude known NSFW entries.
- Collection recommendations (`collectionPages.recommendations`) rank every title that collection
  members suggest by how many members suggest it, then by name, with name search and cursor pages.
  They exclude the collection's own members and known NSFW titles but keep library titles, which
  show the in-library mark. The page separates a collection whose members have no suggestions from
  one whose suggestions are all already members, and a missing or inaccessible collection.
- `upcoming-recipes.ts` feeds the home Upcoming rail from four sources: unwatched regular show and
  podcast episodes of in-progress, caught-up or monitored titles; anime airings after the latest
  watched episode for in-progress or monitored anime; and monitored, incomplete flat releases
  (anime premieres included). States come from the stored library summary. Dates use the client's
  local `fromDate`..`untilDate`; anime airings use the local-midnight instant window, excluding the
  provider's UTC-midnight premiere entry that the release source already lists. Undated items
  never appear, and stored dates are shown without waiting on provider freshness. Each source
  returns per-title `total` counts and its soonest occurrences, one per title when `onePerTitle`.
  The rail merges sources by local day and, per title, keeps the soonest entry with "+N more".
  User settings `upcomingDaysAhead` (default 14, 1–365) and `upcomingOnePerTitle` (default on)
  control the window and deduplication.
- `activity-recipes.ts` reads canonical title completions, minutes, active days, and type shares over
  52 local Monday-start weeks in four period-filtered aggregates, plus source reviews dated in the
  window. Episode activity counts toward its parent. Date-only and timed observations group on one
  local calendar day; unknown dates do not enter the period. Figures show whatever contributions are
  ready and converge as folds finish; the section neither waits for nor polls processing.

The Home activity section uses the account reporting timezone, stable `{ timeZone }` query input,
execution-clock windows, and account-midnight/DST scheduling, retains refresh-failure state, and
links to Analytics.

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
  complete or the latest progress/list-state `position` reaches it.
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
the list for the item's type first, then the item's own history and recent sources (each element of
stored `consumedOn` arrays), ignoring case. Images contain remote
URLs or managed keys plus a declared purpose. Providers prefer foreground art, preserve order within
purposes, and deduplicate URLs using their first classification. Translation may replace the entire
image array; omission preserves canonical images.

`providerRating` is always 0-100, rounded to 2 decimals. Providers with native /5 scales (Audible)
are multiplied by 20 and /10 scales (MyAnimeList, MangaUpdates) by 10; AniList, TMDB, IGDB, and VNDB
already report /100. Spotify and Listen Notes store popularity scores, not ratings.

TMDB watch providers exist only on Movie/Show. Population retains every country; the client filters
to the user's `viewingRegion` country preference in Settings → Plugin preferences → Media.
The default, Automatic (browser region), uses the browser locale's region; choosing a country
overrides it on every device. Unknown regions and empty results hide the section. Country entries contain the watch link and
offers in `stream`, `free`, `ads`, `rent`, `buy` order. The UI credits JustWatch and sorts services by
name within each offer kind.

TMDB movie and show `details` honour the population `level`. `/movie/{id}` and `/tv/{id}` carry
`append_to_response` for watch providers (and, for shows, episode groups) at `base`, adding credits
and recommendations at `full`; `base` returns no credit or recommendation groups. Images stay a
separate `/images` call without a language. Show seasons are fetched through `/tv/{id}` appends,
at most 20 seasons per request.

Title-side incoming creator inventories own authoritative credit metadata. Person and company
catalogs discover links additively, preserving richer title-owned roles, characters, and billing order.
Spotify artist-to-album associations are an exception: the complete artist catalog owns those links,
including appearances, while an album's primary artist list is additive discovery. It cannot remove
guest-artist associations that are absent from the primary artist list.
Population stays one hop deep: discovering related entities does not populate their inventories.
TMDB and TVDB retain every returned credit rather than a fixed cast preview. TMDB keeps all crew
jobs and billing order, including multiple roles for the same person. Show aggregate credits cover
all episodes; guest and uncredited flags are recorded only when supported by source evidence.

TMDB Show `episodeOrders` contains external IDs, descriptions, and ordered groups of episode IDs.
Positions belong to the alternate order, so stored episodes join by provider external ID, not season
and episode number. Unknown order types are dropped; an empty list clears removed orders. Every
listed supported order is fetched. Exceeding the sandbox budget fails population instead of silently
dropping orders.

TMDB companies return the first discover page of movies and shows from `details` with a
`{ page, totalPages }` continuation. The company `related` script fetches up to 40 further pages per
run, five at a time, and ends at the last page or TMDB's page 500.

Provider relationship pages declare complete, more, or source-limited coverage through the backend
SDK. Source-limited inventories fail visibly rather than deleting links or claiming full population.
Recommendations are curated selections, separate from exhaustive credits, group members, and
catalogs. Metron arc suggestions select the first three arcs and twenty issues per arc; TMDB trending
selects three pages. Execution limits are safety boundaries, not successful inventory truncation.

Metron series issues follow validated source next-page links through durable continuations and keep
global issue order across pages. IGDB reverse game lookups also use durable pages, without a fixed
total child-game cap. Company and collection game lists use complete embedded source arrays; the
top-level IGDB result limit does not bound those arrays.

iTunes episode lookup can return fewer episodes than the podcast's reported count, even when the
requested limit matches that count. Such a response fails before replacing child entities. Listen
Notes also fails if a known episode total is not reached before its page cursor stops advancing.
Unknown provider-search totals remain absent rather than being fabricated from a preview page.
Podcast base imports return root metadata without enumerating episodes or recommendations. Full
population validates the episode inventory before replacing children; an unknown iTunes total that
fills its two-hundred-episode lookup ceiling is incomplete, not proof of exhaustion.

MusicBrainz artist recordings and release groups use browse continuations. Album membership scans
all release candidates before loading the representative release's complete track list; root part
counts remain unknown until membership is available. Spotify artist catalogs include albums, singles,
appearances, and compilations in ten-item source pages. Artist tracks are discovered from those
albums rather than the top-tracks selection, and album tracks use fifty-item source pages. Related
runs batch bounded source requests and return continuations when work remains. Denied catalog
access is source-limited, never an authoritative empty inventory.

Provider refresh emits authoritative empty relationship groups where supported so removed links can
be deleted. YouTube Music artist credits use parsed item types, not section headings: songs and
videos become track credits, while albums (including singles and EPs) become album credits. List
and carousel item titles use their parsed string or text value; repeated releases are deduplicated, and
artist recommendations, playlists, and navigation items do not become credits.
Artist song and video credits follow their playlist endpoints through durable related pages. Album,
single, and EP carousels follow full discography endpoints, preserving endpoint params. Album members
come from the album's playlist endpoint rather than its initial shelf. Related pages replay from the
playlist root to retain each track's first global order, including non-adjacent duplicates, without
storing the inventory in a cursor. Replay fails beyond forty source pages. Known album track totals
must match before completion. Without a playlist endpoint, only a matching explicit track total proves
complete membership. Fetch failures fail the refresh instead of claiming complete coverage.
YouTube Music search follows continuation pages through bounded numeric-page replay. Sources without
an exact search total omit it; exceeding the forty-page replay budget fails explicitly.
AniList person and studio catalogs use durable twenty-five-item pages. Studios attached to an anime
are an unpaged source list. Airing schedules exhaust their pages or fail at the request budget;
anime and manga recommendations select the top twenty-five by rating.
TMDB and TVDB cast credits and AniList staff voice credits preserve character names in
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
history, reviews, ownership, monitoring, and collection memberships. Shows,
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
trying again. Automatic completions move with their history, and the fold's frozen inventories and
suppressed occurrences move with them, so an occurrence the user deleted on the source stays deleted on
the destination. Both actions use the
kernel's [entity user-data owner](../../kernel/backend/src/modules/entities/user-data/README.md),
immutable submission identities, and atomic stale-state checks.

`media-review-create` saves a review on a visible media, group, creator, season, or episode owned by
this plugin. Create and update accept a rating, nonblank text, or both; an empty review is rejected.
Both inputs carry nullable `text` and `rating` fields. Ratings use the finite 0–100 scale, including
zero and decimals. Text is trimmed; absent content is omitted from event properties. The spoiler
flag is stored only with text. Updates remove cleared content and preserve other declared fields,
including imported positional metadata. Imported rating-only reviews need no placeholder text.
The header and empty review activity tab use the UI SDK `ReviewComposer`, shared with collection reviews, with the rating
first, entered in the user's kernel rating scale, and spoiler controls shown only when text exists.
Activity rows, card presentations, and analytics show user ratings with the UI SDK rating components
in that scale; the header's provider rating stays a 0–100 provider fact. Clearing both fields while editing asks the
user to retain content or delete the review. Writes remain protected in demo sessions and use the
operation idempotency keys and stale-update snapshots. Successful writes refresh active queries
through the client SDK mutation notification. Review changes do not log consumption, and deleting
the last review does not remove library membership.

A review can name the one occurrence it is about through its optional `consumptionEventId`, a kernel
[event reference](../../kernel/backend/src/modules/events/README.md#event-references). Create and
update accept `consumptionEventId: string | null`; on update an absent field keeps the link and `null`
clears it. The target must be a `complete`, `item-complete`, `progress`, `dropped`, or `on_hold` event
of this plugin on the review's own entity, including automatic completions, so a show-episode review
names that episode's records. History events never carry review references, and several reviews may
name one occurrence. Deleting the occurrence, including a fold removing an automatic completion,
clears the link in the same write. The composer's **About** select lists the 20 newest occurrences of
the chosen subject and resets when the subject changes. When a finished completion opens the
composer, the select waits for that background log to settle and then chooses the newest completion
unless the user chose already. `shared/review-link-recipes.ts` resolves links for a timeline in
queries of at most 100 event IDs: review rows say what they are about in the schema's activity
vocabulary ("About your watch on Nov 3, 2026"), and consumption rows a review names show a
**Reviewed** badge that opens that review. Show and podcast watch days aggregate completions, so the
activity recipe starts from the newest 100 reviews naming a watch-day completion and attaches each
named completion to its watch day by day, episode and source.

`media-activity-log` writes one logged activity for a builtin media item: a completion, progress
(percent for flat media, a cumulative `position` in episodes for anime and possibly fractional
chapters or volumes for manga), a backlog/on-hold/dropped status,
or completions for up to 500 show or podcast episodes of one parent. Completions and progress keep
an optional `startedOn`; episode batches carry no start or time spent. Dates must satisfy
`startedOn ≤ finishedOn ≤ submittedAt`; "now" and unknown dates use `submittedAt`. Picked dates are
day-only by default and keep their `calendarDate`; **Add time** switches the sheet to local date and
time inputs in the user's time zone, and a timed entry writes an exact instant without
`calendarDate`. Time spent is entered as hours and minutes with the UI SDK `DurationField`. Writes are chunked
by the event batch limit with `<submissionId>:<chunk>` idempotency keys, so a retried submission
writes nothing twice. After a `saved` write of an entry with sources, it appends each trimmed source
to the settings list of the item's type (a show or podcast for episodes) unless a case-insensitive
match exists, stopping when the list holds 30; status entries never do. A settings read or write failure is
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
change is reported as stale instead of merged. Edits never touch `sessionEntityId` and touch `entityId` only
through `episodeEntityId`: a show or podcast episode `complete` or `progress` record can move to another
episode of the same show (across seasons) or podcast, which must be visible to the caller; moving to the
record's own episode changes nothing, and any other record or parent is refused. The session policy
then recomputes the record's session, and the fold refolds the subjects it leaves and joins.
The field matrix in `shared/media-activity-fields.ts` mirrors the declared event schemas; a field
the schema does not declare, and a stored record carrying keys its schema no longer declares, are
refused. Progress follows the logging rules: a position on Anime/Manga, a percent elsewhere. Moving
a date sets `occurredAt` (and `startedOn` where declared); an unknown date keeps `occurredAt` so
history is not reordered. The edit sheet opens a record without `calendarDate` with its local time
and keeps the start of progress and completions. Manga progress edits can switch the position's
unit; a chapter's volume context survives only while the unit stays chapters. Deletes accept up to 500 unique IDs, validate every 100-ID chunk before
the first write, and delete chunks in input order with `<submissionId>:<chunk>` keys. IDs that
resolve to nothing pass through as host no-ops, so a retry after a partial commit replays the same
chunks. A failure after a committed chunk returns `incomplete` for Retry; an earlier failure is a
rejection.

Activity and review rows in the Activity tab and complete history offer a row menu. Delete names
the number of records a folded row stands for; Edit appears only when the row is one completion,
progress update, or review, and opens the Log activity fields or the review composer. For an episode
record the sheet also shows the episode picker, prefilled with the current episode, and sends
`episodeEntityId` only when another one is chosen. Aggregated
daily watches in an episodic summary carry no record IDs and are edited from complete history.
Collection, library, and synced list-state rows have no menu.

History creation, edits, and deletions reconcile automatic completions in the same write.
Full-progress corrections can create or remove their derived completion; episode corrections reconcile
the affected parent and subsequent consumption cycles. Explicit completions are never removed by
inference. Editing an automatic completion makes it explicit; deleting one suppresses that occurrence
without deleting its supporting history. A later independent repeat can complete again. Automatic
completions run no after-hooks, so they send no notifications or Jellyfin pushes; a Jellyfin push fires
only for completions written by the user or an import. Library membership and monitoring are unchanged
by history correction.

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
AniList imports write one cumulative progress event per entry with an episode or chapter `position`;
AniList volumes ride on a chapter position as its `volume` context, and volume-only progress (zero
chapters, some volumes) writes a volume position, as MyAnimeList `my_read_volumes` does. IMDb imports write no consumption source. Jellyfin imports keep played items without a
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
- **Jellyfin:** both official and nested episode webhooks use series-level provider IDs only. Missing show IDs are
  resolved through TVDB's episode endpoint, or TMDB's IMDb/TVDB episode lookup followed by a
  series-name search verified against the season's episode IDs. Lookups are cached for one day;
  external-ID-only misses are retried on the next event. Completion uses `MarkPlayed` or
  `PlayedToCompletion`; historical `Played` flags do not complete a current rewatch.
- **Plex:** accepts JSON or the multipart `payload` field, ignoring thumbnail parts. Scrobble always
  reports 100%, even with an offset. Play without an offset reports zero; stop, pause, and resume
  without an offset are skipped before provider lookups. Shared admission filters zero progress.
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

Support is declared by `manifest/schemas/entity.ts`. State comes from editable history ordered by
`occurredAt`, source creation time, then source order, not a separately stored state. Automatic
completions retain their source-order keys so their later insertion cannot move them past same-time
activity. Explicit records use their own creation time and ID. Hooks use pinned projections of
immutable trigger evidence; current-state RyotQL cannot reconstruct omitted historical values.

| Hook family                     | Responsibility                                                                                                                                                                                                                                                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Library membership              | Required user-scoped entity/provider-import and event-batch hooks merge `in-media-library` properties without clearing annotations. The library never links to itself. A required batch hook (`batchMaxItems` 80) records `add-to-media-library` once per newly created membership in one write; idempotent upserts do not. |
| Association / relationship sync | Batch hooks filter projected changes; association resolves credits together, and sync uses the population batch leader. Item-count chunks remain subject to the separate invocation byte limit.                                                                                                                             |
| Entity updated                  | Async population hook compares projected trigger-time fields, treating image order as irrelevant, and emits monitoring signals.                                                                                                                                                                                             |
| Episodic session                | Before-event policy on episode creates and on episode updates that change `entityId` patches only `sessionEntityId` (a season-0 special stays sessionless); missing/ambiguous parents reject the event and caller session IDs are replaced.                                                                                 |
| Completion reconciliation       | No hook. The `fold.media-history` fold runs on every history write and writes automatic completions; see [the fold](#the-fold).                                                                                                                                                                                             |
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
"started". Anime/Manga progress, dropped and on-hold events carry a cumulative `position` ("consumed
through N") in episodes, chapters or volumes and no percent; a chapter's optional `volume` is context,
never a consumed volume. The Log activity sheet's Manga Chapter/Volume toggle defaults to the latest
position's unit; the next entry is that position + 1 in the same unit, capped at the unit's total, and
switching units starts at 1. The latest position is the one on the latest progress or list-state event that
carries one. Whole-entity completion carries no position. Reviews do not affect state.

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

### The fold

Every media schema declares `fold: { scriptSlug: "fold.media-history", eventSchemaSlugs }` over its
history schemas. `backend/media-fold.sandbox.ts` reads the subject, its history and, for a Show or
Podcast, its required episodes with `backend/fold/recipes.ts`. An episode with a parent session belongs
to the parent's fold, and a sessionless special to its own. `backend/fold/history.ts` derives automatic
completions, and `backend/fold/consumption.ts` allocates consumption contributions. Each run returns
the completions to change, one contribution per consumption event, the library summary for each
`in-media-library` link, and the fold's value.

The fold replays history in order, resetting coverage at each explicit or automatic cycle boundary. A
new Show or Podcast completion requires a terminal production status (`Ended`, `Canceled`, or
`Cancelled`, case-insensitive) and either an episode the fold has not counted before or the title newly
reaching that status, so unrelated edits to an old cycle cannot complete it. The fold's value holds
each occurrence with its key, status, sources and frozen inventory, plus the coverage sources it has
counted and whether the title was terminal. A frozen occurrence keeps its inventory, so later provider
changes do not rewrite past completions. Relationship changes still affect live coverage without
creating history. The fold reads changes from outside its own events, such as a new status or
inventory, because `media-entity-updated` and `media-relationship-sync` call
`requestFoldsForAllUsers`.

Completion time follows the closing coverage event; consumption sources are the ordered union of the
supporting completions' sources, deduplicated ignoring case. Source corrections can change that time or invalidate the completion.
A fold's writes commit with the write that caused them. If it cannot finish inline, the write still
commits and a `fold` job takes over; meanwhile the previous contributions and summaries stay visible and
processing reads as pending. A subject that keeps failing reads as failed, and its next write folds it
again.

100% progress completes other flat media. Anime/Manga complete when a progress event's
position reaches the total of its basis, in the same unit (episodes, chapters or volumes), or its
percent is 100; no completion is written when
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
Audiobookshelf, YouTube Music, and Spotify, written as one-item arrays; the browser extension keeps the page hostname as its single item.

Integration progress admission runs after population/episode resolution in `import.write-chunks`.
It accepts a percent or, for Anime/Manga, a position; an event with neither is rejected. Minimum
filtering, maximum clamping, and configured 100% debounce apply to percent only. Duplicate
suppression compares the latest committed or pending event of the same consumption source by unit and
position for positional events, otherwise by percent. The run guard serializes competing deliveries; failed writes
leave no completion claim. Missing sink timestamps are supplied and auto-completion retains the
trigger's time. Numeric normalization stays schema-owned. Source/event indexes and deterministic
population/write identities preserve attribution when admission filters records.

### Consumption source facts

`shared/consumption.ts` and `manifest/schemas/consumption.ts` define the retained source contract.
Progress, completion, independent item, dropped and on-hold events carry these fields. Backlog, reviews and AniList
`list-state` are not consumption observations.

| Field              | Stored meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `consumptionBasis` | `{ unit, property?, total? }`. Unit is `minutes`, `pages`, `episodes`, `chapters` or `volumes`. `total` is a finite nonnegative metadata estimate, never a recorded amount. Omission means metadata was unavailable; zero remains a known zero.                                                                                                                                                                                                                                                                                                                                                                                     |
| `progressPages`    | Finite nonnegative cumulative pages, on Book/Comic Book progress or status events. Exclusive with percent and positional progress. No rounding or conversion to percent on submission.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `progressPercent`  | Source-supported percent in `(0, 100]`, retained without decimal rounding. Exclusive with page/episode/chapter quantities. Missing denominator does not establish an absolute amount.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `position`         | `MediaPosition`: `{ unit: "episodes" \| "chapters" \| "volumes", position: number, volume?: number }`, on Anime/Manga events. On progress, dropped and on-hold it is the cumulative consumed-through position: Anime in integer episodes, Manga in chapters or volumes, either of which may be fractional. On `item-complete` it is required and identifies one independent item, never a quantity; Manga items may be chapters or volumes. On `list-state` it is the snapshot position, and on reviews the reviewed item. Optional `volume` is chapter context only, valid only with chapters, and contributes no volume quantity. |
| `consumedOn`       | Optional array of 1 to 10 sources, each 1 to 100 trimmed characters and unique ignoring case; absent when there are none. Operations accept `null` in an edit patch to remove it. `shared/consumed-on.ts` owns the schema.                                                                                                                                                                                                                                                                                                                                                                                                          |
| `timeSpent`        | Finite nonnegative cumulative minutes in this run, including on progress. Original manual time is recorded evidence. Empty means unknown; explicit zero is known.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `calendarDate`     | Valid `YYYY-MM-DD` date-only evidence within one day of the UTC date of `occurredAt`. Keep this calendar day in every reporting timezone. Never use it in hourly activity.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `dateUnknown`      | `true` means no reliable consumption date. Cannot coexist with `calendarDate`. The row's `occurredAt` is then only a deterministic ordering timestamp.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `sourceRun`        | Optional nonblank source-owned identity, at most 200 characters. All observations from one independent imported run share it. Distinct explicit source records use distinct identities, even when their other fields match. Immutable on edits. No entity/event references are embedded in this identity.                                                                                                                                                                                                                                                                                                                           |
| `sourceProgress`   | Optional immutable `{ unit: "episodes" \| "chapters" \| "volumes", position: number, volume?: number, percent: number }`, retaining a source's ambiguous position/percent pair, including partial volume-only evidence and chapter volume context. Position is nonnegative; percent is `[0, 100]`. This raw evidence does not itself establish consumption and never drives automatic completion.                                                                                                                                                                                                                                   |

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
`chapters/chapters`, except that a cumulative volume position uses `volumes/volumes`. Volumes are
never converted to chapters. Games use `{ unit: "minutes" }` with no metadata estimate. Show/Podcast parents
use `{ unit: "episodes" }` with no total; parent completion never supplies child duration.

Field shapes, position units per event, integer anime episodes, nonblank source runs and
calendar-date format are manifest property validation; manifest choices derive from the `shared/consumption.ts` literal
schemas. The single `media.consumption` before-policy keeps only cross-field and immutability rules and
captures a missing basis on creation across runtime writers. Updates retain the original basis, including an unavailable total,
unless an edit moves the cumulative position to another unit, which recaptures the basis for that unit. A
supplied basis on an event without a cumulative position may use either Manga mapping. Supplying an explicit
amount corrects the observation without rewriting the retained metadata. A supplied historical basis
must use the target's unit/property mapping. Automatic completions must supply retained evidence;
they cannot recapture current providers. A create carrying `sourceRun` must supply its basis, including
an explicitly unavailable total. Historical restore/migration supplies these facts directly.

Progress-derived completions copy their source's basis, calendar date, time spent, sources, and source run;
coverage-derived parent completions have only the parent episode basis and closing date evidence. Each
occurrence carries a `key` fixed when it is created from its source event; the completion stores it as
`completionKey`, which identifies derived output. Editing a completion makes it explicit, and deleting
it suppresses its occurrence. Source facts introduce no new typed entity references. Backups carry the
fold's value, so a restored title keeps its suppressions and frozen inventories; a restored completion
takes its source's new ID as its key when the title refolds.

Migration ordering and identity: use one deterministic `sourceRun` per original source occurrence
(for example `seen:<source-id>`), shared by its baseline and explicit completion. Do not deduplicate
independent completed source records. Do not manufacture intermediate amounts from update timestamps.
If a partial positional row does not prove consumed-through units, keep its original pair in
`sourceProgress`, leave the interpreted position absent, and retain any independently measured manual
time. The existing lifecycle replay still needs its separate reopening/boundary audit.

For an independently completed numbered Anime/Manga item, write `item-complete`, not `complete`
or cumulative `progress`. Retain one event and one original source identity per occurrence, even when
the same item number repeats. Do not add `progressPercent` or `progressPages`. Keep the target's
normal basis mapping (Manga uses chapters even for a volume occurrence); the item's `position`
provides its exact unit. These events do not change title status or
trigger title completion. They use normal library admission and activity edit/delete ownership.

### Canonical allocation

`shared/consumption-allocation.ts` separates bounded run planning from replay. A plan retains five
recorded high-water anchors; replay retains five recorded amounts and progress fractions. Neither
state grows with history length. Callers supply ordered observations and retained automatic/suppressed
boundary evidence. A named `sourceRun` groups only that source's observations. Unnamed explicit
completions close local runs. Independent numbered items never advance or reset a local progress run.
A local run's unit is fixed by its first cumulative position; a position in another unit starts a new
run. The plan retains that first position's basis, and an observation without a position (such as
the completion closing a volume run) is measured against it, so it estimates the remaining volumes
rather than the chapter total.

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
Show/Podcast completions supply title counts, never child minutes. The volume context of a
cumulative chapter position is not a consumed volume; only volume runs and explicit volume occurrences
establish that quantity, which Analytics reports separately from chapters. Date-only observations retain their calendar date, unknown dates stay undated, and
reporting periods filter contributions after the complete run is allocated.

`backend/fold/consumption.ts` allocates contributions for one title at a time from the history the fold
already read, and treats frozen run boundaries as data. A write to any history schema refolds the
title, so allocation always follows its own completions in the same run. Review, list-state, item,
and library-admission writes also fold. Episode contributions belong to the parent's fold, and specials
to their own.

`shared/consumption-recipes.ts` holds the shared predicates: a contribution is ready when its
projection is visible, and a reporting period
filters contributions before aggregation on the source `calendarDate` or `occurredAt` that attribution
copies. The consumption policy keeps a `calendarDate` within one day of the UTC date of `occurredAt`,
so each period also bounds `occurredAt` to one day before its start date through two days after its end
date, which the event `(user, plugin, schema, occurred_at)` index serves. `shared/analytics-recipes.ts` builds the
Analytics reads from them; each recipe takes the client query's `ResolvedReportingSelection` as
`reporting` rather than re-resolving a selection:

- `mediaAnalyticsSummaryRecipe` is one document: processing from the projection status of consumption
  events, the undated count from `dateUnknown` source rows, and per period the per-media-type measures with distinct titles and active days, global
  active days, and per-type reviews (rated count and average, on the review's own date, for Media
  entities only). Previous-period queries are omitted without a comparison. Processing is pending
  while any consumption event's subject is pending and failed when its fold failed.
- `mediaAnalyticsTrendRecipe` groups by one local calendar bucket per row (date-only evidence keeps
  its UTC calendar date) for the current and optional previous period, optionally for one media type.
  The contract's bucket limit bounds rows, so there is no client windowing. The daily heatmap reuses
  it with day grouping over at most the last 366 days of the period.
- `mediaAnalyticsHoursRecipe` groups exact instants by local hour. Rankings are one grouped aggregate
  of period contributions per title, paged with a grouped cursor; records page source rows with
  cursors. Media type labels come from the entity schema name.

Values are always shown; a pending or failed state adds a processing note. Analytics queries refresh
on the kernel's projection page refresh when consumption processing settles.

Home, flat-detail, and episodic lifetime metrics use canonical contributions. Current episode coverage
and lifecycle status remain separate. Episodic activity never replaces missing frozen time with current
provider runtime. Library rating and completion columns read live source/canonical rows; browse
`userRating` (a `rating` browse field), library summaries, card presentations, and analytics share
`plugins/media/shared/user-rating.ts` for the review rating value and its per-entity average; relationship
projections cache only lifecycle fields. Pending folds yield null completion totals/dates. The last
completion timestamp uses only timed evidence; date-only completions do not invent an instant.
