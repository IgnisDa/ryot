import {
	buildQueryEngineAggregateDocument,
	buildQueryEngineEntityRowsDocument,
	buildQueryEngineRowsDocument,
	queryEngineEntitySource,
	queryEngineInclude,
	queryEngineNestedEventSource,
	queryEngineRelationshipSource,
} from "@ryot/query-engine/documents";
import {
	queryEngineAggregate,
	queryEngineAnd,
	queryEngineComparison,
	queryEngineExists,
	queryEngineField,
	queryEngineIdentityFields,
	queryEngineLiteral,
	queryEngineMeasureRef,
	queryEngineNot,
	queryEngineOrder,
	queryEnginePropertyRef,
	queryEngineSystemRef,
	type QueryEngineNonEmptyArray,
} from "@ryot/query-engine/primitives";
import { buildDefaultSavedViewQueryDocument } from "@ryot/query-engine/recipes/app";

const entityAlias = "entity";

export const buildDefaultMediaSavedViewQueryDocument = <
	TOrderBy extends QueryEngineNonEmptyArray<unknown> | undefined,
>(input: {
	orderBy?: TOrderBy;
	page?: number | undefined;
	limit?: number | undefined;
	schemas: QueryEngineNonEmptyArray<string>;
}) => {
	const document = buildDefaultSavedViewQueryDocument(input);
	return {
		...document,
		source: {
			...document.source,
			where: queryEngineExists(
				queryEngineEntitySource({
					where: null,
					alias: "library",
					schemas: ["library"],
					via: {
						alias: "inLibrary",
						schema: "in-library",
						entityRef: entityAlias,
						direction: "outgoing" as const,
					},
				}),
			),
		},
	};
};

const entityIdEquals = (entityId: string) =>
	queryEngineComparison(
		"eq",
		queryEngineSystemRef(entityAlias, "id"),
		queryEngineLiteral(entityId),
	);

const withEntityFilter = <TExpr>(entityId: string | undefined, expr: TExpr) =>
	entityId === undefined ? expr : queryEngineAnd(entityIdEquals(entityId), expr);

const eventExistsSource = (entityRef: string, eventSchemaSlug: string) =>
	queryEngineNestedEventSource({
		entityRef,
		where: null,
		schemas: [eventSchemaSlug],
		alias: `${entityRef}${eventSchemaSlug}`,
	});

const showSeasonSource = <TWhere>(alias: string, where: TWhere) =>
	queryEngineEntitySource({
		alias,
		where,
		schemas: ["show-season"],
		via: {
			entityRef: entityAlias,
			alias: `${alias}Relationship`,
			schema: "show-to-show-season",
			direction: "outgoing" as const,
		},
	});

const seasonEpisodeSource = <TWhere>(seasonAlias: string, episodeAlias: string, where: TWhere) =>
	queryEngineEntitySource({
		where,
		alias: episodeAlias,
		schemas: ["show-episode"],
		via: {
			entityRef: seasonAlias,
			direction: "outgoing" as const,
			alias: `${episodeAlias}Relationship`,
			schema: "show-season-to-show-episode",
		},
	});

const podcastEpisodeSource = <TWhere>(episodeAlias: string, where: TWhere) =>
	queryEngineEntitySource({
		where,
		alias: episodeAlias,
		schemas: ["podcast-episode"],
		via: {
			entityRef: entityAlias,
			direction: "outgoing" as const,
			alias: `${episodeAlias}Relationship`,
			schema: "podcast-to-podcast-episode",
		},
	});

const completeEpisodeCount = <TSource>(source: TSource) =>
	queryEngineAggregate(source, { function: "count" as const });

const completedRegularSeasonSource = (suffix: string) => {
	const seasonAlias = `completedSeason${suffix}`;
	return showSeasonSource(
		seasonAlias,
		queryEngineAnd(
			queryEngineComparison(
				"gt",
				queryEnginePropertyRef(seasonAlias, "show-season", "seasonNumber"),
				queryEngineLiteral(0),
			),
			queryEngineComparison(
				"eq",
				completeEpisodeCount(
					seasonEpisodeSource(
						seasonAlias,
						`completedEpisode${suffix}`,
						queryEngineExists(eventExistsSource(`completedEpisode${suffix}`, "complete")),
					),
				),
				completeEpisodeCount(seasonEpisodeSource(seasonAlias, `allEpisode${suffix}`, null)),
			),
		),
	);
};

const regularSeasonSource = (alias: string) =>
	showSeasonSource(
		alias,
		queryEngineComparison(
			"gt",
			queryEnginePropertyRef(alias, "show-season", "seasonNumber"),
			queryEngineLiteral(0),
		),
	);

