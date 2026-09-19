import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	castDate,
	castNumber,
	column,
	count,
	defineRecipe,
	eq,
	exists,
	first,
	gte,
	IsoDateString,
	isNull,
	jsonArrayExists,
	jsonArrayFirst,
	jsonElement,
	jsonPath,
	literal,
	lt,
	lte,
	neq,
	or,
	selectedField,
	selectedInclude,
	selectedRows,
	table,
	type Recipe,
} from "@ryot-app/plugin-kit/ryotql";

import { AiringScheduleListSchema } from "./anime";
import {
	entityIdentitySelection,
	entitySchema,
	libraryLinkExists,
	propertyJson,
	propertyNumber,
	propertyText,
	type Table,
} from "./entity-selections";
import {
	episodeDisplayStateExpression,
	episodicEpisodeQuery,
	episodicLifecycleExpressions,
	mediaLifecycleExpressions,
	showEpisodicKindConfig,
	type ScalarExpression,
} from "./lifecycle-expressions";
import { MediaImageListSchema } from "./media-image";

const airingEntitySelection = (entity: Table) => ({
	...entityIdentitySelection(entity),
	images: selectedField(propertyJson(entity, "images"), MediaImageListSchema),
});

const isMonitored = (entity: Table, alias: string) =>
	libraryLinkExists(entity, alias, "media-monitoring");

const publishDate = (entity: Table) =>
	castDate(jsonPath(column(entity, "properties"), "publishDate"));

/**
 * One show's regular episodes that are not complete by display state. Airing is not filtered: the
 * window is the client's local dates, which may include episodes that aired today.
 */
const unwatchedShowEpisodes = (show: Table, alias: string) => {
	const episode = table("entity", `${alias}Episode`);
	const scope = episodicEpisodeQuery(showEpisodicKindConfig, show, episode, alias, "any");
	const [seasonNumber, episodeNumber] = scope.position;
	if (!seasonNumber || !episodeNumber) {
		throw new Error("Show episodes are positioned by season and episode number");
	}
	return {
		episode,
		joins: scope.joins,
		where: and(
			scope.where,
			neq(episodeDisplayStateExpression(episode, show, `${alias}State`), literal("complete")),
		),
		order: [
			ascending(publishDate(episode)),
			ascending(seasonNumber),
			ascending(episodeNumber),
			ascending(column(episode, "id")),
		] as const,
	};
};

/**
 * One row per in-library show that is in progress, caught up, or monitored and has an unwatched
 * regular episode dated within `from`..`until` (the client's local dates), soonest first. `episode`
 * is the soonest such episode and `sameDayCount` counts the unwatched episodes dated that day,
 * itself included.
 */
export const showsAiringSoonRecipe = defineRecipe(
	(input: { readonly from: string; readonly until: string; readonly limit: number }) => {
		const show = table("entity", "airingShow");
		const lifecycle = episodicLifecycleExpressions(showEpisodicKindConfig, show, "airingLifecycle");
		const inWindow = (episode: Table) =>
			and(
				gte(publishDate(episode), castDate(literal(input.from))),
				lte(publishDate(episode), castDate(literal(input.until))),
			);
		const candidate = unwatchedShowEpisodes(show, "airingCandidate");
		const soonest = unwatchedShowEpisodes(show, "airingSoonest");
		const tile = unwatchedShowEpisodes(show, "airingTile");
		const sameDay = unwatchedShowEpisodes(show, "airingSameDay");
		return {
			map: ({ shows }) =>
				Result.succeed(
					shows.items.flatMap(({ episode: episodes, ...entity }) => {
						const [row] = episodes.items;
						if (row === undefined) {
							return [];
						}
						const { sameDayCount, ...episode } = row;
						return [{ entity, episode, sameDayCount }];
					}),
				),
			queries: {
				shows: selectedRows(show, {
					limit: input.limit,
					selection: airingEntitySelection(show),
					orderBy: [
						ascending(
							first(soonest.episode, {
								joins: soonest.joins,
								orderBy: soonest.order,
								select: publishDate(soonest.episode),
								where: and(soonest.where, inWindow(soonest.episode)),
							}),
						),
						ascending(column(show, "id")),
					],
					where: and(
						entitySchema(show, "show"),
						libraryLinkExists(show, "airingLibrary", "in-media-library"),
						or(
							eq(lifecycle.state, literal("in_progress")),
							eq(lifecycle.state, literal("caught_up")),
							isMonitored(show, "airingMonitoring"),
						),
						exists(candidate.episode, {
							joins: candidate.joins,
							where: and(candidate.where, inWindow(candidate.episode)),
						}),
					),
					include: {
						episode: selectedInclude(tile.episode, {
							limit: 1,
							joins: tile.joins,
							orderBy: [...tile.order],
							where: and(tile.where, inWindow(tile.episode)),
							selection: {
								...airingEntitySelection(tile.episode),
								publishDate: selectedField(
									propertyText(tile.episode, "publishDate"),
									Schema.String,
								),
								seasonNumber: selectedField(
									propertyNumber(tile.episode, "seasonNumber"),
									Schema.Number,
								),
								episodeNumber: selectedField(
									propertyNumber(tile.episode, "episodeNumber"),
									Schema.Number,
								),
								sameDayCount: selectedField(
									count(sameDay.episode, {
										joins: sameDay.joins,
										where: and(
											sameDay.where,
											eq(publishDate(sameDay.episode), publishDate(tile.episode)),
										),
									}),
									Schema.Number,
								),
							},
						}),
					},
				}),
			},
		};
	},
);

