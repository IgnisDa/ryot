import { queryEngineEntitySource } from "@ryot/query-engine/documents";
import { queryEngineExists, type QueryEngineNonEmptyArray } from "@ryot/query-engine/primitives";
import { buildDefaultSavedViewQueryDocument } from "@ryot/query-engine/recipes/app";
import {
	aggregate,
	and,
	ascending,
	castDate,
	castNumber,
	column,
	count,
	descending,
	document,
	eq,
	exists,
	field,
	gt,
	include,
	join,
	jsonPath,
	literal,
	measure,
	measureDescending,
	not,
	rows,
	table,
} from "@ryot/ryotql";

type Table = ReturnType<typeof table>;

const entityIdentityFields = (entity: Table) => [
	field("id", column(entity, "id")),
	field("name", column(entity, "name")),
	field("schemaSlug", column(entity, "entitySchemaSlug")),
];

const entitySchema = (entity: Table, slug: string) =>
	eq(column(entity, "entitySchemaSlug"), literal(slug));

const entityId = (entity: Table, id: string) => eq(column(entity, "id"), literal(id));

const propertyNumber = (entity: Table, property: string) =>
	castNumber(jsonPath(column(entity, "properties"), property));

const eventExists = (entity: Table, alias: string, schema: string) => {
	const event = table("event", alias);
	return exists(event, {
		where: and(
			eq(column(event, "entityId"), column(entity, "id")),
			eq(column(event, "eventSchemaSlug"), literal(schema)),
		),
	});
};

const relationshipTo = (relationship: Table, parent: Table, child: Table, schema: string) =>
	and(
		eq(column(relationship, "sourceEntityId"), column(parent, "id")),
		eq(column(relationship, "targetEntityId"), column(child, "id")),
		eq(column(relationship, "relationshipSchemaSlug"), literal(schema)),
	);

const showSeasonInclude = (input: {
	readonly seasonLimit: number;
	readonly episodeLimit: number;
}) => {
	const season = table("entity", "season");
	const episode = table("entity", "episode");
	const seasonNumber = propertyNumber(season, "seasonNumber");
	const episodeNumber = propertyNumber(episode, "episodeNumber");
	const seasonRelationship = table("relationship", "seasonRelationship");
	const episodeRelationship = table("relationship", "episodeRelationship");

	return include(season, {
		key: "seasons",
		limit: input.seasonLimit,
		orderBy: [ascending(seasonNumber)],
		fields: [...entityIdentityFields(season), field("seasonNumber", seasonNumber)],
		where: and(
			entitySchema(season, "show-season"),
			relationshipTo(seasonRelationship, table("entity", "entity"), season, "show-to-show-season"),
		),
		joins: [
			join(
				"inner",
				seasonRelationship,
				eq(column(seasonRelationship, "targetEntityId"), column(season, "id")),
			),
		],
		include: [
			include(episode, {
				key: "episodes",
				limit: input.episodeLimit,
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
				fields: [
					...entityIdentityFields(episode),
					field("episodeNumber", episodeNumber),
					field("hasProgress", eventExists(episode, "episodeProgress", "progress")),
					field("isComplete", eventExists(episode, "episodeComplete", "complete")),
				],
			}),
		],
	});
};

const podcastEpisodeInclude = (episodeLimit: number) => {
	const entity = table("entity", "entity");
	const episode = table("entity", "episode");
	const episodeNumber = propertyNumber(episode, "episodeNumber");
	const episodeRelationship = table("relationship", "episodeRelationship");

	return include(episode, {
		key: "episodes",
		limit: episodeLimit,
		orderBy: [ascending(episodeNumber)],
		where: and(
			entitySchema(episode, "podcast-episode"),
			relationshipTo(episodeRelationship, entity, episode, "podcast-to-podcast-episode"),
		),
		joins: [
			join(
				"inner",
				episodeRelationship,
				eq(column(episodeRelationship, "targetEntityId"), column(episode, "id")),
			),
		],
		fields: [
			...entityIdentityFields(episode),
			field("episodeNumber", episodeNumber),
			field("hasProgress", eventExists(episode, "episodeProgress", "progress")),
			field("isComplete", eventExists(episode, "episodeComplete", "complete")),
		],
	});
};