export const buildShowDetailQueryDocument = (input: {
	entityId: string;
	seasonLimit: number;
	episodeLimit: number;
}) => {
	const seasonAlias = "season";
	const episodeAlias = "episode";
	return buildQueryEngineEntityRowsDocument({
		limit: 1,
		schemas: ["show"],
		alias: entityAlias,
		where: entityIdEquals(input.entityId),
		fields: queryEngineIdentityFields(entityAlias),
		orderBy: [queryEngineOrder("asc", queryEngineSystemRef(entityAlias, "id"))],
		include: [
			queryEngineInclude({
				key: "seasons",
				limit: input.seasonLimit,
				source: showSeasonSource(seasonAlias, null),
				fields: [
					...queryEngineIdentityFields(seasonAlias),
					queryEngineField(
						"seasonNumber",
						queryEnginePropertyRef(seasonAlias, "show-season", "seasonNumber"),
					),
				],
				orderBy: [
					queryEngineOrder(
						"asc",
						queryEnginePropertyRef(seasonAlias, "show-season", "seasonNumber"),
					),
				],
				include: [
					queryEngineInclude({
						key: "episodes",
						limit: input.episodeLimit,
						source: seasonEpisodeSource(seasonAlias, episodeAlias, null),
						fields: [
							...queryEngineIdentityFields(episodeAlias),
							queryEngineField(
								"episodeNumber",
								queryEnginePropertyRef(episodeAlias, "show-episode", "episodeNumber"),
							),
							queryEngineField(
								"hasProgress",
								queryEngineExists(eventExistsSource(episodeAlias, "progress")),
							),
							queryEngineField(
								"isComplete",
								queryEngineExists(eventExistsSource(episodeAlias, "complete")),
							),
						],
						orderBy: [
							queryEngineOrder(
								"asc",
								queryEnginePropertyRef(episodeAlias, "show-episode", "episodeNumber"),
							),
						],
					}),
				],
			}),
		],
	});
};

export const buildInProgressShowsQueryDocument = (input: {
	page?: number | undefined;
	limit?: number | undefined;
	entityId?: string | undefined;
}) =>
	buildQueryEngineEntityRowsDocument({
		page: input.page,
		schemas: ["show"],
		alias: entityAlias,
		limit: input.limit,
		fields: queryEngineIdentityFields(entityAlias),
		where: withEntityFilter(
			input.entityId,
			queryEngineAnd(
				queryEngineNot(queryEngineExists(eventExistsSource(entityAlias, "complete"))),
				queryEngineExists(
					showSeasonSource(
						"watchingSeason",
						queryEngineExists(
							seasonEpisodeSource(
								"watchingSeason",
								"watchingEpisode",
								queryEngineExists(eventExistsSource("watchingEpisode", "progress")),
							),
						),
					),
				),
			),
		),
	});

export const buildCompletedShowsQueryDocument = (input: {
	page?: number | undefined;
	limit?: number | undefined;
	entityId?: string | undefined;
}) =>
	buildQueryEngineEntityRowsDocument({
		page: input.page,
		schemas: ["show"],
		alias: entityAlias,
		limit: input.limit,
		fields: queryEngineIdentityFields(entityAlias),
		where: withEntityFilter(
			input.entityId,
			queryEngineComparison(
				"eq",
				completeEpisodeCount(completedRegularSeasonSource("")),
				completeEpisodeCount(regularSeasonSource("regularSeason")),
			),
		),
	});

export const buildPodcastDetailQueryDocument = (input: {
	entityId: string;
	episodeLimit: number;
}) => {
	const episodeAlias = "episode";
	return buildQueryEngineEntityRowsDocument({
		limit: 1,
		alias: entityAlias,
		schemas: ["podcast"],
		where: entityIdEquals(input.entityId),
		fields: queryEngineIdentityFields(entityAlias),
		orderBy: [queryEngineOrder("asc", queryEngineSystemRef(entityAlias, "id"))],
		include: [
			queryEngineInclude({
				key: "episodes",
				limit: input.episodeLimit,
				source: podcastEpisodeSource(episodeAlias, null),
				fields: [
					...queryEngineIdentityFields(episodeAlias),
					queryEngineField(
						"episodeNumber",
						queryEnginePropertyRef(episodeAlias, "podcast-episode", "episodeNumber"),
					),
					queryEngineField(
						"hasProgress",
						queryEngineExists(eventExistsSource(episodeAlias, "progress")),
					),
					queryEngineField(
						"isComplete",
						queryEngineExists(eventExistsSource(episodeAlias, "complete")),
					),
				],
				orderBy: [
					queryEngineOrder(
						"asc",
						queryEnginePropertyRef(episodeAlias, "podcast-episode", "episodeNumber"),
					),
				],
			}),
		],
	});
};

