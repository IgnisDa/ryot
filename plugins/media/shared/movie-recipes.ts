import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	coalesce,
	column,
	count,
	defineRecipe,
	eq,
	eventOrderDescending,
	inArray,
	isNull,
	IsoDateString,
	join,
	literal,
	neq,
	selectedField,
	selectedInclude,
	selectedOptionalRow,
	selectedRows,
	sum,
	table,
	type Recipe,
} from "@ryot-app/plugin-kit/ryotql";
import { EntityId } from "@ryot-app/plugin-kit/schema";

import {
	entityId,
	entityIdentitySelection,
	entitySchema,
	entitySyncSelection,
	propertyJson,
	propertyNumber,
	propertyText,
	type Table,
} from "./entity-selections";
import { MediaLifecycleStateSchema, mediaLifecycleExpressions } from "./lifecycle-expressions";
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

const MOVIE_GROUP_RELATIONSHIP_SLUG = "movie-group-to-movie";

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
						state: selectedField(lifecycle.state, MediaLifecycleStateSchema),
						progressPercent: selectedField(lifecycle.progressPercent, Schema.NullOr(Schema.Number)),
						runtime: selectedField(propertyNumber(entity, "runtime"), Schema.NullOr(Schema.Number)),
					},
				}),
			},
		};
	},
);

const movieGroupMembersInclude = (input: {
	readonly limit: number;
	readonly group: Table;
	readonly entityId: string;
}) => {
	const member = table("entity", "groupMember");
	const membership = table("relationship", "groupMembership");
	return selectedInclude(member, {
		limit: input.limit,
		joins: [
			join("inner", membership, eq(column(membership, "targetEntityId"), column(member, "id"))),
		],
		orderBy: [
			ascending(propertyNumber(membership, "order")),
			ascending(column(member, "name")),
			ascending(column(member, "id")),
		],
		selection: {
			id: selectedField(column(member, "id"), EntityId),
			name: selectedField(column(member, "name"), Schema.String),
			images: selectedField(propertyJson(member, "images"), MediaImageListSchema),
			...entitySyncSelection(member),
		},
		where: and(
			entitySchema(member, "movie"),
			neq(column(member, "id"), literal(input.entityId)),
			eq(column(membership, "sourceEntityId"), column(input.group, "id")),
			eq(column(membership, "relationshipSchemaSlug"), literal(MOVIE_GROUP_RELATIONSHIP_SLUG)),
		),
	});
};

export const movieOverviewRecipe = defineRecipe(
	(input: {
		readonly entityId: string;
		readonly groupLimit: number;
		readonly peopleLimit: number;
		readonly companyLimit: number;
		readonly recommendationLimit: number;
	}) => {
		const group = table("entity", "movieGroup");
		const groupRelationship = table("relationship", "movieGroupRelationship");
		return {
			queries: {
				...mediaOverviewQueries({ ...input, slug: "movie" }),
				group: selectedOptionalRow(group, {
					orderBy: [ascending(column(group, "id"))],
					include: {
						movies: movieGroupMembersInclude({
							group,
							limit: input.groupLimit,
							entityId: input.entityId,
						}),
					},
					joins: [
						join(
							"inner",
							groupRelationship,
							eq(column(groupRelationship, "sourceEntityId"), column(group, "id")),
						),
					],
					selection: {
						id: selectedField(column(group, "id"), EntityId),
						name: selectedField(column(group, "name"), Schema.String),
						...entitySyncSelection(group),
					},
					where: and(
						entitySchema(group, "movie-group"),
						eq(column(groupRelationship, "targetEntityId"), literal(input.entityId)),
						eq(
							column(groupRelationship, "relationshipSchemaSlug"),
							literal(MOVIE_GROUP_RELATIONSHIP_SLUG),
						),
					),
				}),
			},
		};
	},
);

export const movieActivityParentSlugs = [...mediaActivityParentSlugs, "progress"] as const;