const episodeCount = (input: {
	readonly parent: Table;
	readonly episodeAlias: string;
	readonly eventSchemaSlug?: string;
	readonly episodeSchemaSlug: string;
	readonly relationshipAlias: string;
	readonly relationshipSchemaSlug: string;
}) => {
	const episode = table("entity", input.episodeAlias);
	const relationship = table("relationship", input.relationshipAlias);
	return count(episode, {
		joins: [
			join(
				"inner",
				relationship,
				eq(column(relationship, "targetEntityId"), column(episode, "id")),
			),
		],
		where: and(
			entitySchema(episode, input.episodeSchemaSlug),
			relationshipTo(relationship, input.parent, episode, input.relationshipSchemaSlug),
			...(input.eventSchemaSlug
				? [eventExists(episode, `${input.episodeAlias}Event`, input.eventSchemaSlug)]
				: []),
		),
	});
};

const showRegularSeasonCount = (input: {
	readonly alias: string;
	readonly parent: Table;
	readonly completed: boolean;
	readonly relationshipAlias: string;
}) => {
	const season = table("entity", input.alias);
	const relationship = table("relationship", input.relationshipAlias);
	const regularSeason = gt(propertyNumber(season, "seasonNumber"), literal(0));
	const where = [
		entitySchema(season, "show-season"),
		relationshipTo(relationship, input.parent, season, "show-to-show-season"),
		regularSeason,
	];
	if (input.completed) {
		where.push(
			eq(
				episodeCount({
					parent: season,
					eventSchemaSlug: "complete",
					episodeSchemaSlug: "show-episode",
					episodeAlias: `${input.alias}CompletedEpisode`,
					relationshipSchemaSlug: "show-season-to-show-episode",
					relationshipAlias: `${input.alias}CompletedEpisodeRelationship`,
				}),
				episodeCount({
					parent: season,
					episodeSchemaSlug: "show-episode",
					episodeAlias: `${input.alias}AllEpisode`,
					relationshipSchemaSlug: "show-season-to-show-episode",
					relationshipAlias: `${input.alias}AllEpisodeRelationship`,
				}),
			),
		);
	}
	return { season, relationship, where };
};

const withEntityFilter = (
	entity: Table,
	entityIdInput: string | undefined,
	predicate: ReturnType<typeof and>,
) => (entityIdInput === undefined ? predicate : and(entityId(entity, entityIdInput), predicate));

export const buildShowDetailQueryDocument = (input: {
	readonly entityId: string;
	readonly seasonLimit: number;
	readonly episodeLimit: number;
}) => {
	const entity = table("entity", "entity");
	return document({
		show: rows(entity, {
			limit: 1,
			include: [showSeasonInclude(input)],
			fields: entityIdentityFields(entity),
			orderBy: [ascending(column(entity, "id"))],
			where: and(entitySchema(entity, "show"), entityId(entity, input.entityId)),
		}),
	});
};

export const buildInProgressShowsQueryDocument = (input: {
	readonly page?: number | undefined;
	readonly limit?: number | undefined;
	readonly entityId?: string | undefined;
}) => {
	const entity = table("entity", "entity");
	const season = table("entity", "watchingSeason");
	const seasonRelationship = table("relationship", "watchingSeasonRelationship");
	const episode = table("entity", "watchingEpisode");
	const episodeRelationship = table("relationship", "watchingEpisodeRelationship");
	return document({
		shows: rows(entity, {
			page: input.page,
			limit: input.limit,
			fields: entityIdentityFields(entity),
			where: withEntityFilter(
				entity,
				input.entityId,
				and(
					entitySchema(entity, "show"),
					not(eventExists(entity, "entityComplete", "complete")),
					exists(season, {
						joins: [
							join(
								"inner",
								seasonRelationship,
								eq(column(seasonRelationship, "targetEntityId"), column(season, "id")),
							),
						],
						where: and(
							entitySchema(season, "show-season"),
							relationshipTo(seasonRelationship, entity, season, "show-to-show-season"),
							exists(episode, {
								joins: [
									join(
										"inner",
										episodeRelationship,
										eq(column(episodeRelationship, "targetEntityId"), column(episode, "id")),
									),
								],
								where: and(
									entitySchema(episode, "show-episode"),
									relationshipTo(
										episodeRelationship,
										season,
										episode,
										"show-season-to-show-episode",
									),
									eventExists(episode, "watchingEpisodeProgress", "progress"),
								),
							}),
						),
					}),
				),
			),
		}),
	});
};

