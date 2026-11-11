import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	castDate,
	column,
	contains,
	count,
	countAll,
	defineRecipe,
	descending,
	entitySchemaPredicate,
	eq,
	eventOrderDescending,
	exists,
	first,
	inArray,
	isNull,
	IsoDateString,
	join,
	jsonPath,
	literal,
	maximum,
	not,
	or,
	parameters,
	type Recipe,
	relationshipSchemaPredicate,
	schemaOwnerPredicate,
	selectedAggregate,
	selectedField,
	selectedOptionalRow,
	selectedRows,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import { EntityId, type PluginIdentityReference } from "@ryot-app/plugin-kit/schema";

import {
	entityIdentitySelection,
	libraryLinkExists,
	mediaLibrarySelection,
	propertyBoolean,
	propertyJson,
	propertyNumber,
	type Table,
} from "./entity-selections";
import { MediaImageListSchema } from "./media-image";
import { builtinMediaEntitySchemaSlugs } from "./media-schema-slugs";

const discoveredMediaSelection = (entity: Table) => ({
	...entityIdentitySelection(entity),
	images: selectedField(propertyJson(entity, "images"), MediaImageListSchema),
});

/** Unpopulated stubs carry no `isNsfw`, so null passes. */
const isNotNsfw = (entity: Table) =>
	or(
		isNull(propertyBoolean(entity, "isNsfw")),
		eq(propertyBoolean(entity, "isNsfw"), literal(false)),
	);

const isSuggestible = (target: Table, alias: string) =>
	and(not(libraryLinkExists(target, alias, "in-media-library")), isNotNsfw(target));

/**
 * The entity of the latest `complete` event on an in-library builtin media entity that still has a
 * suggestible target, so a completion whose suggestions are all in the library falls back to an
 * earlier one.
 */
const suggestionSourceId = (reference: PluginIdentityReference) => {
	const event = table("event", "suggestionSourceEvent");
	const source = table("entity", "suggestionSource");
	const suggestion = table("relationship", "suggestionSourceEdge");
	const target = table("entity", "suggestionSourceTarget");
	return first(event, {
		select: column(source, "id"),
		orderBy: eventOrderDescending(event),
		joins: [join("inner", source, eq(column(event, "entityId"), column(source, "id")))],
		where: and(
			schemaOwnerPredicate(source, "entitySchemaPluginId", reference),
			schemaOwnerPredicate(event, "eventSchemaPluginId", reference),
			eq(column(event, "eventSchemaSlug"), literal("complete")),
			inArray(
				column(source, "entitySchemaSlug"),
				builtinMediaEntitySchemaSlugs.map((slug) => literal(slug)),
			),
			libraryLinkExists(source, "suggestionSourceLibrary", "in-media-library"),
			exists(suggestion, {
				joins: [
					join("inner", target, eq(column(suggestion, "targetEntityId"), column(target, "id"))),
				],
				where: and(
					schemaOwnerPredicate(target, "entitySchemaPluginId", reference),
					eq(column(suggestion, "sourceEntityId"), column(source, "id")),
					relationshipSchemaPredicate(suggestion, "media-suggestion", reference),
					isSuggestible(target, "suggestionSourceTargetLibrary"),
				),
			}),
		),
	});
};

/**
 * Suggestions from the latest completion that has any. A document's queries cannot read one
 * another, so the items query repeats the source `first()` rather than taking its id.
 */
export const latestCompletionSuggestionsRecipe = (input: {
	readonly reference: PluginIdentityReference;
}) => {
	const source = table("entity", "source");
	const suggestion = table("relationship", "suggestion");
	const target = table("entity", "target");
	return defineRecipe({
		map: ({ items, source: sourceRow }) =>
			Result.succeed({ items: items.items, source: sourceRow ?? null }),
		queries: {
			source: selectedOptionalRow(source, {
				orderBy: [ascending(column(source, "id"))],
				selection: discoveredMediaSelection(source),
				where: eq(column(source, "id"), suggestionSourceId(input.reference)),
			}),
			items: selectedRows(suggestion, {
				limit: 100,
				selection: discoveredMediaSelection(target),
				orderBy: [ascending(column(suggestion, "createdAt")), ascending(column(target, "id"))],
				joins: [
					join("inner", target, eq(column(suggestion, "targetEntityId"), column(target, "id"))),
				],
				where: and(
					relationshipSchemaPredicate(suggestion, "media-suggestion", input.reference),
					schemaOwnerPredicate(target, "entitySchemaPluginId", input.reference),
					eq(column(suggestion, "sourceEntityId"), suggestionSourceId(input.reference)),
					isSuggestible(target, "targetLibrary"),
				),
			}),
		},
	});
};
export type LatestCompletionSuggestionsResult = Recipe.Success<
	ReturnType<typeof latestCompletionSuggestionsRecipe>
