import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	castDate,
	column,
	defineRecipe,
	eq,
	eventOrderDescending,
	exists,
	first,
	inArray,
	IsoDateString,
	isNull,
	join,
	jsonPath,
	literal,
	maximum,
	not,
	or,
	selectedField,
	selectedOptionalRow,
	selectedRows,
	table,
	type Recipe,
} from "@ryot-app/plugin-kit/ryotql";

import {
	entityIdentitySelection,
	libraryLinkExists,
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
const suggestionSourceId = () => {
	const event = table("event", "suggestionSourceEvent");
	const source = table("entity", "suggestionSource");
	const suggestion = table("relationship", "suggestionSourceEdge");
	const target = table("entity", "suggestionSourceTarget");
	return first(event, {
		select: column(source, "id"),
		orderBy: eventOrderDescending(event),
		joins: [join("inner", source, eq(column(event, "entityId"), column(source, "id")))],
		where: and(
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
					eq(column(suggestion, "sourceEntityId"), column(source, "id")),
					eq(column(suggestion, "relationshipSchemaSlug"), literal("media-suggestion")),
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
export const latestCompletionSuggestionsRecipe = defineRecipe(
	(input: { readonly limit: number }) => {
		const source = table("entity", "source");
		const suggestion = table("relationship", "suggestion");
		const target = table("entity", "target");
		return {
			map: ({ items, source: sourceRow }) =>
				Result.succeed({ items: items.items, source: sourceRow ?? null }),
			queries: {
				source: selectedOptionalRow(source, {
					orderBy: [ascending(column(source, "id"))],
					selection: discoveredMediaSelection(source),
					where: eq(column(source, "id"), suggestionSourceId()),
				}),
				items: selectedRows(suggestion, {
					limit: input.limit,
					selection: discoveredMediaSelection(target),
					orderBy: [ascending(column(suggestion, "createdAt")), ascending(column(target, "id"))],
					joins: [
						join("inner", target, eq(column(suggestion, "targetEntityId"), column(target, "id"))),
					],
					where: and(
						eq(column(suggestion, "relationshipSchemaSlug"), literal("media-suggestion")),
						eq(column(suggestion, "sourceEntityId"), suggestionSourceId()),
						isSuggestible(target, "targetLibrary"),
					),
				}),
			},
		};
	},
);

export type LatestCompletionSuggestionsResult = Recipe.Success<
	typeof latestCompletionSuggestionsRecipe
>;

const trendingFetchedAt = (relationship: Table) =>
	castDate(jsonPath(column(relationship, "properties"), "fetchedAt"));

/**
 * Every schema's latest trending batch - a correlated `maximum()` keyed on the row's schema, so a
 * schema refreshed less recently still shows - ordered by rank and then schema, which interleaves
 * the schemas rank by rank. Titles already in the library stay.
 */
export const trendingLatestMediaRecipe = defineRecipe(
	(input: {
		readonly limit: number;
		readonly after?: string | undefined;
		readonly entitySchemaSlugs: readonly [string, ...string[]];
	}) => {
		const relationship = table("relationship", "trending");
		const target = table("entity", "trendingEntity");
		const latest = table("relationship", "latestTrending");
		const latestTarget = table("entity", "latestTrendingEntity");
		const rank = propertyNumber(relationship, "rank");
		const fetchedAt = trendingFetchedAt(relationship);
		const latestBatch = maximum(latest, trendingFetchedAt(latest), {
			joins: [
				join(
					"inner",
					latestTarget,
					eq(column(latest, "targetEntityId"), column(latestTarget, "id")),
				),
			],
			where: and(
				eq(column(latest, "relationshipSchemaSlug"), literal("media-trending")),
				eq(column(latestTarget, "entitySchemaSlug"), column(target, "entitySchemaSlug")),
			),
		});
		return {
			map: ({ trending }) => Result.succeed(trending),
			queries: {
				trending: selectedRows(relationship, {
					limit: input.limit,
					...(input.after === undefined ? {} : { after: input.after }),
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
						rank: selectedField(rank, Schema.Number),
						fetchedAt: selectedField(fetchedAt, IsoDateString),
					},
					where: and(
						eq(column(relationship, "relationshipSchemaSlug"), literal("media-trending")),
						inArray(
							column(target, "entitySchemaSlug"),
							input.entitySchemaSlugs.map((slug) => literal(slug)),
						),
						eq(fetchedAt, latestBatch),
						isNotNsfw(target),
					),
				}),
			},
		};
	},
);

export type TrendingLatestMediaResult = Recipe.Success<typeof trendingLatestMediaRecipe>;