export const buildCompletedShowsQueryDocument = (input: {
	readonly page?: number | undefined;
	readonly limit?: number | undefined;
	readonly entityId?: string | undefined;
}) => {
	const entity = table("entity", "entity");
	const completed = showRegularSeasonCount({
		parent: entity,
		completed: true,
		alias: "completedSeason",
		relationshipAlias: "completedSeasonRelationship",
	});
	const regular = showRegularSeasonCount({
		parent: entity,
		completed: false,
		alias: "regularSeason",
		relationshipAlias: "regularSeasonRelationship",
	});
	return document({
		shows: rows(entity, {
			page: input.page,
			limit: input.limit,
			fields: entityIdentityFields(entity),
			where: withEntityFilter(
				entity,
				input.entityId,
				and(
					entitySchema(entity, "show"),
					eq(
						count(completed.season, {
							where: and(...completed.where),
							joins: [
								join(
									"inner",
									completed.relationship,
									eq(
										column(completed.relationship, "targetEntityId"),
										column(completed.season, "id"),
									),
								),
							],
						}),
						count(regular.season, {
							where: and(...regular.where),
							joins: [
								join(
									"inner",
									regular.relationship,
									eq(column(regular.relationship, "targetEntityId"), column(regular.season, "id")),
								),
							],
						}),
					),
				),
			),
		}),
	});
};

export const buildPodcastDetailQueryDocument = (input: {
	readonly entityId: string;
	readonly episodeLimit: number;
}) => {
	const entity = table("entity", "entity");
	return document({
		podcast: rows(entity, {
			limit: 1,
			fields: entityIdentityFields(entity),
			include: [podcastEpisodeInclude(input.episodeLimit)],
			orderBy: [ascending(column(entity, "id"))],
			where: and(entitySchema(entity, "podcast"), entityId(entity, input.entityId)),
		}),
	});
};

const buildPodcastProgressDocument = (input: {
	readonly completed: boolean;
	readonly page?: number | undefined;
	readonly limit?: number | undefined;
	readonly entityId?: string | undefined;
}) => {
	const entity = table("entity", "entity");
	const episode = table("entity", input.completed ? "completedEpisode" : "watchingEpisode");
	const relationship = table(
		"relationship",
		input.completed ? "completedEpisodeRelationship" : "watchingEpisodeRelationship",
	);
	return document({
		podcasts: rows(entity, {
			page: input.page,
			limit: input.limit,
			fields: entityIdentityFields(entity),
			where: withEntityFilter(
				entity,
				input.entityId,
				and(
					entitySchema(entity, "podcast"),
					...(input.completed
						? [
								eq(
									count(episode, {
										joins: [
											join(
												"inner",
												relationship,
												eq(column(relationship, "targetEntityId"), column(episode, "id")),
											),
										],
										where: and(
											entitySchema(episode, "podcast-episode"),
											relationshipTo(relationship, entity, episode, "podcast-to-podcast-episode"),
											eventExists(episode, "completedEpisodeEvent", "complete"),
										),
									}),
									count(episode, {
										joins: [
											join(
												"inner",
												relationship,
												eq(column(relationship, "targetEntityId"), column(episode, "id")),
											),
										],
										where: and(
											entitySchema(episode, "podcast-episode"),
											relationshipTo(relationship, entity, episode, "podcast-to-podcast-episode"),
										),
									}),
								),
							]
						: [
								not(eventExists(entity, "podcastComplete", "complete")),
								exists(episode, {
									joins: [
										join(
											"inner",
											relationship,
											eq(column(relationship, "targetEntityId"), column(episode, "id")),
										),
									],
									where: and(
										entitySchema(episode, "podcast-episode"),
										relationshipTo(relationship, entity, episode, "podcast-to-podcast-episode"),
										eventExists(episode, "watchingEpisodeProgress", "progress"),
									),
								}),
							]),
				),
			),
		}),
	});
};

export const buildInProgressPodcastsQueryDocument = (input: {
	readonly page?: number | undefined;
	readonly limit?: number | undefined;
	readonly entityId?: string | undefined;
}) => buildPodcastProgressDocument({ ...input, completed: false });

export const buildCompletedPodcastsQueryDocument = (input: {
	readonly page?: number | undefined;
	readonly limit?: number | undefined;
	readonly entityId?: string | undefined;
}) => buildPodcastProgressDocument({ ...input, completed: true });

const libraryExists = (entity: Table, alias: string) => {
	const library = table("entity", alias);
	const relationship = table("relationship", `${alias}Relationship`);
	return exists(library, {
		joins: [
			join(
				"inner",
				relationship,
				eq(column(relationship, "targetEntityId"), column(library, "id")),
			),
		],
		where: and(
			entitySchema(library, "library"),
			eq(column(relationship, "sourceEntityId"), column(entity, "id")),
			eq(column(relationship, "relationshipSchemaSlug"), literal("in-library")),
		),
	});
};