export const buildInProgressPodcastsQueryDocument = (input: {
	page?: number | undefined;
	limit?: number | undefined;
	entityId?: string | undefined;
}) =>
	buildQueryEngineEntityRowsDocument({
		page: input.page,
		alias: entityAlias,
		limit: input.limit,
		schemas: ["podcast"],
		fields: queryEngineIdentityFields(entityAlias),
		where: withEntityFilter(
			input.entityId,
			queryEngineAnd(
				queryEngineNot(queryEngineExists(eventExistsSource(entityAlias, "complete"))),
				queryEngineExists(
					podcastEpisodeSource(
						"watchingEpisode",
						queryEngineExists(eventExistsSource("watchingEpisode", "progress")),
					),
				),
			),
		),
	});

export const buildCompletedPodcastsQueryDocument = (input: {
	page?: number | undefined;
	limit?: number | undefined;
	entityId?: string | undefined;
}) =>
	buildQueryEngineEntityRowsDocument({
		page: input.page,
		alias: entityAlias,
		limit: input.limit,
		schemas: ["podcast"],
		fields: queryEngineIdentityFields(entityAlias),
		where: withEntityFilter(
			input.entityId,
			queryEngineComparison(
				"eq",
				completeEpisodeCount(
					podcastEpisodeSource(
						"completedEpisode",
						queryEngineExists(eventExistsSource("completedEpisode", "complete")),
					),
				),
				completeEpisodeCount(podcastEpisodeSource("allEpisode", null)),
			),
		),
	});

const mediaSuggestionSource = <TWhere>(schemaSlug: string, where: TWhere) =>
	queryEngineRelationshipSource({
		where,
		alias: "relationship",
		schemas: ["media-suggestion"],
		sourceEntity: { alias: "sourceEntity", schemas: [schemaSlug] },
		targetEntity: { alias: "targetEntity", schemas: [schemaSlug] },
	});

const recommendationOutput = <TSource>(source: TSource, limit: number) =>
	buildQueryEngineAggregateDocument({
		limit,
		source,
		groupBy: queryEngineIdentityFields("targetEntity"),
		orderBy: [queryEngineOrder("desc", queryEngineMeasureRef("recommendingSourceCount"))],
		measures: [
			{
				key: "recommendingSourceCount",
				aggregation: {
					function: "count" as const,
					distinctBy: queryEngineSystemRef("sourceEntity", "id"),
				},
			},
		],
	});

const libraryExists = (entityRef: string, alias: string) =>
	queryEngineExists(
		queryEngineEntitySource({
			alias,
			where: null,
			schemas: ["library"],
			via: {
				entityRef,
				schema: "in-library",
				alias: `${alias}Relationship`,
				direction: "outgoing" as const,
			},
		}),
	);

export const buildPersonalMediaSuggestionsQueryDocument = (input: {
	entitySchemaSlug: string;
	limit?: number | undefined;
}) =>
	recommendationOutput(
		mediaSuggestionSource(
			input.entitySchemaSlug,
			queryEngineAnd(
				libraryExists("sourceEntity", "sourceLibrary"),
				queryEngineNot(libraryExists("targetEntity", "targetLibrary")),
			),
		),
		input.limit ?? 20,
	);

export const buildCollectionMediaSuggestionsQueryDocument = (input: {
	collectionId: string;
	entitySchemaSlug: string;
	limit?: number | undefined;
}) =>
	recommendationOutput(
		mediaSuggestionSource(
			input.entitySchemaSlug,
			queryEngineExists(
				queryEngineEntitySource({
					alias: "collection",
					schemas: ["collection"],
					where: queryEngineComparison(
						"eq",
						queryEngineSystemRef("collection", "id"),
						queryEngineLiteral(input.collectionId),
					),
					via: {
						schema: "member-of",
						entityRef: "sourceEntity",
						alias: "collectionMembership",
						direction: "outgoing" as const,
					},
				}),
			),
		),
		input.limit ?? 20,
	);

export const buildTrendingMediaQueryDocument = (input: {
	fetchedAt: string;
	entitySchemaSlug: string;
	page?: number | undefined;
	limit?: number | undefined;
}) =>
	buildQueryEngineRowsDocument({
		page: input.page,
		limit: input.limit,
		source: queryEngineRelationshipSource({
			alias: "relationship",
			schemas: ["media-trending"],
			where: queryEngineComparison(
				"eq",
				queryEnginePropertyRef("relationship", "media-trending", "fetchedAt"),
				queryEngineLiteral(input.fetchedAt),
			),
			sourceEntity: { alias: "sourceEntity", schemas: [input.entitySchemaSlug] },
			targetEntity: { alias: "targetEntity", schemas: [input.entitySchemaSlug] },
		}),
		fields: [
			...queryEngineIdentityFields("targetEntity"),
			queryEngineField("rank", queryEnginePropertyRef("relationship", "media-trending", "rank")),
			queryEngineField(
				"fetchedAt",
				queryEnginePropertyRef("relationship", "media-trending", "fetchedAt"),
			),
		],
		orderBy: [
			queryEngineOrder("asc", queryEnginePropertyRef("relationship", "media-trending", "rank")),
			queryEngineOrder("desc", queryEngineSystemRef("targetEntity", "updatedAt")),
		],
	});
