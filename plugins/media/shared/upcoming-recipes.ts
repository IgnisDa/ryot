import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	castDate,
	castNumber,
	column,
	countAll,
	dateAdd,
	defineRecipe,
	entitySchemaPredicate,
	eq,
	groupAscending,
	gt,
	gte,
	inArray,
	isNull,
	IsoDateString,
	join,
	jsonArrayCount,
	jsonArrayExists,
	jsonArrayFirst,
	jsonElement,
	jsonElementsJoin,
	jsonPath,
	literal,
	localDate,
	lte,
	neq,
	or,
	parameters,
	reportingTimeZone,
	schemaOwnerPredicate,
	selectedAggregate,
	selectedField,
	selectedInclude,
	type SelectedRow,
	selectedRows,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import type { PluginIdentityReference } from "@ryot-app/plugin-kit/schema";

import {
	mediaImageOfPurpose,
	mediaLocalizedImageOfPurpose,
	mediaPresentationImageSelection,
} from "./entity-presentations";
import {
	entityIdentitySelection,
	libraryLinkExists,
	propertyNumber,
	propertyText,
	type Table,
} from "./entity-selections";
import {
	joinedLibraryLink,
	libraryMembershipJoin,
	librarySummary,
	type LibrarySummaryKind,
} from "./library-summary";
import {
	episodeDisplayStateExpression,
	episodeReleaseCandidates,
	episodeReleaseDay,
	episodeReleaseOrder,
	episodeReleaseTime,
	episodicEpisodeQuery,
	type EpisodicKindConfig,
	occursAt,
	podcastEpisodicKindConfig,
	publishDate,
	reportingToday,
	type ScalarExpression,
	showEpisodicKindConfig,
} from "./lifecycle-expressions";
import { latestPosition } from "./lifecycle-list-recipes";
import { MediaImageAssetSchema } from "./media-image";
import { flatMediaSchemaSlugs } from "./media-schema-slugs";
import { catalogMessage } from "./messages.generated";
import { DEFAULT_UPCOMING_DAYS_AHEAD, MAX_UPCOMING_DAYS_AHEAD } from "./upcoming-settings";

const upcomingParameters = parameters({
	fields: {
		onePerTitle: {
			type: "boolean",
			defaultValue: true,
			label: catalogMessage("query-parameter.one-per-title"),
			description: "Return only the next occurrence for each title",
		},
		daysAhead: {
			type: "integer",
			defaultValue: DEFAULT_UPCOMING_DAYS_AHEAD,
			label: catalogMessage("query-parameter.days-ahead"),
			validation: { minimum: 1, maximum: MAX_UPCOMING_DAYS_AHEAD },
			description:
				"Include releases from today through this many reporting-zone calendar days ahead",
		},
	},
});
type UpcomingInput = { readonly reference: PluginIdentityReference };
const TITLE_LIMIT = 20;
const lastDay = dateAdd(reportingToday, upcomingParameters.value("daysAhead"), "day");
const upcomingEntitySelection = (entity: Table) => ({
	...entityIdentitySelection(entity),
	...mediaPresentationImageSelection(entity),
	backdrop: selectedField(
		mediaImageOfPurpose(entity, "backdrop"),
		Schema.NullOr(MediaImageAssetSchema),
	),
});

const WINDOW_EPISODE_LIMIT = 100;
const WINDOW_TITLE_LIMIT = 1000;
const inDateWindow = (date: ScalarExpression) =>
	and(gte(castDate(date), reportingToday), lte(castDate(date), lastDay));
const followed = (entity: Table, alias: string, kind: LibrarySummaryKind) => {
	const library = libraryMembershipJoin(entity, `${alias}Library`);
	return {
		join: library.join,
		monitored: libraryLinkExists(entity, `${alias}Monitoring`, "media-monitoring"),
		lifecycleState: librarySummary(joinedLibraryLink(library.membership), {
			kind,
			entity,
			alias: `${alias}Summary`,
		}).lifecycleState,
	};
};

const windowEpisodes = (config: EpisodicKindConfig, input: UpcomingInput) => {
	const alias = `upcoming${config.kind}`;
	const parent = table("entity", alias);
	const episode = table("entity", `${alias}Episode`);
	const follow = followed(parent, alias, config);
	const scope = episodicEpisodeQuery(config, parent, episode, `${alias}Episode`, "any");
	return {
		parent,
		episode,
		position: scope.position,
		joins: [
			...scope.joins,
			join("inner", parent, eq(scope.parentId, column(parent, "id"))),
			follow.join,
		],
		where: and(
			scope.where,
			...episodeReleaseCandidates(episode, reportingToday, lastDay),
			inDateWindow(episodeReleaseDay(episode)),
			entitySchemaPredicate(parent, config.parentSchemaSlug, input.reference),
			or(
				inArray(follow.lifecycleState, [literal("in_progress"), literal("caught_up")]),
				follow.monitored,
			),
			neq(episodeDisplayStateExpression(episode, parent, `${alias}State`), literal("complete")),
		),
	};
};

