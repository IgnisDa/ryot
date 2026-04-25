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
	descending,
	defineRecipe,
	eq,
	exists,
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

import {
	EpisodeLifecycleStateSchema,
	EpisodicLifecycleStateSchema,
	episodeLifecycleStateExpression,
	episodicLifecycleExpressions,
	podcastEpisodicKindConfig,
	showEpisodicKindConfig,
	type EpisodicLifecycleState,
} from "./operations/lifecycle-recipes";

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
					state: selectedField(
						episodeLifecycleStateExpression(episode, "showEpisodeDetailLifecycle"),
						EpisodeLifecycleStateSchema,
					),
					episodeNumber: selectedField(episodeNumber, Schema.Number),
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
			state: selectedField(
				episodeLifecycleStateExpression(episode, "podcastEpisodeDetailLifecycle"),
				EpisodeLifecycleStateSchema,
			),
			episodeNumber: selectedField(episodeNumber, Schema.Number),
		},
	});
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
		const lifecycle = episodicLifecycleExpressions(
			showEpisodicKindConfig,
			entity,
			"showDetailLifecycle",
		);
		return {
			queries: {
				show: selectedOptionalRow(entity, {
					include: { seasons: showSeasonInclude(input) },
					selection: {
						...entityIdentitySelection(entity),
						state: selectedField(lifecycle.state, EpisodicLifecycleStateSchema),
					},
					orderBy: [ascending(column(entity, "id"))],
					where: and(entitySchema(entity, "show"), entityId(entity, input.entityId)),
				}),
			},
			map: ({ show }) => Result.succeed(show ?? null),
		};
	},
);

export const showsByLifecycleStateRecipe = defineRecipe(
	(input: {
		readonly state: EpisodicLifecycleState;
		readonly after?: string | undefined;
		readonly limit?: number | undefined;
		readonly entityId?: string | undefined;
	}) => {
		const entity = table("entity", "entity");
		const lifecycle = episodicLifecycleExpressions(
			showEpisodicKindConfig,
			entity,
			"showListLifecycle",
		);
		return {
			queries: {
				shows: selectedRows(entity, {
					after: input.after,
					limit: input.limit,
					selection: {
						...entityIdentitySelection(entity),
						state: selectedField(lifecycle.state, EpisodicLifecycleStateSchema),
					},
					where: withEntityFilter(
						entity,
						input.entityId,
						and(entitySchema(entity, "show"), eq(lifecycle.state, literal(input.state))),
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
		const lifecycle = episodicLifecycleExpressions(
			podcastEpisodicKindConfig,
			entity,
			"podcastDetailLifecycle",
		);
		return {
			queries: {
				podcast: selectedOptionalRow(entity, {
					selection: {
						...entityIdentitySelection(entity),
						state: selectedField(lifecycle.state, EpisodicLifecycleStateSchema),
					},
					include: { episodes: podcastEpisodeInclude(input.episodeLimit) },
					orderBy: [ascending(column(entity, "id"))],
					where: and(entitySchema(entity, "podcast"), entityId(entity, input.entityId)),
				}),
			},
			map: ({ podcast }) => Result.succeed(podcast ?? null),
		};
	},
);

export const podcastsByLifecycleStateRecipe = defineRecipe(
	(input: {
		readonly state: EpisodicLifecycleState;
		readonly after?: string | undefined;
		readonly limit?: number | undefined;
		readonly entityId?: string | undefined;
	}) => {
		const entity = table("entity", "entity");
		const lifecycle = episodicLifecycleExpressions(
			podcastEpisodicKindConfig,
			entity,
			"podcastListLifecycle",
		);
		return {
			queries: {
				podcasts: selectedRows(entity, {
					after: input.after,
					limit: input.limit,
					selection: {
						...entityIdentitySelection(entity),
						state: selectedField(lifecycle.state, EpisodicLifecycleStateSchema),
					},
					where: withEntityFilter(
						entity,
						input.entityId,
						and(entitySchema(entity, "podcast"), eq(lifecycle.state, literal(input.state))),
					),
				}),
			},
			map: ({ podcasts }) => Result.succeed(podcasts),
		};
	},
);

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
export type ShowsByLifecycleStateResult = Recipe.Success<typeof showsByLifecycleStateRecipe>;
export type PodcastDetailResult = Recipe.Success<typeof podcastDetailRecipe>;
export type PodcastsByLifecycleStateResult = Recipe.Success<typeof podcastsByLifecycleStateRecipe>;
export type PersonalMediaSuggestionsResult = Recipe.Success<typeof personalMediaSuggestionsRecipe>;
export type CollectionMediaSuggestionsResult = Recipe.Success<
	typeof collectionMediaSuggestionsRecipe
>;
export type TrendingMediaResult = Recipe.Success<typeof trendingMediaRecipe>;
export type DefaultMediaSavedViewResult = Recipe.Success<typeof defaultMediaSavedViewRecipe>;
