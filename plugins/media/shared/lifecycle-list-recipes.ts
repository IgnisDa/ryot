import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	column,
	defineRecipe,
	descending,
	eq,
	inArray,
	IsoDateString,
	latestEventField,
	literal,
	selectedField,
	selectedRows,
	table,
	type Recipe,
} from "@ryot-app/plugin-kit/ryotql";

import {
	entityId,
	entityIdentitySelection,
	entitySchema,
	libraryLinkExists,
	propertyJson,
	propertyNumber,
	type Table,
} from "./entity-selections";
import { episodicEpisodeSelection } from "./episodic-recipes";
import {
	EpisodicLifecycleStateSchema,
	episodicLifecycleExpressions,
	episodicNextUpInclude,
	MediaLifecycleStateSchema,
	mediaLifecycleExpressions,
	type EpisodicKindConfig,
	type EpisodicLifecycleState,
	type MediaLifecycleState,
} from "./lifecycle-expressions";
import { MediaImageListSchema } from "./media-image";
import { builtinMediaEntitySchemaSlugs } from "./media-schema-slugs";

type NonEmpty<A> = readonly [A, ...A[]];

const flatMediaSchemaSlugs = builtinMediaEntitySchemaSlugs.filter(
	(slug) => slug !== "show" && slug !== "podcast",
);

const listedMediaSelection = (entity: Table) => ({
	...entityIdentitySelection(entity),
	images: selectedField(propertyJson(entity, "images"), MediaImageListSchema),
});

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
		readonly states: NonEmpty<EpisodicLifecycleState>;
	}) => {
		const entity = table("entity", "entity");
		const lifecycle = episodicLifecycleExpressions(input.config, entity, "listLifecycle");
		const latestActivityAt = lifecycle.latestSignal.occurredAt;
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
					orderBy: [descending(latestActivityAt), descending(column(entity, "id"))],
					selection: {
						...listedMediaSelection(entity),
						state: selectedField(lifecycle.state, EpisodicLifecycleStateSchema),
						latestActivityAt: selectedField(latestActivityAt, Schema.NullOr(IsoDateString)),
					},
					where: and(
						entitySchema(entity, input.config.parentSchemaSlug),
						libraryLinkExists(entity, "listLibrary", "in-media-library"),
						isOneOf(lifecycle.state, input.states),
						...(input.entityId === undefined ? [] : [entityId(entity, input.entityId)]),
					),
					include: {
						nextUp: episodicNextUpInclude(input.config, entity, (episode) => ({
							...episodicEpisodeSelection(episode, entity, "listNextUpState"),
							seasonNumber: selectedField(
								input.config.kind === "show"
									? propertyNumber(episode, "seasonNumber")
									: literal(null),
								Schema.NullOr(Schema.Number),
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
 * first, with the position the latest progress event recorded.
 */
export const flatByLifecycleStateRecipe = defineRecipe(
	(input: { readonly limit: number; readonly states: NonEmpty<MediaLifecycleState> }) => {
		const entity = table("entity", "entity");
		const lifecycle = mediaLifecycleExpressions(entity, "listLifecycle");
		const latestActivityAt = lifecycle.latestSignal.occurredAt;
		const progress = table("event", "listLatestProgress");
		const latestProgressPosition = (property: string) =>
			selectedField(
				latestEventField(progress, {
					select: propertyNumber(progress, property),
					where: and(
						eq(column(progress, "entityId"), column(entity, "id")),
						eq(column(progress, "eventSchemaSlug"), literal("progress")),
					),
				}),
				Schema.NullOr(Schema.Number),
			);
		return {
			map: ({ items }) => Result.succeed(items),
			queries: {
				items: selectedRows(entity, {
					limit: input.limit,
					orderBy: [descending(latestActivityAt), descending(column(entity, "id"))],
					where: and(
						isOneOf(column(entity, "entitySchemaSlug"), flatMediaSchemaSlugs),
						libraryLinkExists(entity, "listLibrary", "in-media-library"),
						isOneOf(lifecycle.state, input.states),
					),
					selection: {
						...listedMediaSelection(entity),
						mangaVolume: latestProgressPosition("mangaVolume"),
						animeEpisode: latestProgressPosition("animeEpisode"),
						mangaChapter: latestProgressPosition("mangaChapter"),
						state: selectedField(lifecycle.state, MediaLifecycleStateSchema),
						latestActivityAt: selectedField(latestActivityAt, Schema.NullOr(IsoDateString)),
						progressPercent: selectedField(lifecycle.progressPercent, Schema.NullOr(Schema.Number)),
					},
				}),
			},
		};
	},
);

export type FlatByLifecycleStateResult = Recipe.Success<typeof flatByLifecycleStateRecipe>;
