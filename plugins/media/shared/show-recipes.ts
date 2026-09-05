import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	coalesce,
	column,
	count,
	dateBucket,
	defineRecipe,
	eq,
	eventOrderDescending,
	exists,
	first,
	groupAscending,
	groupDescending,
	inArray,
	isNull,
	IsoDateString,
	join,
	literal,
	selectedAggregate,
	selectedField,
	selectedInclude,
	selectedMeasure,
	selectedOptionalRow,
	selectedRows,
	sum,
	table,
	type Recipe,
	type SelectedRow,
} from "@ryot-app/plugin-kit/ryotql";
import { EntityId, EventId } from "@ryot-app/plugin-kit/schema";

import {
	entityId,
	entityIdentitySelection,
	entitySchema,
	propertyJson,
	propertyNumber,
	propertyText,
	relationshipTo,
	type Table,
} from "./entity-selections";
import {
	EpisodeLifecycleStateSchema,
	EpisodicLifecycleStateSchema,
	episodeLifecycleStateExpression,
	episodicLifecycleExpressions,
	showEpisodicKindConfig,
} from "./lifecycle-expressions";
import { MediaImageListSchema } from "./media-image";
import {
	collectionMembershipInclude,
	compareMediaActivityDescending,
	eventSchemaIsOneOf,
	mediaActivityEventSelection,
	mediaActivityParentSlugs,
	mediaCollectionEventsQuery,
	mediaOverviewQueries,
	mediaSummarySelection,
	requestedSchemaQuery,
} from "./media-recipes";

const showEpisodeInclude = (season: Table, episodeLimit: number) => {
	const episode = table("entity", "episode");
	const episodeNumber = propertyNumber(episode, "episodeNumber");
	const episodeRelationship = table("relationship", "episodeRelationship");

	return selectedInclude(episode, {
		limit: episodeLimit,
		orderBy: [ascending(episodeNumber)],
		joins: [
			join(
				"inner",
				episodeRelationship,
				eq(column(episodeRelationship, "targetEntityId"), column(episode, "id")),
			),
		],
		where: and(
			entitySchema(episode, "show-episode"),
			relationshipTo(episodeRelationship, season, episode, "show-season-to-show-episode"),
		),
		selection: {
			...entityIdentitySelection(episode),
			episodeNumber: selectedField(episodeNumber, Schema.Number),
			images: selectedField(propertyJson(episode, "images"), MediaImageListSchema),
			seasonNumber: selectedField(propertyNumber(episode, "seasonNumber"), Schema.Number),
			runtime: selectedField(propertyNumber(episode, "runtime"), Schema.NullOr(Schema.Number)),
			publishDate: selectedField(
				propertyText(episode, "publishDate"),
				Schema.NullOr(Schema.String),
			),
			description: selectedField(
				propertyText(episode, "description"),
				Schema.NullOr(Schema.String),
			),
			state: selectedField(
				episodeLifecycleStateExpression(episode, "showEpisodeDetailLifecycle"),
				EpisodeLifecycleStateSchema,
			),
		},
	});
};

const showSeasonInclude = (seasonLimit: number) => {
	const season = table("entity", "season");
	const seasonNumber = propertyNumber(season, "seasonNumber");
	const seasonRelationship = table("relationship", "seasonRelationship");

	return selectedInclude(season, {
		limit: seasonLimit,
		orderBy: [ascending(seasonNumber)],
		joins: [
			join(
				"inner",
				seasonRelationship,
				eq(column(seasonRelationship, "targetEntityId"), column(season, "id")),
			),
		],
		where: and(
			entitySchema(season, "show-season"),
			relationshipTo(seasonRelationship, table("entity", "entity"), season, "show-to-show-season"),
		),
		selection: {
			...entityIdentitySelection(season),
			seasonNumber: selectedField(seasonNumber, Schema.Number),
			images: selectedField(propertyJson(season, "images"), MediaImageListSchema),
			releaseDate: selectedField(propertyText(season, "releaseDate"), Schema.NullOr(Schema.String)),
			description: selectedField(propertyText(season, "description"), Schema.NullOr(Schema.String)),
		},
	});
};