export type ShowsAiringSoonResult = Recipe.Success<typeof showsAiringSoonRecipe>;

const DATE_ONLY_TIME = "T00:00:00.000Z";

/**
 * In-library anime that is in progress or monitored with a scheduled episode in `now`..`until`
 * (instants), soonest first. A provider that knows only the premiere date stores it as UTC
 * midnight of the entity's `publishDate`; that entry is windowed by the local dates
 * `fromDate`..`untilDate` and reported `dateOnly` with `airsAt` as the `YYYY-MM-DD` date, so it is
 * never shifted across a day boundary. `sameDayCount` counts the schedule entries airing at that
 * same instant, itself included.
 */
export const animeAiringSoonRecipe = defineRecipe(
	(input: {
		readonly now: string;
		readonly until: string;
		readonly fromDate: string;
		readonly untilDate: string;
	}) => {
		const anime = table("entity", "airingAnime");
		const lifecycle = mediaLifecycleExpressions(anime, "airingLifecycle");
		const schedule = jsonPath(column(anime, "properties"), "airingSchedule");
		const airingAt = castDate(jsonPath(jsonElement(), "airingAt"));
		const episodeNumber = castNumber(jsonPath(jsonElement(), "episode"));
		const premiereDate = castDate(propertyText(anime, "publishDate"));
		const inWindow = or(
			and(
				eq(airingAt, premiereDate),
				gte(airingAt, castDate(literal(input.fromDate))),
				lte(airingAt, castDate(literal(input.untilDate))),
			),
			and(
				or(isNull(premiereDate), neq(airingAt, premiereDate)),
				gte(airingAt, castDate(literal(input.now))),
				lt(airingAt, castDate(literal(input.until))),
			),
		);
		const next = (select: ScalarExpression) =>
			jsonArrayFirst(schedule, {
				select,
				where: inWindow,
				orderBy: [ascending(airingAt), ascending(episodeNumber)],
			});
		const nextAiringAt = next(airingAt);
		return {
			map: ({ anime: rows }) =>
				Result.succeed(
					rows.items.map(
						({
							nextEpisode,
							airingSchedule,
							publishDate: date,
							nextAiringAt: airsAt,
							...entity
						}) => {
							const dateOnly = date !== null && airsAt === `${date}${DATE_ONLY_TIME}`;
							return {
								entity,
								dateOnly,
								airsAt: dateOnly ? date : airsAt,
								episodeLabel: `Episode ${nextEpisode}`,
								sameDayCount: (airingSchedule ?? []).filter(
									(entry) => Date.parse(entry.airingAt) === Date.parse(airsAt),
								).length,
							};
						},
					),
				),
			queries: {
				anime: selectedRows(anime, {
					orderBy: [ascending(nextAiringAt), ascending(column(anime, "id"))],
					where: and(
						entitySchema(anime, "anime"),
						libraryLinkExists(anime, "airingLibrary", "in-media-library"),
						or(eq(lifecycle.state, literal("in_progress")), isMonitored(anime, "airingMonitoring")),
						jsonArrayExists(schedule, inWindow),
					),
					selection: {
						...airingEntitySelection(anime),
						nextAiringAt: selectedField(nextAiringAt, IsoDateString),
						nextEpisode: selectedField(next(episodeNumber), Schema.Number),
						publishDate: selectedField(
							propertyText(anime, "publishDate"),
							Schema.NullOr(Schema.String),
						),
						airingSchedule: selectedField(
							propertyJson(anime, "airingSchedule"),
							AiringScheduleListSchema,
						),
					},
				}),
			},
		};
	},
);

export type AnimeAiringSoonResult = Recipe.Success<typeof animeAiringSoonRecipe>;
