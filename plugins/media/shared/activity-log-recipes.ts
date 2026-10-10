import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	column,
	conditional,
	defineRecipe,
	entitySchemaPredicate,
	eq,
	first,
	isNotNull,
	join,
	literal,
	lt,
	measureDescending,
	neq,
	or,
	type Recipe,
	relationshipSchemaPredicate,
	schemaOwnerPredicate,
	selectedAggregate,
	selectedField,
	selectedInclude,
	selectedMeasure,
	selectedOptionalRow,
	selectedRows,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import { EntityId, type PluginIdentityReference } from "@ryot-app/plugin-kit/schema";

import {
	entityId,
	entityIdentitySelection,
	propertyNumber,
	propertyText,
	type Table,
} from "./entity-selections";
import {
	entitySchemaIs,
	episodeDisplayStateExpression,
	EpisodeLifecycleStateSchema,
	episodicEpisodeQuery,
	type EpisodicKindConfig,
	episodicLifecycleExpressions,
	EpisodicLifecycleStateSchema,
	episodicNextUpInclude,
	eventSlugIsOneOf,
	mediaLifecycleExpressions,
	podcastEpisodicKindConfig,
	type Predicate,
	sameSchemaOwner,
	showEpisodicKindConfig,
} from "./lifecycle-expressions";
import { mediaNumberSelection, mediaWatchProviderSelection } from "./media-recipes";
import { builtinMediaEntitySchemaSlugs } from "./media-schema-slugs";

const NextUpSeasonNumber = Schema.NullOr(Schema.Finite);

const SEASON_LIMIT = 100;
const ENTITY_CONSUMED_ON_LIMIT = 10;
const RECENT_CONSUMED_ON_LIMIT = 5;

const kindConfigs = {
	show: showEpisodicKindConfig,
	podcast: podcastEpisodicKindConfig,
} as const satisfies Record<string, EpisodicKindConfig>;

type EpisodicKind = keyof typeof kindConfigs;

const nextUpSelection = (config: EpisodicKindConfig) => (episode: Table) => ({
	id: selectedField(column(episode, "id"), EntityId),
	name: selectedField(column(episode, "name"), Schema.String),
	episodeNumber: selectedField(propertyNumber(episode, "episodeNumber"), Schema.Finite),
	seasonNumber: selectedField(
		config.kind === "show" ? propertyNumber(episode, "seasonNumber") : literal(null),
		NextUpSeasonNumber,
	),
});

const consumedOnSuggestions = (input: {
	readonly alias: string;
	readonly limit: number;
	readonly entityId: string;
	readonly onlyThisEntity: boolean;
	readonly reference: PluginIdentityReference;
}) => {
	const event = table("event", `${input.alias}Event`);
	const eventEntity = table("entity", `${input.alias}Entity`);
	const target = table("entity", `${input.alias}Target`);
	const eventEntitySlug = conditional(
		entitySchemaIs(target, "show"),
		literal("show-episode"),
		conditional(
			entitySchemaIs(target, "podcast"),
			literal("podcast-episode"),
			column(target, "entitySchemaSlug"),
		),
	);
	return selectedAggregate(event, {
		limit: input.limit,
		orderBy: [measureDescending("lastUsedAt")],
		groupBy: { consumedOn: selectedField(propertyText(event, "consumedOn"), Schema.String) },
		measures: {
			lastUsedAt: selectedMeasure(
				{ function: "maximum", expr: column(event, "occurredAt") },
				Schema.NullOr(Schema.String),
			),
		},
		joins: [
			join("inner", eventEntity, eq(column(event, "entityId"), column(eventEntity, "id"))),
			join("inner", target, entityId(target, input.entityId)),
		],
		where: and(
			schemaOwnerPredicate(event, "eventSchemaPluginId", input.reference),
			schemaOwnerPredicate(target, "entitySchemaPluginId", input.reference),
			sameSchemaOwner(eventEntity, "entitySchemaPluginId", target),
			eq(column(eventEntity, "entitySchemaSlug"), eventEntitySlug),
			eventSlugIsOneOf(event, ["complete", "progress"]),
			isNotNull(propertyText(event, "consumedOn")),
			...(input.onlyThisEntity
				? [
						or(
							eq(column(event, "entityId"), column(target, "id")),
							eq(column(event, "sessionEntityId"), column(target, "id")),
						),
					]
				: []),
		),
	});
};

/**
 * What the Log activity sheet needs about one media entity: its lifecycle state, progress, totals
 * for unit hints, recent `consumedOn` values (this entity first, then the schema's most recent),
 * streaming providers, and for shows and podcasts the next-up episode plus a show's seasons.
 */
