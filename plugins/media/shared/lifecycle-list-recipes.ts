import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	column,
	countAll,
	defineRecipe,
	descending,
	entitySchemaPredicate,
	eq,
	inArray,
	isNotNull,
	IsoDateString,
	latestEventField,
	literal,
	parameters,
	type Recipe,
	schemaOwnerPredicate,
	selectedAggregate,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import type { AppSchema, PluginIdentityReference } from "@ryot-app/plugin-kit/schema";

import { MediaPosition } from "./consumption";
import {
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
	EpisodicLifecycleStateSchema,
	episodicNextUpInclude,
	eventSlugIsOneOf,
	mediaLifecycleExpressions,
	MediaLifecycleStateSchema,
	podcastEpisodicKindConfig,
	type ScalarExpression,
	showEpisodicKindConfig,
} from "./lifecycle-expressions";
import { MediaImageListSchema } from "./media-image";
import { builtinMediaEntitySchemaSlugs, flatMediaSchemaSlugs } from "./media-schema-slugs";

const listedMediaSelection = (entity: Table) => ({
	...entityIdentitySelection(entity),
	images: selectedField(propertyJson(entity, "images"), MediaImageListSchema),
});

const latestPositionField = (entity: Table, select: (event: Table) => ScalarExpression) => {
	const positionEvent = table("event", "listLatestPosition");
	return latestEventField(positionEvent, {
		select: select(positionEvent),
		where: and(
			eq(column(positionEvent, "entityId"), column(entity, "id")),
			eventSlugIsOneOf(positionEvent, ["progress", "list-state"]),
			isNotNull(propertyNumber(positionEvent, "position", "position")),
		),
	});
};

/** The position number of the latest progress or list-state event that carries one. */
export const latestPosition = (entity: Table) =>
	latestPositionField(entity, (event) => propertyNumber(event, "position", "position"));

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
export const episodicByLifecycleStateRecipe = (input: {
	readonly config: EpisodicKindConfig;
	readonly reference: PluginIdentityReference;
}) => {
	const inputParameters = parameters({
		fields: {
			entityId: { type: "string", label: "entityId", description: "entityId for this selection" },
			mediaTypes: {
				type: "enum-array",
				label: "Media types",
				description: "Restrict the library to these media types",
				choices: {
					kind: "static",
					values: builtinMediaEntitySchemaSlugs.map((value) => ({ value })),
				},
			},
			states: {
				label: "states",
				type: "enum-array",
				validation: { required: true },
				description: "states for this selection",
				choices: {
					kind: "static",
					values: [
						{ value: "untracked", label: "Untracked" },
						{ value: "backlog", label: "backlog" },
						{ value: "in_progress", label: "in_progress" },
						{ value: "on_hold", label: "on_hold" },
						{ value: "dropped", label: "dropped" },
						{ value: "complete", label: "complete" },
						{ value: "caught_up", label: "caught_up" },
					],
				},
			},
		},
	});
	const entity = table("entity", "entity");
	const library = libraryMembershipJoin(entity, "listLibrary");
	const summary = librarySummary(library.membership);
	return defineRecipe({
		parameters: inputParameters.schema,
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
				limit: 100,
				joins: [library.join],
				orderBy: [descending(summary.lastActivityAt), descending(column(entity, "id"))],
				selection: {
					...listedMediaSelection(entity),
					state: selectedField(summary.lifecycleState, EpisodicLifecycleStateSchema),
					latestActivityAt: selectedField(summary.lastActivityAt, Schema.NullOr(IsoDateString)),
				},
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
				where: and(
					entitySchemaPredicate(entity, input.config.parentSchemaSlug, input.reference),
					inArray(summary.lifecycleState, inputParameters.list("states")),
					inputParameters.whenSet(
						"mediaTypes",
						inArray(column(entity, "entitySchemaSlug"), inputParameters.list("mediaTypes")),
					),
					inputParameters.whenSet(
						"entityId",
						eq(column(entity, "id"), inputParameters.value("entityId")),
					),
				),
			}),
		},
	});
};
export type EpisodicByLifecycleStateResult = Recipe.Success<
	ReturnType<typeof episodicByLifecycleStateRecipe>