export const showSeasonsRecipe = defineRecipe(
	(input: { readonly entityId: string; readonly seasonLimit: number }) => {
		const entity = table("entity", "entity");
		return {
			map: ({ show }) => Result.succeed(show ?? null),
			queries: {
				show: selectedOptionalRow(entity, {
					selection: entityIdentitySelection(entity),
					orderBy: [ascending(column(entity, "id"))],
					include: { seasons: showSeasonInclude(input.seasonLimit) },
					where: and(entitySchema(entity, "show"), entityId(entity, input.entityId)),
				}),
			},
		};
	},
);

export const showSeasonEpisodesRecipe = defineRecipe(
	(input: { readonly seasonId: string; readonly episodeLimit: number }) => {
		const entity = table("entity", "season");
		return {
			map: ({ season }) => Result.succeed(season ?? null),
			queries: {
				season: selectedOptionalRow(entity, {
					selection: entityIdentitySelection(entity),
					orderBy: [ascending(column(entity, "id"))],
					include: { episodes: showEpisodeInclude(entity, input.episodeLimit) },
					where: and(entitySchema(entity, "show-season"), entityId(entity, input.seasonId)),
				}),
			},
		};
	},
);

export const showSummaryRecipe = defineRecipe(
	(input: { readonly entityId: string; readonly collectionLimit: number }) => {
		const entity = table("entity", "entity");
		const provider = table("sandboxProvider", "provider");
		const lifecycle = episodicLifecycleExpressions(
			showEpisodicKindConfig,
			entity,
			"showSummaryLifecycle",
		);
		return {
			map: ({ show, requested: requestedRow }) =>
				Result.succeed({ show: show ?? null, entitySchemaSlug: requestedRow?.schemaSlug ?? null }),
			queries: {
				requested: requestedSchemaQuery(input.entityId),
				show: selectedOptionalRow(entity, {
					orderBy: [ascending(column(entity, "id"))],
					where: and(entitySchema(entity, "show"), entityId(entity, input.entityId)),
					include: { collections: collectionMembershipInclude(input.collectionLimit) },
					joins: [join("left", provider, eq(column(entity, "providerId"), column(provider, "id")))],
					selection: {
						...mediaSummarySelection(entity, provider),
						state: selectedField(lifecycle.state, EpisodicLifecycleStateSchema),
						totalSeasons: selectedField(
							propertyNumber(entity, "totalSeasons"),
							Schema.NullOr(Schema.Number),
						),
						totalEpisodes: selectedField(
							propertyNumber(entity, "totalEpisodes"),
							Schema.NullOr(Schema.Number),
						),
					},
				}),
			},
		};
	},
);

const showPresentationSeasonCount = (show: Table) => {
	const season = table("entity", "presentationSeason");
	const relationship = table("relationship", "presentationShowSeason");
	return count(season, {
		joins: [
			join("inner", relationship, eq(column(relationship, "targetEntityId"), column(season, "id"))),
		],
		where: and(
			entitySchema(season, "show-season"),
			eq(column(relationship, "sourceEntityId"), column(show, "id")),
			eq(column(relationship, "relationshipSchemaSlug"), literal("show-to-show-season")),
		),
	});
};

const showPresentationEpisodeCount = (
	show: Table,
	alias: string,
	state?: "complete" | "in_progress",
) => {
	const episode = table("entity", `${alias}Episode`);
	const season = table("entity", `${alias}Season`);
	const showSeason = table("relationship", `${alias}ShowSeason`);
	const seasonEpisode = table("relationship", `${alias}SeasonEpisode`);
	return count(episode, {
		joins: [
			join(
				"inner",
				seasonEpisode,
				eq(column(seasonEpisode, "targetEntityId"), column(episode, "id")),
			),
			join("inner", season, eq(column(seasonEpisode, "sourceEntityId"), column(season, "id"))),
			join("inner", showSeason, eq(column(showSeason, "targetEntityId"), column(season, "id"))),
		],
		where: and(
			entitySchema(episode, "show-episode"),
			entitySchema(season, "show-season"),
			eq(column(showSeason, "sourceEntityId"), column(show, "id")),
			eq(column(showSeason, "relationshipSchemaSlug"), literal("show-to-show-season")),
			eq(column(seasonEpisode, "relationshipSchemaSlug"), literal("show-season-to-show-episode")),
			...(state === undefined
				? []
				: [eq(episodeLifecycleStateExpression(episode, `${alias}Lifecycle`), literal(state))]),
		),
	});
};

