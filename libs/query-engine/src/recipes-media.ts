import {
	buildQueryEngineAggregateDocument,
	buildQueryEngineEntityRowsDocument,
	buildQueryEngineRowsDocument,
	queryEngineEntitySource,
	queryEngineInclude,
	queryEngineNestedEventSource,
	queryEngineRelationshipSource,
} from "./documents";
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
} from "./primitives";

const entityAlias = "entity";

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
		alias: `${entityRef}${eventSchemaSlug}`,
		entityRef,
		schemas: [eventSchemaSlug],
		where: null,
	});

const showSeasonSource = <TWhere>(alias: string, where: TWhere) =>
	queryEngineEntitySource({
		alias,
		where,
		schemas: ["show-season"],
		via: {
			entityRef: entityAlias,
			alias: `${alias}Relationship`,
			direction: "outgoing" as const,
			schema: "show-to-show-season",
		},
	});

const seasonEpisodeSource = <TWhere>(seasonAlias: string, episodeAlias: string, where: TWhere) =>
	queryEngineEntitySource({
		alias: episodeAlias,
		where,
		schemas: ["show-episode"],
		via: {
			entityRef: seasonAlias,
			alias: `${episodeAlias}Relationship`,
			direction: "outgoing" as const,
			schema: "show-season-to-show-episode",
		},
	});

const podcastEpisodeSource = <TWhere>(episodeAlias: string, where: TWhere) =>
	queryEngineEntitySource({
		alias: episodeAlias,
		where,
		schemas: ["podcast-episode"],
		via: {
			entityRef: entityAlias,
			alias: `${episodeAlias}Relationship`,
			direction: "outgoing" as const,
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
		alias: entityAlias,
		limit: 1,
		schemas: ["show"],
		where: entityIdEquals(input.entityId),
		fields: queryEngineIdentityFields(entityAlias),
		orderBy: [queryEngineOrder("asc", queryEngineSystemRef(entityAlias, "id"))],
		include: [
			queryEngineInclude({
				key: "seasons",
				limit: input.seasonLimit,
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
				source: showSeasonSource(seasonAlias, null),
				include: [
					queryEngineInclude({
						key: "episodes",
						limit: input.episodeLimit,
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
						source: seasonEpisodeSource(seasonAlias, episodeAlias, null),
					}),
				],
			}),
		],
	});
};

export const buildInProgressShowsQueryDocument = (input: {
	entityId?: string | undefined;
	page?: number | undefined;
	limit?: number | undefined;
}) =>
	buildQueryEngineEntityRowsDocument({
		alias: entityAlias,
		page: input.page,
		limit: input.limit,
		schemas: ["show"],
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
	entityId?: string | undefined;
	page?: number | undefined;
	limit?: number | undefined;
}) =>
	buildQueryEngineEntityRowsDocument({
		alias: entityAlias,
		page: input.page,
		limit: input.limit,
		schemas: ["show"],
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
		alias: entityAlias,
		limit: 1,
		schemas: ["podcast"],
		where: entityIdEquals(input.entityId),
		fields: queryEngineIdentityFields(entityAlias),
		orderBy: [queryEngineOrder("asc", queryEngineSystemRef(entityAlias, "id"))],
		include: [
			queryEngineInclude({
				key: "episodes",
				limit: input.episodeLimit,
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
				source: podcastEpisodeSource(episodeAlias, null),
			}),
		],
	});
};

export const buildInProgressPodcastsQueryDocument = (input: {
	entityId?: string | undefined;
	page?: number | undefined;
	limit?: number | undefined;
}) =>
	buildQueryEngineEntityRowsDocument({
		alias: entityAlias,
		page: input.page,
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
	entityId?: string | undefined;
	page?: number | undefined;
	limit?: number | undefined;
}) =>
	buildQueryEngineEntityRowsDocument({
		alias: entityAlias,
		page: input.page,
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
		alias: "relationship",
		where,
		schemas: ["media-suggestion"],
		sourceEntity: { alias: "sourceEntity", schemas: [schemaSlug] },
		targetEntity: { alias: "targetEntity", schemas: [schemaSlug] },
	});

const recommendationOutput = <TSource>(source: TSource, limit: number) =>
	buildQueryEngineAggregateDocument({
		source,
		limit,
		measures: [
			{
				key: "recommendingSourceCount",
				aggregation: {
					function: "count" as const,
					distinctBy: queryEngineSystemRef("sourceEntity", "id"),
				},
			},
		],
		groupBy: queryEngineIdentityFields("targetEntity"),
		orderBy: [queryEngineOrder("desc", queryEngineMeasureRef("recommendingSourceCount"))],
	});

const libraryExists = (entityRef: string, alias: string) =>
	queryEngineExists(
		queryEngineEntitySource({
			alias,
			schemas: ["library"],
			where: null,
			via: {
				entityRef,
				alias: `${alias}Relationship`,
				direction: "outgoing" as const,
				schema: "in-library",
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
						entityRef: "sourceEntity",
						alias: "collectionMembership",
						direction: "outgoing" as const,
						schema: "member-of",
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

export const buildMediaMonitoringStatusQueryDocument = (input: {
	entityId: string;
	entitySchemaSlug: string;
}) =>
	buildQueryEngineEntityRowsDocument({
		alias: entityAlias,
		limit: 1,
		schemas: [input.entitySchemaSlug],
		where: entityIdEquals(input.entityId),
		fields: queryEngineIdentityFields(entityAlias),
		orderBy: [queryEngineOrder("asc", queryEngineSystemRef(entityAlias, "id"))],
		include: [
			queryEngineInclude({
				key: "libraries",
				limit: 1,
				fields: queryEngineIdentityFields("library"),
				orderBy: [queryEngineOrder("asc", queryEngineSystemRef("library", "name"))],
				source: queryEngineEntitySource({
					alias: "library",
					schemas: ["library"],
					where: null,
					via: {
						entityRef: entityAlias,
						alias: "mediaMonitoringRelationship",
						direction: "outgoing" as const,
						schema: "media-monitoring",
					},
				}),
			}),
		],
	});