export const mediaActivityLogContextRecipe = defineRecipe(
	(input: { readonly reference: PluginIdentityReference; readonly entityId: string }) => {
		const entity = table("entity", "logEntity");
		const season = table("entity", "logSeason");
		const seasonRelationship = table("relationship", "logSeasonRelationship");
		const lifecycle = mediaLifecycleExpressions(entity, "logMedia");
		const showState = episodicLifecycleExpressions(showEpisodicKindConfig, entity, "logShow").state;
		const podcastState = episodicLifecycleExpressions(
			podcastEpisodicKindConfig,
			entity,
			"logPodcast",
		).state;
		return {
			map: ({ target, entityConsumedOn, recentConsumedOn }) => {
				if (target === undefined) {
					return Result.succeed(null);
				}
				const { seasons, showNextUp, podcastNextUp, ...rest } = target;
				const consumedOn = [...entityConsumedOn.items, ...recentConsumedOn.items].map(
					(row) => row.consumedOn,
				);
				return Result.succeed({
					...rest,
					seasons: seasons.items,
					nextUp: showNextUp.items[0] ?? podcastNextUp.items[0] ?? null,
					consumedOn: consumedOn.filter((value, index) => consumedOn.indexOf(value) === index),
				});
			},
			queries: {
				entityConsumedOn: consumedOnSuggestions({
					...input,
					onlyThisEntity: true,
					alias: "logEntityConsumed",
					limit: ENTITY_CONSUMED_ON_LIMIT,
				}),
				recentConsumedOn: consumedOnSuggestions({
					...input,
					onlyThisEntity: false,
					alias: "logRecentConsumed",
					limit: RECENT_CONSUMED_ON_LIMIT,
				}),
				target: selectedOptionalRow(entity, {
					orderBy: [ascending(column(entity, "id"))],
					where: and(
						entityId(entity, input.entityId),
						or(
							...builtinMediaEntitySchemaSlugs.map((slug) =>
								entitySchemaPredicate(entity, slug, input.reference),
							),
						),
					),
					selection: {
						...entityIdentitySelection(entity),
						...mediaNumberSelection("pages", "runtime", "episodes", "chapters")(entity),
						...mediaWatchProviderSelection(entity),
						position: selectedField(lifecycle.position, Schema.NullOr(Schema.Finite)),
						progressPercent: selectedField(lifecycle.progressPercent, Schema.NullOr(Schema.Finite)),
						state: selectedField(
							conditional(
								entitySchemaIs(entity, "show"),
								showState,
								conditional(entitySchemaIs(entity, "podcast"), podcastState, lifecycle.state),
							),
							EpisodicLifecycleStateSchema,
						),
					},
					include: {
						showNextUp: episodicNextUpInclude(
							showEpisodicKindConfig,
							entity,
							nextUpSelection(showEpisodicKindConfig),
							"logShowNextUp",
						),
						podcastNextUp: episodicNextUpInclude(
							podcastEpisodicKindConfig,
							entity,
							nextUpSelection(podcastEpisodicKindConfig),
							"logPodcastNextUp",
						),
						seasons: selectedInclude(season, {
							limit: SEASON_LIMIT,
							orderBy: [ascending(propertyNumber(season, "seasonNumber"))],
							joins: [
								join(
									"inner",
									seasonRelationship,
									eq(column(seasonRelationship, "targetEntityId"), column(season, "id")),
								),
							],
							selection: {
								id: selectedField(column(season, "id"), EntityId),
								name: selectedField(column(season, "name"), Schema.String),
								seasonNumber: selectedField(propertyNumber(season, "seasonNumber"), Schema.Finite),
							},
							where: and(
								entitySchemaIs(season, "show-season"),
								sameSchemaOwner(season, "entitySchemaPluginId", entity),
								eq(column(seasonRelationship, "sourceEntityId"), column(entity, "id")),
								relationshipSchemaPredicate(
									seasonRelationship,
									showEpisodicKindConfig.parentSeasonRelationshipSlug,
									input.reference,
								),
							),
						}),
					},
				}),
			},
		};
	},
);

export type MediaActivityLogContext = NonNullable<
	Recipe.Success<typeof mediaActivityLogContextRecipe>
>;

