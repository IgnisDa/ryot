import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	castText,
	column,
	conditional,
	defineRecipe,
	entitySchemaPredicate,
	eq,
	first,
	join,
	jsonElementsJoin,
	literal,
	lt,
	measureDescending,
	neq,
	or,
	parameters,
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

import { MediaPosition } from "./consumption";
import {
	entityId,
	entityIdentitySelection,
	propertyJson,
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
	type ScalarExpression,
	showEpisodicKindConfig,
} from "./lifecycle-expressions";
import { mediaNumberField } from "./media-recipes";
import { builtinMediaEntitySchemaSlugs } from "./media-schema-slugs";

const NextUpSeasonNumber = Schema.NullOr(Schema.Finite);

const ENTITY_CONSUMED_ON_LIMIT = 10;
const RECENT_CONSUMED_ON_LIMIT = 5;
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
	readonly onlyThisEntity: boolean;
	readonly entityId: ScalarExpression;
	readonly reference: PluginIdentityReference;
}) => {
	const event = table("event", `${input.alias}Event`);
	const eventEntity = table("entity", `${input.alias}Entity`);
	const target = table("entity", `${input.alias}Target`);
	const source = jsonElementsJoin(
		"inner",
		`${input.alias}Source`,
		propertyJson(event, "consumedOn"),
	);
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
		groupBy: { consumedOn: selectedField(castText(column(source, "value")), Schema.String) },
		measures: {
			lastUsedAt: selectedMeasure(
				{ function: "maximum", expr: column(event, "occurredAt") },
				Schema.NullOr(Schema.String),
			),
		},
		joins: [
			source,
			join("inner", eventEntity, eq(column(event, "entityId"), column(eventEntity, "id"))),
			join("inner", target, entityId(target, input.entityId)),
		],
		where: and(
			schemaOwnerPredicate(event, "eventSchemaPluginId", input.reference),
			schemaOwnerPredicate(target, "entitySchemaPluginId", input.reference),
			sameSchemaOwner(eventEntity, "entitySchemaPluginId", target),
			eq(column(eventEntity, "entitySchemaSlug"), eventEntitySlug),
			eventSlugIsOneOf(event, ["complete", "progress"]),
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
 * and for shows and podcasts the next-up episode plus a show's seasons.
 */
export const mediaActivityLogContextRecipe = (structural: {
	readonly reference: PluginIdentityReference;
}) => {
	const args = parameters({
		fields: {
			entityId: {
				type: "string",
				label: "Title",
				description: "Title to read",
				validation: { required: true },
			},
		},
	});
	const input = { reference: structural.reference, entityId: args.value("entityId") };
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
	return defineRecipe({
		parameters: args.schema,
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
					pages: mediaNumberField(entity, "pages"),
					runtime: mediaNumberField(entity, "runtime"),
					volumes: mediaNumberField(entity, "volumes"),
					episodes: mediaNumberField(entity, "episodes"),
					chapters: mediaNumberField(entity, "chapters"),
					position: selectedField(lifecycle.position, Schema.NullOr(MediaPosition)),
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
						limit: 1,
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
						orderBy: [
							ascending(
								conditional(
									eq(propertyNumber(season, "seasonNumber"), literal(0)),
									literal(1),
									literal(0),
								),
							),
							ascending(propertyNumber(season, "seasonNumber")),
							ascending(column(season, "id")),
						],
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
	});
};
export type MediaActivityLogContext = NonNullable<
	Recipe.Success<ReturnType<typeof mediaActivityLogContextRecipe>>
>;
export const showSeasonChoicesRecipe = (input: { readonly reference: PluginIdentityReference }) => {
	const inputParameters = parameters({
		fields: {
			entityId: {
				type: "string",
				label: "Entity Id",
				validation: { required: true },
				description: "Entity Id for this selection",
			},
		},
	});
	const season = table("entity", "logSeasonChoice");
	const relationship = table("relationship", "logSeasonChoiceRelationship");
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ seasons }) => Result.succeed(seasons),
		queries: {
			seasons: selectedRows(season, {
				limit: 100,
				orderBy: [
					ascending(propertyNumber(season, "seasonNumber")),
					ascending(column(season, "id")),
				],
				joins: [
					join(
						"inner",
						relationship,
						eq(column(relationship, "targetEntityId"), column(season, "id")),
					),
				],
				selection: {
					id: selectedField(column(season, "id"), EntityId),
					name: selectedField(column(season, "name"), Schema.String),
					seasonNumber: selectedField(propertyNumber(season, "seasonNumber"), Schema.Finite),
				},
				where: and(
					entitySchemaPredicate(season, "show-season", input.reference),
					relationshipSchemaPredicate(relationship, "show-to-show-season", input.reference),
					eq(column(relationship, "sourceEntityId"), inputParameters.value("entityId")),
				),
			}),
		},
	});
};
/** The season number of a show episode, or null when the episode is not visible. */
export const showEpisodeSeasonRecipe = (() => {
	const args = parameters({
		fields: {
			episodeEntityId: {
				type: "string",
				label: "Episode",
				description: "Episode to read",
				validation: { required: true },
			},
		},
	});
	const input = { episodeEntityId: args.value("episodeEntityId") };
	const episode = table("entity", "seasonProbeEpisode");
	return defineRecipe({
		parameters: args.schema,
		map: ({ season }) => Result.succeed(season?.seasonNumber ?? null),
		queries: {
			season: selectedOptionalRow(episode, {
				orderBy: [ascending(column(episode, "id"))],
				where: and(
					entityId(episode, input.episodeEntityId),
					entitySchemaIs(episode, "show-episode"),
				),
				selection: {
					seasonNumber: selectedField(propertyNumber(episode, "seasonNumber"), NextUpSeasonNumber),
				},
			}),
		},
	});
})();
/** One page of a show season's episodes, specials and unaired included, in episode order with their display state. */
export const showSeasonEpisodeChoicesRecipe = (structural: {
	readonly reference: PluginIdentityReference;
}) => {
	const args = parameters({
		fields: {
			showEntityId: {
				label: "Show",
				type: "string",
				description: "Show to read",
				validation: { required: true },
			},
			seasonNumber: {
				type: "integer",
				label: "Season number",
				validation: { required: true },
				description: "Season number to read",
			},
		},
	});
	const input = {
		reference: structural.reference,
		showEntityId: args.value("showEntityId"),
		seasonNumber: args.value("seasonNumber"),
	};
	const episode = table("entity", "choiceEpisode");
	const show = table("entity", "choiceShow");
	const scope = episodicEpisodeQuery(showEpisodicKindConfig, show, episode, "choice", "any", "all");
	return defineRecipe({
		parameters: args.schema,
		map: ({ episodes }) => Result.succeed(episodes),
		queries: {
			episodes: selectedRows(episode, {
				limit: 100,
				joins: [...scope.joins, join("inner", show, entityId(show, input.showEntityId))],
				orderBy: [
					ascending(propertyNumber(episode, "episodeNumber")),
					ascending(column(episode, "id")),
				],
				where: and(
					scope.where,
					entitySchemaPredicate(show, "show", input.reference),
					eq(propertyNumber(episode, "seasonNumber"), input.seasonNumber),
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
	});
};
export type ShowSeasonEpisodeChoices = Recipe.Success<
	ReturnType<typeof showSeasonEpisodeChoicesRecipe>
>;
/**
 * One page of the regular, aired episodes positioned before the selected one that are not yet
 * complete, earliest first. Specials and the selected episode itself never appear; an unknown selected episode yields
 * nothing.
 */
export const episodicEarlierUnwatchedRecipe = (structural: {
	readonly config: EpisodicKindConfig;
	readonly reference: PluginIdentityReference;
}) => {
	const args = parameters({
		fields: {
			parentEntityId: {
				type: "string",
				label: "Title",
				description: "Title to read",
				validation: { required: true },
			},
			episodeEntityId: {
				type: "string",
				label: "Selected episode",
				validation: { required: true },
				description: "Selected episode to read",
			},
		},
	});
	const input = {
		reference: structural.reference,
		parentEntityId: args.value("parentEntityId"),
		episodeEntityId: args.value("episodeEntityId"),
	};
	const config = structural.config;
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
			: or(lt(position, anchorAt(index)), and(eq(position, anchorAt(index)), isBefore(index + 1)));
	};
	return defineRecipe({
		parameters: args.schema,
		map: ({ episodes }) =>
			Result.succeed({
				items: episodes.items,
				hasMore: episodes.pageInfo.hasMore,
				nextCursor: episodes.pageInfo.nextCursor,
			}),
		queries: {
			episodes: selectedRows(episode, {
				limit: 100,
				joins: [...scope.joins, join("inner", parent, entityId(parent, input.parentEntityId))],
				orderBy: [
					...scope.position.map((expression) => ascending(expression)),
					ascending(column(episode, "id")),
				],
				where: and(
					scope.where,
					entitySchemaPredicate(parent, config.parentSchemaSlug, input.reference),
					isBefore(0),
					neq(episodeDisplayStateExpression(episode, parent, "earlierState"), literal("complete")),
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
	});
};
export type EpisodicEarlierUnwatched = Recipe.Success<
	ReturnType<typeof episodicEarlierUnwatchedRecipe>
>;
