import type { FieldSelection, OrderBy } from "@ryot/contract/modules/ryotql/language";
import type {
	SavedViewCardMapping,
	SavedViewTableMapping,
} from "@ryot/contract/modules/saved-views/schemas";
import { EntityId, EntitySchemaSlug } from "@ryot/contract/schema/brands";
import type { Recipe } from "@ryot/ryotql";
import {
	and,
	ascending,
	castDate,
	castNumber,
	column,
	count,
	descending,
	defineRecipe,
	eq,
	exists,
	gt,
	join,
	jsonPath,
	literal,
	measureDescending,
	not,
	selectedAggregate,
	selectedField,
	selectedInclude,
	selectedMeasure,
	selectedOptionalRow,
	selectedRows,
	table,
} from "@ryot/ryotql";
import { savedViewRecipe } from "@ryot/ryotql-recipes/saved-views";
import { Result, Schema } from "effect";

type Table = ReturnType<typeof table>;

const entityIdentitySelection = (entity: Table) => ({
	id: selectedField(column(entity, "id"), EntityId),
	name: selectedField(column(entity, "name"), Schema.String),
	schemaSlug: selectedField(column(entity, "entitySchemaSlug"), EntitySchemaSlug),
});

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

	return selectedInclude(season, {
		limit: input.seasonLimit,
		orderBy: [ascending(seasonNumber)],
		selection: {
			...entityIdentitySelection(season),
			seasonNumber: selectedField(seasonNumber, Schema.Number),
		},
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
		include: {
			episodes: selectedInclude(episode, {
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
				selection: {
					...entityIdentitySelection(episode),
					episodeNumber: selectedField(episodeNumber, Schema.Number),
					hasProgress: selectedField(
						eventExists(episode, "episodeProgress", "progress"),
						Schema.Boolean,
					),
					isComplete: selectedField(
						eventExists(episode, "episodeComplete", "complete"),
						Schema.Boolean,
					),
				},
			}),
		},
	});
};

const podcastEpisodeInclude = (episodeLimit: number) => {
	const entity = table("entity", "entity");
	const episode = table("entity", "episode");
	const episodeNumber = propertyNumber(episode, "episodeNumber");
	const episodeRelationship = table("relationship", "episodeRelationship");

	return selectedInclude(episode, {
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
		selection: {
			...entityIdentitySelection(episode),
			episodeNumber: selectedField(episodeNumber, Schema.Number),
			hasProgress: selectedField(
				eventExists(episode, "episodeProgress", "progress"),
				Schema.Boolean,
			),
			isComplete: selectedField(
				eventExists(episode, "episodeComplete", "complete"),
				Schema.Boolean,
			),
		},
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

export const showDetailRecipe = defineRecipe(
	(input: {
		readonly entityId: string;
		readonly seasonLimit: number;
		readonly episodeLimit: number;
	}) => {
		const entity = table("entity", "entity");
		return {
			queries: {
				show: selectedOptionalRow(entity, {
					include: { seasons: showSeasonInclude(input) },
					selection: entityIdentitySelection(entity),
					orderBy: [ascending(column(entity, "id"))],
					where: and(entitySchema(entity, "show"), entityId(entity, input.entityId)),
				}),
			},
			map: ({ show }) => Result.succeed(show ?? null),
		};
	},
);

export const inProgressShowsRecipe = defineRecipe(
	(input: {
		readonly after?: string | undefined;
		readonly limit?: number | undefined;
		readonly entityId?: string | undefined;
	}) => {
		const entity = table("entity", "entity");
		const season = table("entity", "watchingSeason");
		const seasonRelationship = table("relationship", "watchingSeasonRelationship");
		const episode = table("entity", "watchingEpisode");
		const episodeRelationship = table("relationship", "watchingEpisodeRelationship");
		return {
			queries: {
				shows: selectedRows(entity, {
					after: input.after,
					limit: input.limit,
					selection: entityIdentitySelection(entity),
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
			},
			map: ({ shows }) => Result.succeed(shows),
		};
	},
);

export const completedShowsRecipe = defineRecipe(
	(input: {
		readonly after?: string | undefined;
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
		return {
			queries: {
				shows: selectedRows(entity, {
					after: input.after,
					limit: input.limit,
					selection: entityIdentitySelection(entity),
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
											eq(
												column(regular.relationship, "targetEntityId"),
												column(regular.season, "id"),
											),
										),
									],
								}),
							),
						),
					),
				}),
			},
			map: ({ shows }) => Result.succeed(shows),
		};
	},
);

export const podcastDetailRecipe = defineRecipe(
	(input: { readonly entityId: string; readonly episodeLimit: number }) => {
		const entity = table("entity", "entity");
		return {
			queries: {
				podcast: selectedOptionalRow(entity, {
					selection: entityIdentitySelection(entity),
					include: { episodes: podcastEpisodeInclude(input.episodeLimit) },
					orderBy: [ascending(column(entity, "id"))],
					where: and(entitySchema(entity, "podcast"), entityId(entity, input.entityId)),
				}),
			},
			map: ({ podcast }) => Result.succeed(podcast ?? null),
		};
	},
);