/** One page of a show season's episodes, specials and unaired included, in episode order with their display state. */
export const showSeasonEpisodeChoicesRecipe = defineRecipe(
	(input: {
		readonly limit: number;
		readonly seasonNumber: number;
		readonly after?: string | undefined;
		readonly showEntityId: string;
		readonly reference: PluginIdentityReference;
	}) => {
		const episode = table("entity", "choiceEpisode");
		const show = table("entity", "choiceShow");
		const scope = episodicEpisodeQuery(
			showEpisodicKindConfig,
			show,
			episode,
			"choice",
			"any",
			"all",
		);
		return {
			map: ({ episodes }) => Result.succeed(episodes),
			queries: {
				episodes: selectedRows(episode, {
					limit: input.limit,
					...(input.after === undefined ? {} : { after: input.after }),
					joins: [...scope.joins, join("inner", show, entityId(show, input.showEntityId))],
					orderBy: [
						ascending(propertyNumber(episode, "episodeNumber")),
						ascending(column(episode, "id")),
					],
					where: and(
						scope.where,
						entitySchemaPredicate(show, "show", input.reference),
						eq(propertyNumber(episode, "seasonNumber"), literal(input.seasonNumber)),
					),
					selection: {
						id: selectedField(column(episode, "id"), EntityId),
						name: selectedField(column(episode, "name"), Schema.String),
						episodeNumber: selectedField(propertyNumber(episode, "episodeNumber"), Schema.Finite),
						publishDate: selectedField(
							propertyText(episode, "publishDate"),
							Schema.NullOr(Schema.String),
						),
						state: selectedField(
							episodeDisplayStateExpression(episode, show, "choiceState"),
							EpisodeLifecycleStateSchema,
						),
					},
				}),
			},
		};
	},
);

export type ShowSeasonEpisodeChoices = Recipe.Success<typeof showSeasonEpisodeChoicesRecipe>;

/**
 * One page of the regular, aired episodes positioned before the selected one that are not yet
 * complete, earliest first. Specials and the selected episode itself never appear; an unknown selected episode yields
 * nothing.
 */
export const episodicEarlierUnwatchedRecipe = defineRecipe(
	(input: {
		readonly limit: number;
		readonly kind: EpisodicKind;
		readonly after?: string | undefined;
		readonly parentEntityId: string;
		readonly episodeEntityId: string;
		readonly reference: PluginIdentityReference;
	}) => {
		const config = kindConfigs[input.kind];
		const episode = table("entity", "earlierEpisode");
		const parent = table("entity", "earlierParent");
		const anchor = table("entity", "earlierAnchor");
		const scope = episodicEpisodeQuery(config, parent, episode, "earlier");
		const anchorScope = episodicEpisodeQuery(config, parent, anchor, "earlierAnchor", "any", "all");
		const anchorAt = (index: number) => {
			const select = anchorScope.position[index];
			if (select === undefined) {
				throw new Error("Anchor position is incomplete");
			}
			return first(anchor, {
				select,
				joins: anchorScope.joins,
				orderBy: [ascending(column(anchor, "id"))],
				where: and(anchorScope.where, entityId(anchor, input.episodeEntityId)),
			});
		};
		const isBefore = (index: number): Predicate => {
			const position = scope.position[index];
			if (position === undefined) {
				throw new Error("Episode position is incomplete");
			}
			return index === scope.position.length - 1
				? lt(position, anchorAt(index))
				: or(
						lt(position, anchorAt(index)),
						and(eq(position, anchorAt(index)), isBefore(index + 1)),
					);
		};
		return {
			map: ({ episodes }) =>
				Result.succeed({
					items: episodes.items,
					hasMore: episodes.pageInfo.hasMore,
					nextCursor: episodes.pageInfo.nextCursor,
				}),
			queries: {
				episodes: selectedRows(episode, {
					limit: input.limit,
					...(input.after === undefined ? {} : { after: input.after }),
					joins: [...scope.joins, join("inner", parent, entityId(parent, input.parentEntityId))],
					orderBy: [
						...scope.position.map((expression) => ascending(expression)),
						ascending(column(episode, "id")),
					],
					where: and(
						scope.where,
						entitySchemaPredicate(parent, config.parentSchemaSlug, input.reference),
						isBefore(0),
						neq(
							episodeDisplayStateExpression(episode, parent, "earlierState"),
							literal("complete"),
						),
					),
					selection: {
						id: selectedField(column(episode, "id"), EntityId),
						name: selectedField(column(episode, "name"), Schema.String),
						episodeNumber: selectedField(propertyNumber(episode, "episodeNumber"), Schema.Finite),
						seasonNumber: selectedField(
							config.kind === "show" ? propertyNumber(episode, "seasonNumber") : literal(null),
							NextUpSeasonNumber,
						),
					},
				}),
			},
		};
	},
);

export type EpisodicEarlierUnwatched = Recipe.Success<typeof episodicEarlierUnwatchedRecipe>;