>;

const trendingFetchedAt = (relationship: Table) =>
	castDate(jsonPath(column(relationship, "properties"), "fetchedAt"));

/**
 * Every schema's latest trending batch - a correlated `maximum()` keyed on the row's schema, so a
 * schema refreshed less recently still shows - ordered by rank and then schema, which interleaves
 * the schemas rank by rank. Titles already in the library stay.
 */
export const trendingLatestMediaRecipe = (input: {
	readonly reference: PluginIdentityReference;
}) => {
	const inputParameters = parameters({
		fields: {
			entitySchemaSlugs: {
				type: "array",
				label: "entitySchemaSlugs",
				validation: { required: true },
				description: "entitySchemaSlugs for this selection",
				items: { label: "ID", type: "string", description: "Selected ID" },
			},
		},
	});
	const relationship = table("relationship", "trending");
	const target = table("entity", "trendingEntity");
	const latest = table("relationship", "latestTrending");
	const latestTarget = table("entity", "latestTrendingEntity");
	const rank = propertyNumber(relationship, "rank");
	const fetchedAt = trendingFetchedAt(relationship);
	const latestBatch = maximum(latest, trendingFetchedAt(latest), {
		joins: [
			join("inner", latestTarget, eq(column(latest, "targetEntityId"), column(latestTarget, "id"))),
		],
		where: and(
			relationshipSchemaPredicate(latest, "media-trending", input.reference),
			schemaOwnerPredicate(latestTarget, "entitySchemaPluginId", input.reference),
			eq(column(latestTarget, "entitySchemaSlug"), column(target, "entitySchemaSlug")),
		),
	});
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ trending }) => Result.succeed(trending),
		queries: {
			trending: selectedRows(relationship, {
				limit: 100,
				joins: [
					join("inner", target, eq(column(relationship, "targetEntityId"), column(target, "id"))),
				],
				orderBy: [
					ascending(rank),
					ascending(column(target, "entitySchemaSlug")),
					ascending(column(target, "id")),
				],
				selection: {
					...discoveredMediaSelection(target),
					...mediaLibrarySelection(target),
					rank: selectedField(rank, Schema.Finite),
					fetchedAt: selectedField(fetchedAt, IsoDateString),
				},
				where: and(
					relationshipSchemaPredicate(relationship, "media-trending", input.reference),
					schemaOwnerPredicate(target, "entitySchemaPluginId", input.reference),
					inArray(column(target, "entitySchemaSlug"), inputParameters.list("entitySchemaSlugs")),
					eq(fetchedAt, latestBatch),
					isNotNsfw(target),
				),
			}),
		},
	});
};
export type TrendingLatestMediaResult = Recipe.Success<
	ReturnType<typeof trendingLatestMediaRecipe>
>;
const collectionMembership = (membership: Table, collectionId: Parameters<typeof eq>[1]) =>
	and(
		eq(column(membership, "targetEntityId"), collectionId),
		relationshipSchemaPredicate(membership, "member-of", { kind: "kernel" }),
	);

const collectionSuggestionEdges = (
	target: Table,
	input: {
		readonly reference: PluginIdentityReference;
		readonly collectionId: Parameters<typeof eq>[1];
	},
	alias: string,
) => {
	const suggestion = table("relationship", alias);
	const membership = table("relationship", `${alias}Membership`);
	return [
		suggestion,
		{
			joins: [
				join(
					"inner",
					membership,
					eq(column(membership, "sourceEntityId"), column(suggestion, "sourceEntityId")),
				),
			],
			where: and(
				collectionMembership(membership, input.collectionId),
				eq(column(suggestion, "targetEntityId"), column(target, "id")),
				relationshipSchemaPredicate(suggestion, "media-suggestion", input.reference),
			),
		},
	] as const;
};

