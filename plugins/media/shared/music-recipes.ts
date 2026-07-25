import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	column,
	defineRecipe,
	divide,
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

import {
	entityId,
	entitySchema,
	propertyBoolean,
	propertyNumber,
	type Table,
} from "./entity-selections";
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
	mergeMediaActivityEvents,
	requestedSchemaQuery,
} from "./media-recipes";

const MUSIC_GROUP_RELATIONSHIP_SLUG = "music-group-to-music";

const SECONDS_PER_MINUTE = 60;

const musicDuration = (music: Table) => ({
	isUnknown: isNull(propertyNumber(music, "duration")),
	minutes: divide(propertyNumber(music, "duration"), literal(SECONDS_PER_MINUTE)),
});

export const musicSummaryRecipe = defineRecipe(
	(input: { readonly entityId: string; readonly collectionLimit: number }) => {
		const entity = table("entity", "entity");
		const provider = table("sandboxProvider", "provider");
		const lifecycle = mediaLifecycleExpressions(entity, "musicSummaryLifecycle");
		return {
			map: ({ music, requested }) =>
				Result.succeed({ music: music ?? null, entitySchemaSlug: requested?.schemaSlug ?? null }),
			queries: {
				requested: requestedSchemaQuery(input.entityId),
				music: selectedOptionalRow(entity, {
					orderBy: [ascending(column(entity, "id"))],
					where: and(entitySchema(entity, "music"), entityId(entity, input.entityId)),
					include: { collections: collectionMembershipInclude(input.collectionLimit) },
					joins: [join("left", provider, eq(column(entity, "providerId"), column(provider, "id")))],
					selection: {
						...mediaSummarySelection(entity, provider),
						state: selectedField(lifecycle.state, MediaLifecycleStateSchema),
						progressPercent: selectedField(lifecycle.progressPercent, Schema.NullOr(Schema.Number)),
						duration: selectedField(
							propertyNumber(entity, "duration"),
							Schema.NullOr(Schema.Number),
						),
						byVariousArtists: selectedField(
							propertyBoolean(entity, "byVariousArtists"),
							Schema.NullOr(Schema.Boolean),
						),
					},
				}),
			},
		};
	},
);

export const musicOverviewRecipe = defineRecipe(
	(input: {
		readonly entityId: string;
		readonly groupLimit: number;
		readonly peopleLimit: number;
		readonly companyLimit: number;
		readonly recommendationLimit: number;
	}) => ({
		queries: {
			...mediaOverviewQueries({ ...input, slug: "music" }),
			group: mediaGroupQuery({
				memberSlug: "music",
				limit: input.groupLimit,
				entityId: input.entityId,
				groupSlug: "music-group",
				relationshipSlug: MUSIC_GROUP_RELATIONSHIP_SLUG,
				aliases: { group: "musicGroup", relationship: "musicGroupRelationship" },
			}),
		},
	}),
);

export const musicActivityRecipe = defineRecipe(
	(input: {
		readonly entityId: string;
		readonly eventLimit: number;
		readonly collectionEventLimit: number;
	}) => {
		const music = table("entity", "activityMusic");
		return {
			map: ({ totals, musicEvents, collectionEvents }) =>
				Result.succeed({
					completionCount: totals?.completionCount ?? 0,
					consumedMinutes: totals?.consumedMinutes ?? null,
					unknownDurationCount: totals?.unknownDurationCount ?? 0,
					truncated: musicEvents.pageInfo.hasMore || collectionEvents.pageInfo.hasMore,
					events: mergeMediaActivityEvents({
						parentEvents: musicEvents.items,
						collectionEvents: collectionEvents.items,
					}),
				}),
			queries: {
				collectionEvents: mediaCollectionEventsQuery({
					entityId: input.entityId,
					limit: input.collectionEventLimit,
				}),
				musicEvents: mediaFlatActivityEventsQuery({
					alias: "musicEvent",
					limit: input.eventLimit,
					entityId: input.entityId,
				}),
				totals: selectedOptionalRow(music, {
					orderBy: [ascending(column(music, "id"))],
					where: and(entitySchema(music, "music"), entityId(music, input.entityId)),
					selection: mediaFlatConsumptionTotals({ entity: music, duration: musicDuration(music) }),
				}),
			},
		};
	},
);

export const musicPresentationRecipe = defineRecipe((entityIds: readonly string[]) => {
	const music = table("entity", "presentationMusic");
	const lifecycle = mediaLifecycleExpressions(music, "musicPresentationLifecycle");
	return {
		map: ({ music: rows }) => Result.succeed(rows.items),
		queries: {
			music: selectedRows(music, {
				limit: 100,
				orderBy: [ascending(column(music, "id"))],
				where: and(
					entitySchema(music, "music"),
					inArray(
						column(music, "id"),
						entityIds.map((requestedId) => literal(requestedId)),
					),
				),
				selection: mediaFlatPresentationSelection(music, lifecycle, {
					duration: selectedField(propertyNumber(music, "duration"), Schema.NullOr(Schema.Number)),
				}),
			}),
		},
	};
});

export type MusicActivityEvent = MusicActivityResult["events"][number];
export type MusicSummaryResult = Recipe.Success<typeof musicSummaryRecipe>;
export type MusicActivityResult = Recipe.Success<typeof musicActivityRecipe>;
export type MusicOverviewResult = Recipe.Success<typeof musicOverviewRecipe>;
export type MusicPresentationData = Recipe.Success<typeof musicPresentationRecipe>[number];