export const showPresentationRecipe = defineRecipe((entityIds: readonly string[]) => {
	const show = table("entity", "presentationShow");
	const lifecycle = episodicLifecycleExpressions(
		showEpisodicKindConfig,
		show,
		"showPresentationLifecycle",
	);
	return {
		map: ({ shows }) => Result.succeed(shows.items),
		queries: {
			shows: selectedRows(show, {
				limit: 100,
				orderBy: [ascending(column(show, "id"))],
				where: and(
					entitySchema(show, "show"),
					inArray(
						column(show, "id"),
						entityIds.map((requestedId) => literal(requestedId)),
					),
				),
				selection: {
					...entityIdentitySelection(show),
					state: selectedField(lifecycle.state, EpisodicLifecycleStateSchema),
					images: selectedField(propertyJson(show, "images"), MediaImageListSchema),
					storedSeasons: selectedField(showPresentationSeasonCount(show), Schema.Number),
					publishDate: selectedField(
						propertyText(show, "publishDate"),
						Schema.NullOr(Schema.String),
					),
					publishYear: selectedField(
						propertyNumber(show, "publishYear"),
						Schema.NullOr(Schema.Number),
					),
					productionStatus: selectedField(
						propertyText(show, "productionStatus"),
						Schema.NullOr(Schema.String),
					),
					storedEpisodes: selectedField(
						showPresentationEpisodeCount(show, "presentationStored"),
						Schema.Number,
					),
					watchedEpisodes: selectedField(
						showPresentationEpisodeCount(show, "presentationWatched", "complete"),
						Schema.Number,
					),
					inProgressEpisodes: selectedField(
						showPresentationEpisodeCount(show, "presentationProgress", "in_progress"),
						Schema.Number,
					),
				},
			}),
		},
	};
});

export const showOverviewRecipe = defineRecipe(
	(input: {
		readonly entityId: string;
		readonly peopleLimit: number;
		readonly companyLimit: number;
		readonly recommendationLimit: number;
	}) => ({ queries: mediaOverviewQueries({ ...input, slug: "show" }) }),
);

const showActivityEpisodeSlugs = ["review"] as const;

const showEpisodeMembership = (episode: Table, showEntityId: string, alias: string) => {
	const season = table("entity", `${alias}Season`);
	const showSeason = table("relationship", `${alias}ShowSeason`);
	const seasonEpisode = table("relationship", `${alias}SeasonEpisode`);
	return exists(showSeason, {
		joins: [
			join("inner", season, eq(column(showSeason, "targetEntityId"), column(season, "id"))),
			join(
				"inner",
				seasonEpisode,
				eq(column(seasonEpisode, "sourceEntityId"), column(season, "id")),
			),
		],
		where: and(
			entitySchema(season, "show-season"),
			eq(column(showSeason, "sourceEntityId"), literal(showEntityId)),
			eq(column(showSeason, "relationshipSchemaSlug"), literal("show-to-show-season")),
			relationshipTo(seasonEpisode, season, episode, "show-season-to-show-episode"),
		),
	});
};

const showActivityEpisodeSelection = (episode: Table) => ({
	episodeId: selectedField(column(episode, "id"), EntityId),
	episodeName: selectedField(column(episode, "name"), Schema.String),
	seasonNumber: selectedField(propertyNumber(episode, "seasonNumber"), Schema.Number),
	episodeNumber: selectedField(propertyNumber(episode, "episodeNumber"), Schema.Number),
	episodeRuntime: selectedField(propertyNumber(episode, "runtime"), Schema.NullOr(Schema.Number)),
});