const episodeSelection = (parent: Table, episode: Table) => ({
	...upcomingEntitySelection(parent),
	occurrenceId: selectedField(column(episode, "id"), Schema.String),
	releaseDay: selectedField(episodeReleaseDay(episode), IsoDateString),
	onePerTitle: selectedField(upcomingParameters.value("onePerTitle"), Schema.Boolean),
	episodeNumber: selectedField(propertyNumber(episode, "episodeNumber"), Schema.Finite),
	airingAt: selectedField(episodeReleaseTime(episode).instant, Schema.NullOr(IsoDateString)),
	seasonNumber: selectedField(
		propertyNumber(episode, "seasonNumber"),
		Schema.NullOr(Schema.Finite),
	),
	occurrenceImage: selectedField(
		mediaLocalizedImageOfPurpose(episode, "still"),
		Schema.NullOr(MediaImageAssetSchema),
	),
});

const episodicEpisodes = (config: EpisodicKindConfig, input: UpcomingInput) => {
	const { joins, where, parent, episode, position } = windowEpisodes(config, input);
	return selectedRows(episode, {
		joins,
		where,
		limit: WINDOW_EPISODE_LIMIT,
		selection: episodeSelection(parent, episode),
		orderBy: [
			...episodeReleaseOrder(episode),
			...position.map((value) => ascending(value)),
			ascending(column(episode, "id")),
		],
	});
};

const episodicTotals = (config: EpisodicKindConfig, input: UpcomingInput) => {
	const { joins, where, parent, episode } = windowEpisodes(config, input);
	return selectedAggregate(episode, {
		joins,
		where,
		limit: WINDOW_TITLE_LIMIT,
		measures: { total: countAll },
		orderBy: [groupAscending("id")],
		groupBy: { id: selectedField(column(parent, "id"), Schema.String) },
	});
};

type EpisodeRow = SelectedRow<ReturnType<typeof episodeSelection>>;

/**
 * Rows arrive soonest first, so a title reached only past `WINDOW_EPISODE_LIMIT` is dropped before any
 * title that airs sooner. Past `WINDOW_TITLE_LIMIT` titles, `total` falls back to the rows at hand.
 */
const titlesFromEpisodes = (
	rows: readonly EpisodeRow[],
	totals: readonly { readonly id: string; readonly total: number }[],
) => {
	const totalOf = new Map(totals.map(({ id, total }) => [id, total]));
	const titles = new Map<string, [EpisodeRow, ...EpisodeRow[]]>();
	for (const row of rows) {
		const episodes = titles.get(row.id);
		if (episodes) {
			episodes.push(row);
		} else {
			titles.set(row.id, [row]);
		}
	}
	return [...titles.values()]
		.sort(
			([a], [b]) =>
				a.releaseDay.localeCompare(b.releaseDay) ||
				(a.airingAt ?? "").localeCompare(b.airingAt ?? "") ||
				a.id.localeCompare(b.id),
		)
		.slice(0, TITLE_LIMIT)
		.map((episodes) => {
			const {
				onePerTitle,
				airingAt: _airingAt,
				releaseDay: _releaseDay,
				occurrenceId: _occurrenceId,
				seasonNumber: _seasonNumber,
				episodeNumber: _episodeNumber,
				occurrenceImage: _occurrenceImage,
				...entity
			} = episodes[0];
			return {
				entity,
				total: totalOf.get(entity.id) ?? episodes.length,
				occurrences: episodes
					.slice(0, onePerTitle ? 1 : TITLE_LIMIT)
					.map((episode) => ({
						key: episode.occurrenceId,
						image: episode.occurrenceImage,
						dateOnly: episode.airingAt === null,
						airsAt: episode.airingAt ?? episode.releaseDay.slice(0, 10),
						episode: { seasonNumber: episode.seasonNumber, episodeNumber: episode.episodeNumber },
					})),
			};
		});
};

const airingSchedule = (entity: Table) => jsonPath(column(entity, "properties"), "airingSchedule");

/**
 * Scheduled episodes airing in the instant window after the latest watched episode. An entry at
 * UTC midnight of the premiere date is the provider's date-only premiere, which the release
 * source already lists.
 */
const animeWindow = (
	anime: Table,
	entry: ScalarExpression,
	airingAt: ScalarExpression,
	_input: UpcomingInput,
) => {
	const watched = latestPosition(anime);
	const premiere = publishDate(anime);
	return and(
		or(isNull(watched), gt(castNumber(jsonPath(entry, "episode")), watched)),
		or(isNull(premiere), neq(airingAt, premiere)),
		inDateWindow(localDate(airingAt, { timeZone: reportingTimeZone })),
	);
};