>;
/**
 * In-library flat media of every builtin schema in one of `states`, most recent lifecycle activity
 * first, with the position from the latest progress event or list-state snapshot.
 */
export const flatByLifecycleStateRecipe = (input: {
	readonly reference: PluginIdentityReference;
}) => {
	const inputParameters = parameters({
		fields: {
			mediaTypes: {
				type: "enum-array",
				label: "Media types",
				description: "Restrict the library to these media types",
				choices: {
					kind: "static",
					values: builtinMediaEntitySchemaSlugs.map((value) => ({ value })),
				},
			},
			states: {
				label: "states",
				type: "enum-array",
				validation: { required: true },
				description: "states for this selection",
				choices: {
					kind: "static",
					values: [
						{ value: "untracked", label: "Untracked" },
						{ value: "backlog", label: "backlog" },
						{ value: "in_progress", label: "in_progress" },
						{ value: "on_hold", label: "on_hold" },
						{ value: "dropped", label: "dropped" },
						{ value: "complete", label: "complete" },
						{ value: "caught_up", label: "caught_up" },
					],
				},
			},
		},
	});
	const entity = table("entity", "entity");
	const library = libraryMembershipJoin(entity, "listLibrary");
	const summary = librarySummary(library.membership);
	const lifecycle = mediaLifecycleExpressions(entity, "listLifecycle");
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ items }) => Result.succeed(items),
		queries: {
			items: selectedRows(entity, {
				limit: 100,
				joins: [library.join],
				orderBy: [descending(summary.lastActivityAt), descending(column(entity, "id"))],
				where: and(
					schemaOwnerPredicate(entity, "entitySchemaPluginId", input.reference),
					isOneOf(column(entity, "entitySchemaSlug"), flatMediaSchemaSlugs),
					inArray(summary.lifecycleState, inputParameters.list("states")),
					inputParameters.whenSet(
						"mediaTypes",
						inArray(column(entity, "entitySchemaSlug"), inputParameters.list("mediaTypes")),
					),
				),
				selection: {
					...listedMediaSelection(entity),
					state: selectedField(summary.lifecycleState, MediaLifecycleStateSchema),
					latestActivityAt: selectedField(summary.lastActivityAt, Schema.NullOr(IsoDateString)),
					progressPercent: selectedField(lifecycle.progressPercent, Schema.NullOr(Schema.Finite)),
					position: selectedField(
						latestPositionField(entity, (event) => propertyJson(event, "position")),
						Schema.NullOr(MediaPosition),
					),
				},
			}),
		},
	});
};
export type FlatByLifecycleStateResult = Recipe.Success<
	ReturnType<typeof flatByLifecycleStateRecipe>
>;
/** How many builtin media entities are in the library; the `media-library` entity is not one. */
export const libraryMediaCountRecipe = (reference: PluginIdentityReference) => {
	const entity = table("entity", "entity");
	return defineRecipe({
		map: ({ library }) => Result.succeed(library.count),
		queries: {
			library: selectedAggregate(entity, {
				measures: { count: countAll },
				where: and(
					schemaOwnerPredicate(entity, "entitySchemaPluginId", reference),
					isOneOf(column(entity, "entitySchemaSlug"), builtinMediaEntitySchemaSlugs),
					libraryLinkExists(entity, "countLibrary", "in-media-library"),
				),
			}),
		},
	});
};
export const libraryByLifecycleStateRecipe = (reference: PluginIdentityReference) => {
	const flat = flatByLifecycleStateRecipe({ reference });
	const show = episodicByLifecycleStateRecipe({ reference, config: showEpisodicKindConfig });
	const podcast = episodicByLifecycleStateRecipe({ reference, config: podcastEpisodicKindConfig });
	return defineRecipe({
		parameters: show.parameters,
		queries: {
			flat: lifecycleItems(flat),
			show: lifecycleItems(show),
			podcast: lifecycleItems(podcast),
		},
	});
};
const lifecycleItems = <Success, const Parameters extends AppSchema>(
	recipe: Recipe<Success, Parameters>,
) => {
	const query = recipe.document.queries.items;
	if (query === undefined) {
		throw new Error("Lifecycle recipe is missing its items query");
	}
	return { document: query, decodeResult: (items: unknown) => recipe.decode({ data: { items } }) };
};