const showActivityEpisode = (
	row: SelectedRow<ReturnType<typeof showActivityEpisodeSelection>>,
) => ({
	id: row.episodeId,
	name: row.episodeName,
	runtime: row.episodeRuntime,
	seasonNumber: row.seasonNumber,
	episodeNumber: row.episodeNumber,
});

const showActivitySeasonCoverage = (season: Table) => {
	const episode = table("entity", "coverageEpisode");
	const seasonEpisode = table("relationship", "coverageSeasonEpisode");
	const runtime = propertyNumber(episode, "runtime");
	const joins = [
		join(
			"inner",
			seasonEpisode,
			eq(column(seasonEpisode, "targetEntityId"), column(episode, "id")),
		),
	];
	const inSeason = and(
		entitySchema(episode, "show-episode"),
		relationshipTo(seasonEpisode, season, episode, "show-season-to-show-episode"),
	);
	const isWatched = and(
		inSeason,
		eq(episodeLifecycleStateExpression(episode, "coverageEpisodeLifecycle"), literal("complete")),
	);
	const completion = table("event", "coverageCompletion");
	const loggedMinutes = first(completion, {
		orderBy: eventOrderDescending(completion),
		select: propertyNumber(completion, "timeSpent"),
		where: and(
			eq(column(completion, "entityId"), column(episode, "id")),
			eq(column(completion, "eventSchemaSlug"), literal("complete")),
		),
	});
	return {
		episodeTotal: selectedField(count(episode, { joins, where: inSeason }), Schema.Number),
		watchedTotal: selectedField(count(episode, { joins, where: isWatched }), Schema.Number),
		watchedUnknownRuntime: selectedField(
			count(episode, { joins, where: and(isWatched, isNull(runtime)) }),
			Schema.Number,
		),
		watchedMinutes: selectedField(
			sum(episode, coalesce(loggedMinutes, runtime), { joins, where: isWatched }),
			Schema.NullOr(Schema.Number),
		),
	};
};