const movieWatchTotals = (movie: Table) => {
	const completion = table("event", "movieCompletionEvent");
	const minutes = table("event", "movieMinutesEvent");
	const unknown = table("event", "movieUnknownRuntimeEvent");
	const runtime = propertyNumber(movie, "runtime");
	const isCompletionOf = (event: Table) =>
		and(
			eq(column(event, "entityId"), column(movie, "id")),
			eq(column(event, "eventSchemaSlug"), literal("complete")),
		);
	return {
		watchCount: selectedField(
			count(completion, { where: isCompletionOf(completion) }),
			Schema.Number,
		),
		watchedMinutes: selectedField(
			sum(minutes, coalesce(propertyNumber(minutes, "timeSpent"), runtime), {
				where: isCompletionOf(minutes),
			}),
			Schema.NullOr(Schema.Number),
		),
		watchedUnknownRuntime: selectedField(
			count(unknown, {
				where: and(
					isCompletionOf(unknown),
					isNull(propertyNumber(unknown, "timeSpent")),
					isNull(runtime),
				),
			}),
			Schema.Number,
		),
	};
};

export const movieActivityRecipe = defineRecipe(
	(input: {
		readonly entityId: string;
		readonly eventLimit: number;
		readonly collectionEventLimit: number;
	}) => {
		const movie = table("entity", "activityMovie");
		const movieEvent = table("event", "movieEvent");
		return {
			map: ({ totals, movieEvents, collectionEvents }) => {
				const events = [
					...movieEvents.items.map((row) => ({ ...row, kind: "movie" as const })),
					...collectionEvents.items.map(({ collectionId, collectionName, ...row }) => ({
						...row,
						text: null,
						rating: null,
						timeSpent: null,
						isSpoiler: null,
						consumedOn: null,
						progressPercent: null,
						kind: "collection" as const,
						collection: { id: collectionId, name: collectionName },
					})),
				];
				return Result.succeed({
					watchCount: totals?.watchCount ?? 0,
					watchedMinutes: totals?.watchedMinutes ?? null,
					events: events.sort(compareMediaActivityDescending),
					watchedUnknownRuntime: totals?.watchedUnknownRuntime ?? 0,
					truncated: movieEvents.pageInfo.hasMore || collectionEvents.pageInfo.hasMore,
				});
			},
			queries: {
				collectionEvents: mediaCollectionEventsQuery({
					entityId: input.entityId,
					limit: input.collectionEventLimit,
				}),
				totals: selectedOptionalRow(movie, {
					selection: movieWatchTotals(movie),
					orderBy: [ascending(column(movie, "id"))],
					where: and(entitySchema(movie, "movie"), entityId(movie, input.entityId)),
				}),
				movieEvents: selectedRows(movieEvent, {
					limit: input.eventLimit,
					orderBy: eventOrderDescending(movieEvent),
					where: and(
						eq(column(movieEvent, "entityId"), literal(input.entityId)),
						eventSchemaIsOneOf(movieEvent, movieActivityParentSlugs),
					),
					selection: {
						...mediaActivityEventSelection(movieEvent),
						startedOn: selectedField(
							propertyText(movieEvent, "startedOn"),
							Schema.NullOr(IsoDateString),
						),
						completedOn: selectedField(
							propertyText(movieEvent, "completedOn"),
							Schema.NullOr(IsoDateString),
						),
						progressPercent: selectedField(
							propertyNumber(movieEvent, "progressPercent"),
							Schema.NullOr(Schema.Number),
						),
						eventSchemaSlug: selectedField(
							column(movieEvent, "eventSchemaSlug"),
							Schema.Literals(movieActivityParentSlugs),
						),
					},
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
				selection: {
					...entityIdentitySelection(movie),
					state: selectedField(lifecycle.state, MediaLifecycleStateSchema),
					images: selectedField(propertyJson(movie, "images"), MediaImageListSchema),
					runtime: selectedField(propertyNumber(movie, "runtime"), Schema.NullOr(Schema.Number)),
					progressPercent: selectedField(lifecycle.progressPercent, Schema.NullOr(Schema.Number)),
					publishDate: selectedField(
						propertyText(movie, "publishDate"),
						Schema.NullOr(Schema.String),
					),
					publishYear: selectedField(
						propertyNumber(movie, "publishYear"),
						Schema.NullOr(Schema.Number),
					),
					productionStatus: selectedField(
						propertyText(movie, "productionStatus"),
						Schema.NullOr(Schema.String),
					),
				},
			}),
		},
	};
});

export type MovieActivityEvent = MovieActivityResult["events"][number];
export type MovieSummaryResult = Recipe.Success<typeof movieSummaryRecipe>;
export type MovieActivityResult = Recipe.Success<typeof movieActivityRecipe>;
export type MovieOverviewResult = Recipe.Success<typeof movieOverviewRecipe>;
export type MoviePresentationData = Recipe.Success<typeof moviePresentationRecipe>[number];