const animeTitles = (input: UpcomingInput) => {
	const anime = table("entity", "upcomingAnime");
	const follow = followed(anime, "upcomingAnime", "flat");
	const entry = jsonElement();
	const airingAt = castDate(jsonPath(entry, "airingAt"));
	const inWindow = animeWindow(anime, entry, airingAt, input);
	const listed = table("entity", "upcomingAnimeListed");
	const element = jsonElementsJoin("inner", "upcomingAnimeElement", airingSchedule(listed));
	const listedEntry = column(element, "value");
	const listedAiringAt = castDate(jsonPath(listedEntry, "airingAt"));
	const listedEpisode = castNumber(jsonPath(listedEntry, "episode"));
	return selectedRows(anime, {
		limit: TITLE_LIMIT,
		joins: [follow.join],
		where: and(
			entitySchemaPredicate(anime, "anime", input.reference),
			or(eq(follow.lifecycleState, literal("in_progress")), follow.monitored),
			jsonArrayExists(airingSchedule(anime), inWindow),
		),
		selection: {
			...upcomingEntitySelection(anime),
			onePerTitle: selectedField(upcomingParameters.value("onePerTitle"), Schema.Boolean),
			total: selectedField(jsonArrayCount(airingSchedule(anime), inWindow), Schema.Finite),
		},
		orderBy: [
			ascending(
				jsonArrayFirst(airingSchedule(anime), {
					where: inWindow,
					select: airingAt,
					orderBy: [ascending(airingAt), ascending(castNumber(jsonPath(entry, "episode")))],
				}),
			),
			ascending(column(anime, "id")),
		],
		include: {
			occurrences: selectedInclude(listed, {
				joins: [element],
				limit: TITLE_LIMIT,
				orderBy: [ascending(listedAiringAt), ascending(listedEpisode)],
				where: and(
					eq(column(listed, "id"), column(anime, "id")),
					animeWindow(listed, listedEntry, listedAiringAt, input),
				),
				selection: {
					airingAt: selectedField(listedAiringAt, IsoDateString),
					episodeNumber: selectedField(listedEpisode, Schema.Finite),
				},
			}),
		},
	});
};

const releaseTitles = (input: UpcomingInput) => {
	const entity = table("entity", "upcomingRelease");
	const follow = followed(entity, "upcomingRelease", "flat");
	const date = occursAt(entity);
	return selectedRows(entity, {
		limit: TITLE_LIMIT,
		joins: [follow.join],
		orderBy: [ascending(date), ascending(column(entity, "id"))],
		selection: {
			...upcomingEntitySelection(entity),
			publishDate: selectedField(propertyText(entity, "publishDate"), Schema.String),
		},
		where: and(
			schemaOwnerPredicate(entity, "entitySchemaPluginId", input.reference),
			inArray(
				column(entity, "entitySchemaSlug"),
				flatMediaSchemaSlugs.map((slug) => literal(slug)),
			),
			follow.monitored,
			or(isNull(follow.lifecycleState), neq(follow.lifecycleState, literal("complete"))),
			inDateWindow(date),
		),
	});
};

/**
 * Upcoming titles from show and podcast episodes, anime airings and monitored releases, each
 * source soonest first. Date and instant windows use the server clock and reporting timezone. `total` counts a title's occurrences in the window and
 * `occurrences` lists the soonest, one per title when `onePerTitle`.
 */
export const upcomingRecipe = (input: UpcomingInput) =>
	defineRecipe({
		parameters: upcomingParameters.schema,
		queries: {
			anime: animeTitles(input),
			releases: releaseTitles(input),
			shows: episodicEpisodes(showEpisodicKindConfig, input),
			showTotals: episodicTotals(showEpisodicKindConfig, input),
			podcasts: episodicEpisodes(podcastEpisodicKindConfig, input),
			podcastTotals: episodicTotals(podcastEpisodicKindConfig, input),
		},
		map: ({ anime, shows, podcasts, releases, showTotals, podcastTotals }) =>
			Result.succeed([
				...titlesFromEpisodes(shows.items, showTotals.items),
				...titlesFromEpisodes(podcasts.items, podcastTotals.items),
				...anime.items.map(({ total, occurrences, onePerTitle, ...entity }) => ({
					total,
					entity,
					occurrences: occurrences.items
						.slice(0, onePerTitle ? 1 : TITLE_LIMIT)
						.map(({ airingAt, episodeNumber }) => ({
							image: null,
							dateOnly: false,
							airsAt: airingAt,
							episode: { episodeNumber, seasonNumber: null },
							key: `${entity.id}:${episodeNumber}:${airingAt}`,
						})),
				})),
				...releases.items.map(({ publishDate: day, ...entity }) => ({
					entity,
					total: 1,
					occurrences: [
						{ airsAt: day, image: null, episode: null, dateOnly: true, key: entity.id },
					],
				})),
			]),
	});
