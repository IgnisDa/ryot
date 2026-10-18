import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	column,
	defineRecipe,
	descending,
	entitySchemaPredicate,
	eq,
	inArray,
	isNotNull,
	IsoDateString,
	latestEventField,
	literal,
	type Recipe,
	schemaOwnerPredicate,
	selectedAggregate,
	selectedField,
	selectedMeasure,
	selectedRows,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import type { PluginIdentityReference } from "@ryot-app/plugin-kit/schema";

import {
	entityId,
	entityIdentitySelection,
	libraryLinkExists,
	propertyJson,
	propertyNumber,
	type Table,
} from "./entity-selections";
import { episodicEpisodeSelection } from "./episodic-recipes";
import { libraryMembershipJoin, librarySummary } from "./library-summary";
import {
	type EpisodicKindConfig,
	type EpisodicLifecycleState,
	EpisodicLifecycleStateSchema,
	episodicNextUpInclude,
	eventSlugIsOneOf,
	mediaLifecycleExpressions,
	type MediaLifecycleState,
	MediaLifecycleStateSchema,
} from "./lifecycle-expressions";
import { MediaImageListSchema } from "./media-image";
import { builtinMediaEntitySchemaSlugs, flatMediaSchemaSlugs } from "./media-schema-slugs";

type NonEmpty<A> = readonly [A, ...A[]];

const listedMediaSelection = (entity: Table) => ({
	...entityIdentitySelection(entity),
	images: selectedField(propertyJson(entity, "images"), MediaImageListSchema),
});

/** The position property of the latest progress or list-state event that carries one. */
export const latestPosition = (entity: Table, property: string) => {
	const positionEvent = table("event", "listLatestPosition");
	return latestEventField(positionEvent, {
		select: propertyNumber(positionEvent, property),
		where: and(
			eq(column(positionEvent, "entityId"), column(entity, "id")),
			eventSlugIsOneOf(positionEvent, ["progress", "list-state"]),
			isNotNull(propertyNumber(positionEvent, property)),
		),
	});
};

const isOneOf = (expression: Parameters<typeof inArray>[0], values: readonly string[]) =>
	inArray(
		expression,
		values.map((value) => literal(value)),
	);

/**
 * In-library shows or podcasts in one of `states`, most recent lifecycle activity first, each with
 * the episode `episodicNextUpInclude` resolves. `latestActivityAt` is the latest aggregate
 * lifecycle signal, so for `backlog` it is the backlog event itself.
 */
export const episodicByLifecycleStateRecipe = defineRecipe(
	(input: {
		readonly limit: number;
		readonly config: EpisodicKindConfig;
		readonly after?: string | undefined;
		readonly entityId?: string | undefined;
		readonly reference: PluginIdentityReference;
		readonly states: NonEmpty<EpisodicLifecycleState>;
	}) => {
		const entity = table("entity", "entity");
		const library = libraryMembershipJoin(entity, "listLibrary");
		const summary = librarySummary(library.membership);
		return {
			map: ({ items }) =>
				Result.succeed({
					pageInfo: items.pageInfo,
					items: items.items.map(({ nextUp, ...item }) => ({
						...item,
						nextUp: nextUp.items[0] ?? null,
					})),
				}),
			queries: {
				items: selectedRows(entity, {
					limit: input.limit,
					...(input.after === undefined ? {} : { after: input.after }),
					joins: [library.join],
					orderBy: [descending(summary.lastActivityAt), descending(column(entity, "id"))],
					selection: {
						...listedMediaSelection(entity),
						state: selectedField(summary.lifecycleState, EpisodicLifecycleStateSchema),
						latestActivityAt: selectedField(summary.lastActivityAt, Schema.NullOr(IsoDateString)),
					},
					where: and(
						entitySchemaPredicate(entity, input.config.parentSchemaSlug, input.reference),
						isOneOf(summary.lifecycleState, input.states),
						...(input.entityId === undefined ? [] : [entityId(entity, input.entityId)]),
					),
					include: {
						nextUp: episodicNextUpInclude(input.config, entity, (episode) => ({
							...episodicEpisodeSelection(episode, entity, "listNextUpState"),
							seasonNumber: selectedField(
								input.config.kind === "show"
									? propertyNumber(episode, "seasonNumber")
									: literal(null),
								Schema.NullOr(Schema.Finite),
							),
						})),
					},
				}),
			},
		};
	},
);

export type EpisodicByLifecycleStateResult = Recipe.Success<typeof episodicByLifecycleStateRecipe>;

/**
 * In-library flat media of every builtin schema in one of `states`, most recent lifecycle activity
 * first, with the position from the latest progress event or list-state snapshot.
 */
export const flatByLifecycleStateRecipe = defineRecipe(
	(input: {
		readonly limit: number;
		readonly reference: PluginIdentityReference;
		readonly states: NonEmpty<MediaLifecycleState>;
	}) => {
		const entity = table("entity", "entity");
		const library = libraryMembershipJoin(entity, "listLibrary");
		const summary = librarySummary(library.membership);
		const lifecycle = mediaLifecycleExpressions(entity, "listLifecycle");
		const selectedPosition = (property: string) =>
			selectedField(latestPosition(entity, property), Schema.NullOr(Schema.Finite));
		return {
			map: ({ items }) => Result.succeed(items),
			queries: {
				items: selectedRows(entity, {
					limit: input.limit,
					joins: [library.join],
					orderBy: [descending(summary.lastActivityAt), descending(column(entity, "id"))],
					where: and(
						schemaOwnerPredicate(entity, "entitySchemaPluginId", input.reference),
						isOneOf(column(entity, "entitySchemaSlug"), flatMediaSchemaSlugs),
						isOneOf(summary.lifecycleState, input.states),
					),
					selection: {
						...listedMediaSelection(entity),
						mangaVolume: selectedPosition("mangaVolume"),
						animeEpisode: selectedPosition("animeEpisode"),
						mangaChapter: selectedPosition("mangaChapter"),
						state: selectedField(summary.lifecycleState, MediaLifecycleStateSchema),
						latestActivityAt: selectedField(summary.lastActivityAt, Schema.NullOr(IsoDateString)),
						progressPercent: selectedField(lifecycle.progressPercent, Schema.NullOr(Schema.Finite)),
					},
				}),
			},
		};
	},
);

export type FlatByLifecycleStateResult = Recipe.Success<typeof flatByLifecycleStateRecipe>;

/** How many builtin media entities are in the library; the `media-library` entity is not one. */
export const libraryMediaCountRecipe = defineRecipe((reference: PluginIdentityReference) => {
	const entity = table("entity", "entity");
	return {
		map: ({ library }) => Result.succeed(library.count),
		queries: {
			library: selectedAggregate(entity, {
				measures: { count: selectedMeasure({ function: "count" }, Schema.Finite) },
				where: and(
					schemaOwnerPredicate(entity, "entitySchemaPluginId", reference),
					isOneOf(column(entity, "entitySchemaSlug"), builtinMediaEntitySchemaSlugs),
					libraryLinkExists(entity, "countLibrary", "in-media-library"),
				),
			}),
		},
	};
});