/**
 * The collection's name and how many of its members have provider suggestions, so an empty page can
 * tell a collection with nothing to suggest from one whose suggestions it already holds.
 */
export const collectionRecommendationSourcesRecipe = (structural: {
	readonly reference: PluginIdentityReference;
}) => {
	const args = parameters({
		fields: {
			collectionId: {
				type: "string",
				label: "Collection",
				validation: { required: true },
				description: "Collection to read",
			},
		},
	});
	const input = { reference: structural.reference, collectionId: args.value("collectionId") };
	const collection = table("entity", "recommendedCollection");
	const membership = table("relationship", "recommendationSourceMembership");
	const suggestion = table("relationship", "recommendationSourceEdge");
	return defineRecipe({
		parameters: args.schema,
		map: ({ sources, collection: row }) =>
			Result.succeed(row === undefined ? null : { ...row, sourceCount: sources.count }),
		queries: {
			sources: selectedAggregate(membership, {
				measures: { count: countAll },
				where: and(
					collectionMembership(membership, input.collectionId),
					exists(suggestion, {
						where: and(
							eq(column(suggestion, "sourceEntityId"), column(membership, "sourceEntityId")),
							relationshipSchemaPredicate(suggestion, "media-suggestion", input.reference),
						),
					}),
				),
			}),
			collection: selectedOptionalRow(collection, {
				orderBy: [ascending(column(collection, "id"))],
				where: and(
					eq(column(collection, "id"), input.collectionId),
					entitySchemaPredicate(collection, "collection", { kind: "kernel" }),
				),
				selection: {
					id: selectedField(column(collection, "id"), EntityId),
					name: selectedField(column(collection, "name"), Schema.String),
				},
			}),
		},
	});
};
export type CollectionRecommendationSourcesResult = Recipe.Success<
	ReturnType<typeof collectionRecommendationSourcesRecipe>
>;

/** Library titles stay because they can still be added to the collection. */
export const COLLECTION_RECOMMENDATION_PAGE_SIZE = 30;

export const collectionRecommendationsRecipe = (structural: {
	readonly reference: PluginIdentityReference;
}) => {
	const args = parameters({
		fields: {
			searchText: {
				type: "string",
				label: "Search",
				defaultValue: "",
				description: "Find suggestions by name",
			},
			collectionId: {
				type: "string",
				label: "Collection",
				validation: { required: true },
				description: "Collection to read",
			},
		},
	});
	const input = {
		reference: structural.reference,
		searchText: args.value("searchText"),
		collectionId: args.value("collectionId"),
	};
	const target = table("entity", "recommendation");
	const member = table("relationship", "recommendationMember");
	const suggestedBy = count(...collectionSuggestionEdges(target, input, "recommendationCount"));
	const search = input.searchText;
	return defineRecipe({
		parameters: args.schema,
		map: ({ recommendations }) => Result.succeed(recommendations),
		queries: {
			recommendations: selectedRows(target, {
				limit: COLLECTION_RECOMMENDATION_PAGE_SIZE,
				orderBy: [
					descending(suggestedBy),
					ascending(column(target, "name")),
					ascending(column(target, "id")),
				],
				selection: {
					...discoveredMediaSelection(target),
					...mediaLibrarySelection(target),
					suggestedBy: selectedField(suggestedBy, Schema.Finite),
				},
				where: and(
					schemaOwnerPredicate(target, "entitySchemaPluginId", input.reference),
					exists(...collectionSuggestionEdges(target, input, "recommendationEdge")),
					not(
						exists(member, {
							where: and(
								collectionMembership(member, input.collectionId),
								eq(column(member, "sourceEntityId"), column(target, "id")),
							),
						}),
					),
					isNotNsfw(target),
					contains(column(target, "name"), search),
				),
			}),
		},
	});
};
export type CollectionRecommendation = CollectionRecommendationsResult["items"][number];

export type CollectionRecommendationsResult = Recipe.Success<
	ReturnType<typeof collectionRecommendationsRecipe>
>;