export const showActivityRecipe = defineRecipe(
	(input: {
		readonly entityId: string;
		readonly timeZone: string;
		readonly seasonLimit: number;
		readonly watchDayLimit: number;
		readonly parentEventLimit: number;
		readonly episodeEventLimit: number;
		readonly episodeProgressLimit: number;
		readonly collectionEventLimit: number;
	}) => {
		const show = table("entity", "activityShow");
		const watchDay = table("event", "watchDayEvent");
		const watchDayEpisode = table("entity", "watchDayEpisode");
		const season = table("entity", "coverageSeason");
		const parentEvent = table("event", "parentEvent");
		const watchEvent = table("event", "watchCountEvent");
		const episodeEvent = table("event", "episodeEvent");
		const eventEpisode = table("entity", "eventEpisode");
		const progressEvent = table("event", "progressEvent");
		const progressProbe = table("event", "progressProbe");
		const progressEpisode = table("entity", "progressEpisode");
		const showSeason = table("relationship", "coverageShowSeason");
		const isProgressOf = (event: Table) =>
			and(
				eq(column(event, "entityId"), column(progressEpisode, "id")),
				eq(column(event, "eventSchemaSlug"), literal("progress")),
			);
		return {
			map: ({
				totals,
				seasons,
				watchDays,
				parentEvents,
				episodeEvents,
				episodeProgress,
				collectionEvents,
			}) => {
				const events = [
					...parentEvents.items.map((row) => ({ ...row, kind: "parent" as const })),
					...episodeEvents.items.map(
						({ episodeId, episodeName, seasonNumber, episodeNumber, episodeRuntime, ...row }) => ({
							...row,
							progressPercent: null,
							kind: "episode" as const,
							episode: showActivityEpisode({
								episodeId,
								episodeName,
								seasonNumber,
								episodeNumber,
								episodeRuntime,
							}),
						}),
					),
					...episodeProgress.items.flatMap((row) =>
						row.milestone.items.map((milestone) => ({
							...milestone,
							text: null,
							rating: null,
							timeSpent: null,
							isSpoiler: null,
							kind: "episode" as const,
							episode: showActivityEpisode(row),
							eventSchemaSlug: "progress" as const,
						})),
					),
					...collectionEvents.items.map(({ collectionId, collectionName, ...row }) => ({
						...row,
						text: null,
						rating: null,
						timeSpent: null,
						isSpoiler: null,
						consumedOn: null,
						kind: "collection" as const,
						collection: { id: collectionId, name: collectionName },
					})),
				];
				return Result.succeed({
					seasons: seasons.items,
					watchDays: watchDays.items,
					watchCount: totals?.watchCount ?? 0,
					events: events.sort(compareMediaActivityDescending),
					truncated:
						seasons.pageInfo.hasMore ||
						watchDays.pageInfo?.hasMore === true ||
						parentEvents.pageInfo.hasMore ||
						episodeEvents.pageInfo.hasMore ||
						episodeProgress.pageInfo.hasMore ||
						collectionEvents.pageInfo.hasMore,
				});
			},
			queries: {
				collectionEvents: mediaCollectionEventsQuery({
					entityId: input.entityId,
					limit: input.collectionEventLimit,
				}),
				totals: selectedOptionalRow(show, {
					orderBy: [ascending(column(show, "id"))],
					where: and(entitySchema(show, "show"), entityId(show, input.entityId)),
					selection: {
						watchCount: selectedField(
							count(watchEvent, {
								where: and(
									eq(column(watchEvent, "entityId"), column(show, "id")),
									eq(column(watchEvent, "eventSchemaSlug"), literal("complete")),
								),
							}),
							Schema.Number,
						),
					},
				}),
				parentEvents: selectedRows(parentEvent, {
					limit: input.parentEventLimit,
					orderBy: eventOrderDescending(parentEvent),
					where: and(
						eq(column(parentEvent, "entityId"), literal(input.entityId)),
						eventSchemaIsOneOf(parentEvent, mediaActivityParentSlugs),
					),
					selection: {
						...mediaActivityEventSelection(parentEvent),
						startedOn: selectedField(
							propertyText(parentEvent, "startedOn"),
							Schema.NullOr(IsoDateString),
						),
						completedOn: selectedField(
							propertyText(parentEvent, "completedOn"),
							Schema.NullOr(IsoDateString),
						),
						eventSchemaSlug: selectedField(
							column(parentEvent, "eventSchemaSlug"),
							Schema.Literals(mediaActivityParentSlugs),
						),
					},
				}),
				seasons: selectedRows(season, {
					limit: input.seasonLimit,
					orderBy: [
						ascending(propertyNumber(season, "seasonNumber")),
						ascending(column(season, "id")),
					],
					joins: [
						join(
							"inner",
							showSeason,
							eq(column(showSeason, "targetEntityId"), column(season, "id")),
						),
					],
					selection: {
						id: selectedField(column(season, "id"), EntityId),
						seasonNumber: selectedField(propertyNumber(season, "seasonNumber"), Schema.Number),
						...showActivitySeasonCoverage(season),
					},
					where: and(
						entitySchema(season, "show-season"),
						eq(column(showSeason, "sourceEntityId"), literal(input.entityId)),
						eq(column(showSeason, "relationshipSchemaSlug"), literal("show-to-show-season")),
					),
				}),
				episodeEvents: selectedRows(episodeEvent, {
					limit: input.episodeEventLimit,
					orderBy: eventOrderDescending(episodeEvent),
					joins: [
						join(
							"inner",
							eventEpisode,
							eq(column(episodeEvent, "entityId"), column(eventEpisode, "id")),
						),
					],
					where: and(
						entitySchema(eventEpisode, "show-episode"),
						eventSchemaIsOneOf(episodeEvent, showActivityEpisodeSlugs),
						showEpisodeMembership(eventEpisode, input.entityId, "episodeEventShow"),
					),
					selection: {
						...mediaActivityEventSelection(episodeEvent),
						...showActivityEpisodeSelection(eventEpisode),
						eventSchemaSlug: selectedField(
							column(episodeEvent, "eventSchemaSlug"),
							Schema.Literals(showActivityEpisodeSlugs),
						),
					},
				}),
				episodeProgress: selectedRows(progressEpisode, {
					limit: input.episodeProgressLimit,
					selection: showActivityEpisodeSelection(progressEpisode),
					orderBy: [
						ascending(propertyNumber(progressEpisode, "seasonNumber")),
						ascending(propertyNumber(progressEpisode, "episodeNumber")),
						ascending(column(progressEpisode, "id")),
					],
					where: and(
						entitySchema(progressEpisode, "show-episode"),
						exists(progressProbe, { where: isProgressOf(progressProbe) }),
						eq(
							episodeLifecycleStateExpression(progressEpisode, "progressEpisodeLifecycle"),
							literal("in_progress"),
						),
						showEpisodeMembership(progressEpisode, input.entityId, "progressEpisodeShow"),
					),
					include: {
						milestone: selectedInclude(progressEvent, {
							limit: 1,
							where: isProgressOf(progressEvent),
							orderBy: eventOrderDescending(progressEvent),
							selection: {
								id: selectedField(column(progressEvent, "id"), EventId),
								createdAt: selectedField(column(progressEvent, "createdAt"), IsoDateString),
								occurredAt: selectedField(column(progressEvent, "occurredAt"), IsoDateString),
								consumedOn: selectedField(
									propertyText(progressEvent, "consumedOn"),
									Schema.NullOr(Schema.String),
								),
								progressPercent: selectedField(
									propertyNumber(progressEvent, "progressPercent"),
									Schema.NullOr(Schema.Number),
								),
							},
						}),
					},
				}),
				watchDays: selectedAggregate(watchDay, {
					limit: input.watchDayLimit,
					orderBy: [
						groupDescending("day"),
						groupAscending("seasonNumber"),
						groupAscending("episodeNumber"),
					],
					joins: [
						join(
							"inner",
							watchDayEpisode,
							eq(column(watchDay, "entityId"), column(watchDayEpisode, "id")),
						),
					],
					measures: {
						minutes: selectedMeasure(
							{ function: "sum", expr: propertyNumber(watchDay, "timeSpent") },
							Schema.NullOr(Schema.Number),
						),
					},
					where: and(
						entitySchema(watchDayEpisode, "show-episode"),
						eq(column(watchDay, "eventSchemaSlug"), literal("complete")),
						showEpisodeMembership(watchDayEpisode, input.entityId, "watchDayShow"),
					),
					groupBy: {
						episodeId: selectedField(column(watchDayEpisode, "id"), EntityId),
						episodeName: selectedField(column(watchDayEpisode, "name"), Schema.String),
						seasonNumber: selectedField(
							propertyNumber(watchDayEpisode, "seasonNumber"),
							Schema.Number,
						),
						consumedOn: selectedField(
							propertyText(watchDay, "consumedOn"),
							Schema.NullOr(Schema.String),
						),
						episodeNumber: selectedField(
							propertyNumber(watchDayEpisode, "episodeNumber"),
							Schema.Number,
						),
						runtime: selectedField(
							propertyNumber(watchDayEpisode, "runtime"),
							Schema.NullOr(Schema.Number),
						),
						day: selectedField(
							dateBucket(column(watchDay, "occurredAt"), {
								bucket: "day",
								timeZone: input.timeZone,
							}),
							IsoDateString,
						),
					},
				}),
			},
		};
	},
);

export type ShowActivityEvent = ShowActivityResult["events"][number];
export type ShowSeasonsResult = Recipe.Success<typeof showSeasonsRecipe>;
export type ShowSummaryResult = Recipe.Success<typeof showSummaryRecipe>;
export type ShowActivityResult = Recipe.Success<typeof showActivityRecipe>;
export type ShowOverviewResult = Recipe.Success<typeof showOverviewRecipe>;
export type ShowSeasonEpisodesResult = Recipe.Success<typeof showSeasonEpisodesRecipe>;
export type ShowPresentationData = Recipe.Success<typeof showPresentationRecipe>[number];
export type ShowActivityEpisode = Extract<ShowActivityEvent, { kind: "episode" }>["episode"];
