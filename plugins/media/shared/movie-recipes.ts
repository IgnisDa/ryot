import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	column,
	defineRecipe,
	eq,
	inArray,
	isNull,
	join,
	literal,
	selectedField,
	selectedOptionalRow,
	selectedRows,
	table,
	type Recipe,
} from "@ryot-app/plugin-kit/ryotql";

import { entityId, entitySchema, propertyNumber, type Table } from "./entity-selections";
import { MediaLifecycleStateSchema, mediaLifecycleExpressions } from "./lifecycle-expressions";
import {
	collectionMembershipInclude,
	mediaCollectionEventsQuery,
	mediaFlatActivityEventsQuery,
	mediaFlatConsumptionTotals,
	mediaFlatPresentationSelection,
	mediaGroupQuery,
	mediaOverviewQueries,
	mediaSummarySelection,
	mediaWatchProviderSelection,
	mergeMediaActivityEvents,
	requestedSchemaQuery,
} from "./media-recipes";

const MOVIE_GROUP_RELATIONSHIP_SLUG = "movie-group-to-movie";

const movieDuration = (movie: Table) => ({
	minutes: propertyNumber(movie, "runtime"),
	isUnknown: isNull(propertyNumber(movie, "runtime")),
});

export const movieSummaryRecipe = defineRecipe(
	(input: { readonly entityId: string; readonly collectionLimit: number }) => {
		const entity = table("entity", "entity");
		const provider = table("sandboxProvider", "provider");
		const lifecycle = mediaLifecycleExpressions(entity, "movieSummaryLifecycle");
		return {
			map: ({ movie, requested }) =>
				Result.succeed({ movie: movie ?? null, entitySchemaSlug: requested?.schemaSlug ?? null }),
			queries: {
				requested: requestedSchemaQuery(input.entityId),
				movie: selectedOptionalRow(entity, {
					orderBy: [ascending(column(entity, "id"))],
					where: and(entitySchema(entity, "movie"), entityId(entity, input.entityId)),
					include: { collections: collectionMembershipInclude(input.collectionLimit) },
					joins: [join("left", provider, eq(column(entity, "providerId"), column(provider, "id")))],
					selection: {
						...mediaSummarySelection(entity, provider),
						...mediaWatchProviderSelection(entity),
						state: selectedField(lifecycle.state, MediaLifecycleStateSchema),
						progressPercent: selectedField(lifecycle.progressPercent, Schema.NullOr(Schema.Number)),
						runtime: selectedField(propertyNumber(entity, "runtime"), Schema.NullOr(Schema.Number)),
					},
				}),
			},
		};
	},
);

export const movieOverviewRecipe = defineRecipe(
	(input: {
		readonly entityId: string;
		readonly groupLimit: number;
		readonly peopleLimit: number;
		readonly companyLimit: number;
		readonly recommendationLimit: number;
	}) => ({
		queries: {
			...mediaOverviewQueries({ ...input, slug: "movie" }),
			group: mediaGroupQuery({
				memberSlug: "movie",
				limit: input.groupLimit,
				entityId: input.entityId,
				groupSlug: "movie-group",
				relationshipSlug: MOVIE_GROUP_RELATIONSHIP_SLUG,
				aliases: { group: "movieGroup", relationship: "movieGroupRelationship" },
			}),
		},
	}),
);

export const movieActivityRecipe = defineRecipe(
	(input: {
		readonly entityId: string;
		readonly eventLimit: number;
		readonly collectionEventLimit: number;
	}) => {
		const movie = table("entity", "activityMovie");
		return {
			map: ({ totals, movieEvents, collectionEvents }) =>
				Result.succeed({
					watchCount: totals?.completionCount ?? 0,
					watchedMinutes: totals?.consumedMinutes ?? null,
					watchedUnknownRuntime: totals?.unknownDurationCount ?? 0,
					truncated: movieEvents.pageInfo.hasMore || collectionEvents.pageInfo.hasMore,
					events: mergeMediaActivityEvents({
						parentEvents: movieEvents.items,
						collectionEvents: collectionEvents.items,
					}),
				}),
			queries: {
				collectionEvents: mediaCollectionEventsQuery({
					entityId: input.entityId,
					limit: input.collectionEventLimit,
				}),
				movieEvents: mediaFlatActivityEventsQuery({
					alias: "movieEvent",
					limit: input.eventLimit,
					entityId: input.entityId,
				}),
				totals: selectedOptionalRow(movie, {
					orderBy: [ascending(column(movie, "id"))],
					where: and(entitySchema(movie, "movie"), entityId(movie, input.entityId)),
					selection: mediaFlatConsumptionTotals({ entity: movie, duration: movieDuration(movie) }),
				}),
			},
		};
	},
);

export const moviePresentationRecipe = defineRecipe((entityIds: readonly string[]) => {
	const movie = table("entity", "presentationMovie");
	const lifecycle = mediaLifecycleExpressions(movie, "moviePresentationLifecycle");
	return {
		map: ({ movies }) => Result.succeed(movies.items),
		queries: {
			movies: selectedRows(movie, {
				limit: 100,
				orderBy: [ascending(column(movie, "id"))],
				where: and(
					entitySchema(movie, "movie"),
					inArray(
						column(movie, "id"),
						entityIds.map((requestedId) => literal(requestedId)),
					),
				),
				selection: mediaFlatPresentationSelection(movie, lifecycle, {
					runtime: selectedField(propertyNumber(movie, "runtime"), Schema.NullOr(Schema.Number)),
				}),
			}),
		},
	};
});

export type MovieActivityEvent = MovieActivityResult["events"][number];
export type MovieSummaryResult = Recipe.Success<typeof movieSummaryRecipe>;
export type MovieActivityResult = Recipe.Success<typeof movieActivityRecipe>;
export type MovieOverviewResult = Recipe.Success<typeof movieOverviewRecipe>;
export type MoviePresentationData = Recipe.Success<typeof moviePresentationRecipe>[number];