const recommendationOutput = (input: {
	readonly limit: number;
	readonly entitySchemaSlug: string;
	readonly where: (tables: {
		readonly source: Table;
		readonly target: Table;
	}) => ReturnType<typeof and>;
}) => {
	const relationship = table("relationship", "relationship");
	const source = table("entity", "sourceEntity");
	const target = table("entity", "targetEntity");
	return document({
		recommendations: aggregate(relationship, {
			limit: input.limit,
			groupBy: entityIdentityFields(target),
			orderBy: [measureDescending("recommendingSourceCount")],
			joins: [
				join("inner", source, eq(column(relationship, "sourceEntityId"), column(source, "id"))),
				join("inner", target, eq(column(relationship, "targetEntityId"), column(target, "id"))),
			],
			where: and(
				eq(column(relationship, "relationshipSchemaSlug"), literal("media-suggestion")),
				entitySchema(source, input.entitySchemaSlug),
				entitySchema(target, input.entitySchemaSlug),
				input.where({ source, target }),
			),
			measures: [
				measure("recommendingSourceCount", {
					function: "countDistinct",
					expr: column(source, "id"),
				}),
			],
		}),
	});
};

export const buildPersonalMediaSuggestionsQueryDocument = (input: {
	readonly entitySchemaSlug: string;
	readonly limit?: number | undefined;
}) =>
	recommendationOutput({
		limit: input.limit ?? 20,
		entitySchemaSlug: input.entitySchemaSlug,
		where: ({ source, target }) =>
			and(libraryExists(source, "sourceLibrary"), not(libraryExists(target, "targetLibrary"))),
	});

export const buildCollectionMediaSuggestionsQueryDocument = (input: {
	readonly collectionId: string;
	readonly entitySchemaSlug: string;
	readonly limit?: number | undefined;
}) => {
	const collection = table("entity", "collection");
	const membership = table("relationship", "collectionMembership");
	return recommendationOutput({
		limit: input.limit ?? 20,
		entitySchemaSlug: input.entitySchemaSlug,
		where: ({ source }) =>
			and(
				exists(collection, {
					joins: [
						join(
							"inner",
							membership,
							eq(column(membership, "targetEntityId"), column(collection, "id")),
						),
					],
					where: and(
						entitySchema(collection, "collection"),
						eq(column(collection, "id"), literal(input.collectionId)),
						eq(column(membership, "sourceEntityId"), column(source, "id")),
						eq(column(membership, "relationshipSchemaSlug"), literal("member-of")),
					),
				}),
			),
	});
};

export const buildTrendingMediaQueryDocument = (input: {
	readonly fetchedAt: string;
	readonly entitySchemaSlug: string;
	readonly page?: number | undefined;
	readonly limit?: number | undefined;
}) => {
	const relationship = table("relationship", "relationship");
	const source = table("entity", "sourceEntity");
	const target = table("entity", "targetEntity");
	const rank = castNumber(jsonPath(column(relationship, "properties"), "rank"));
	const fetchedAt = castDate(jsonPath(column(relationship, "properties"), "fetchedAt"));
	return document({
		trending: rows(relationship, {
			page: input.page,
			limit: input.limit,
			orderBy: [ascending(rank), descending(column(target, "updatedAt"))],
			fields: [...entityIdentityFields(target), field("rank", rank), field("fetchedAt", fetchedAt)],
			joins: [
				join("inner", source, eq(column(relationship, "sourceEntityId"), column(source, "id"))),
				join("inner", target, eq(column(relationship, "targetEntityId"), column(target, "id"))),
			],
			where: and(
				eq(column(relationship, "relationshipSchemaSlug"), literal("media-trending")),
				entitySchema(source, input.entitySchemaSlug),
				entitySchema(target, input.entitySchemaSlug),
				eq(fetchedAt, castDate(literal(input.fetchedAt))),
			),
		}),
	});
};

export const buildDefaultMediaSavedViewQueryDocument = <
	TOrderBy extends QueryEngineNonEmptyArray<unknown> | undefined,
>(input: {
	readonly orderBy?: TOrderBy;
	readonly page?: number | undefined;
	readonly limit?: number | undefined;
	readonly schemas: QueryEngineNonEmptyArray<string>;
}) => {
	const legacyDocument = buildDefaultSavedViewQueryDocument(input);
	return {
		...legacyDocument,
		source: {
			...legacyDocument.source,
			where: queryEngineExists(
				queryEngineEntitySource({
					where: null,
					alias: "library",
					schemas: ["library"],
					via: {
						alias: "inLibrary",
						entityRef: "entity",
						schema: "in-library",
						direction: "outgoing" as const,
					},
				}),
			),
		},
	};
};