const podcastProgressRecipe = defineRecipe(
	(input: {
		readonly completed: boolean;
		readonly after?: string | undefined;
		readonly limit?: number | undefined;
		readonly entityId?: string | undefined;
	}) => {
		const entity = table("entity", "entity");
		const episode = table("entity", input.completed ? "completedEpisode" : "watchingEpisode");
		const relationship = table(
			"relationship",
			input.completed ? "completedEpisodeRelationship" : "watchingEpisodeRelationship",
		);
		return {
			queries: {
				podcasts: selectedRows(entity, {
					after: input.after,
					limit: input.limit,
					selection: entityIdentitySelection(entity),
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
													relationshipTo(
														relationship,
														entity,
														episode,
														"podcast-to-podcast-episode",
													),
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
													relationshipTo(
														relationship,
														entity,
														episode,
														"podcast-to-podcast-episode",
													),
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
			},
			map: ({ podcasts }) => Result.succeed(podcasts),
		};
	},
);

export const inProgressPodcastsRecipe = (input: {
	readonly after?: string | undefined;
	readonly limit?: number | undefined;
	readonly entityId?: string | undefined;
}) => podcastProgressRecipe({ ...input, completed: false });

export const completedPodcastsRecipe = (input: {
	readonly after?: string | undefined;
	readonly limit?: number | undefined;
	readonly entityId?: string | undefined;
}) => podcastProgressRecipe({ ...input, completed: true });

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

const recommendationQuery = (input: {
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
	return selectedAggregate(relationship, {
		limit: input.limit,
		groupBy: entityIdentitySelection(target),
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
		measures: {
			recommendingSourceCount: selectedMeasure(
				{
					function: "countDistinct",
					expr: column(source, "id"),
				},
				Schema.Number,
			),
		},
	});
};

export const personalMediaSuggestionsRecipe = defineRecipe(
	(input: { readonly entitySchemaSlug: string; readonly limit?: number | undefined }) => ({
		queries: {
			recommendations: recommendationQuery({
				limit: input.limit ?? 20,
				entitySchemaSlug: input.entitySchemaSlug,
				where: ({ source, target }) =>
					and(libraryExists(source, "sourceLibrary"), not(libraryExists(target, "targetLibrary"))),
			}),
		},
		map: ({ recommendations }) => Result.succeed(recommendations),
	}),
);

export const collectionMediaSuggestionsRecipe = defineRecipe(
	(input: {
		readonly collectionId: string;
		readonly entitySchemaSlug: string;
		readonly limit?: number | undefined;
	}) => {
		const collection = table("entity", "collection");
		const membership = table("relationship", "collectionMembership");
		return {
			queries: {
				recommendations: recommendationQuery({
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
				}),
			},
			map: ({ recommendations }) => Result.succeed(recommendations),
		};
	},
);

export const trendingMediaRecipe = defineRecipe(
	(input: {
		readonly fetchedAt: string;
		readonly entitySchemaSlug: string;
		readonly after?: string | undefined;
		readonly limit?: number | undefined;
	}) => {
		const relationship = table("relationship", "relationship");
		const source = table("entity", "sourceEntity");
		const target = table("entity", "targetEntity");
		const rank = castNumber(jsonPath(column(relationship, "properties"), "rank"));
		const fetchedAt = castDate(jsonPath(column(relationship, "properties"), "fetchedAt"));
		return {
			queries: {
				trending: selectedRows(relationship, {
					after: input.after,
					limit: input.limit,
					orderBy: [ascending(rank), descending(column(target, "updatedAt"))],
					selection: {
						...entityIdentitySelection(target),
						rank: selectedField(rank, Schema.Number),
						fetchedAt: selectedField(fetchedAt, Schema.String),
					},
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
			},
			map: ({ trending }) => Result.succeed(trending),
		};
	},
);

export const defaultMediaSavedViewRecipe = (input: {
	readonly after?: string | undefined;
	readonly limit?: number | undefined;
	readonly schemas: readonly [string, ...string[]];
	readonly orderBy?: readonly OrderBy[] | undefined;
	readonly fields: readonly FieldSelection[];
	readonly layout:
		| { readonly type: "card"; readonly mapping: SavedViewCardMapping & { entityIdField: string } }
		| {
				readonly type: "table";
				readonly mapping: SavedViewTableMapping & { entityIdField: string };
		  };
}) => {
	const entity = table("entity", "entity");
	const library = table("entity", "library");
	const membership = table("relationship", "inLibrary");

	const source = {
		type: "generated",
		after: input.after,
		limit: input.limit,
		orderBy: input.orderBy,
		entitySchemaSlugs: input.schemas,
		fields: input.fields,
		where: exists(membership, {
			where: and(
				eq(column(membership, "sourceEntityId"), column(entity, "id")),
				eq(column(membership, "relationshipSchemaSlug"), literal("in-library")),
				eq(column(library, "entitySchemaSlug"), literal("library")),
				eq(column(membership, "targetEntityId"), column(library, "id")),
			),
			joins: [
				join("inner", library, eq(column(membership, "targetEntityId"), column(library, "id"))),
			],
		}),
	} as const;
	return savedViewRecipe({ layout: input.layout, source });
};

export type ShowDetailResult = Recipe.Success<typeof showDetailRecipe>;
export type InProgressShowsResult = Recipe.Success<typeof inProgressShowsRecipe>;
export type CompletedShowsResult = Recipe.Success<typeof completedShowsRecipe>;
export type PodcastDetailResult = Recipe.Success<typeof podcastDetailRecipe>;
export type InProgressPodcastsResult = Recipe.Success<typeof inProgressPodcastsRecipe>;
export type CompletedPodcastsResult = Recipe.Success<typeof completedPodcastsRecipe>;
export type PersonalMediaSuggestionsResult = Recipe.Success<typeof personalMediaSuggestionsRecipe>;
export type CollectionMediaSuggestionsResult = Recipe.Success<
	typeof collectionMediaSuggestionsRecipe
>;
export type TrendingMediaResult = Recipe.Success<typeof trendingMediaRecipe>;
export type DefaultMediaSavedViewResult = Recipe.Success<typeof defaultMediaSavedViewRecipe>;
