import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	coalesce,
	column,
	count,
	dateBucket,
	defineRecipe,
	descending,
	entitySchemaPredicate,
	eq,
	eventOrderDescending,
	exists,
	first,
	groupAscending,
	groupDescending,
	isNull,
	IsoDateString,
	join,
	literal,
	or,
	relationshipSchemaPredicate,
	schemaOwnerPredicate,
	selectedAggregate,
	selectedField,
	selectedInclude,
	selectedMeasure,
	selectedOptionalRow,
	type SelectedQuery,
	type SelectedRow,
	selectedRows,
	type SelectedSelection,
	sum,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import type { PluginIdentityReference } from "@ryot-app/plugin-kit/schema";
import { EntityId, EventId } from "@ryot-app/plugin-kit/schema";

import {
	mediaPresentationImageSelection,
	selectedPresentationSource,
} from "./entity-presentations";
import {
	entityId,
	entityIdentitySelection,
	propertyBoolean,
	propertyJson,
	propertyNumber,
	propertyText,
	type Table,
} from "./entity-selections";
import {
	entitySchemaIs,
	episodeDisplayStateExpression,
	episodeHasAired,
	episodeIsUpcoming,
	EpisodeLifecycleStateSchema,
	episodicEpisodeQuery,
	type EpisodicKindConfig,
	episodicLifecycleExpressions,
	EpisodicLifecycleStateSchema,
	episodicNextUpInclude,
	relationshipConnects,
	sameSchemaOwner,
} from "./lifecycle-expressions";
import { MediaImageListSchema } from "./media-image";
import {
	compareMediaActivityDescending,
	creditCharacterSelection,
	eventSchemaIsOneOf,
	extraOverviewQueries,
	mediaActivityEventSelection,
	mediaActivityParentSlugs,
	mediaCollectionActivityEvents,
	mediaCollectionEventsQuery,
	mediaEntityEventsQuery,
	type MediaExtraQueries,
	mediaGenresInclude,
	mediaHistoryBefore,
	type MediaHistoryInput,
	mediaHistoryPage,
	mediaOverviewQueries,
	mediaPeopleRecipe,
	mediaSummaryQueries,
	mediaSummaryResult,
	mediaSummarySelection,
} from "./media-recipes";

const episodicEpisodeSlugs = ["review"] as const;
const episodicHistorySlugs = ["review", "progress", "complete"] as const;

/** Joins and predicate selecting the episodes a container holds through one relationship. */
export const episodeTraversal = (input: {
	readonly alias: string;
	readonly episode: Table;
	readonly container: Table;
	readonly episodeSchemaSlug: string;
	readonly relationshipSlug: string;
}) => {
	const relationship = table("relationship", `${input.alias}Relationship`);
	return {
		joins: [
			join(
				"inner",
				relationship,
				eq(column(relationship, "targetEntityId"), column(input.episode, "id")),
			),
		],
		where: and(
			entitySchemaIs(input.episode, input.episodeSchemaSlug),
			relationshipConnects(relationship, input.container, input.episode, input.relationshipSlug),
		),
	};
};

export const episodicEpisodeSelection = (episode: Table, parent: Table, alias: string) => ({
	...entityIdentitySelection(episode),
	images: selectedField(propertyJson(episode, "images"), MediaImageListSchema),
	episodeNumber: selectedField(propertyNumber(episode, "episodeNumber"), Schema.Finite),
	runtime: selectedField(propertyNumber(episode, "runtime"), Schema.NullOr(Schema.Finite)),
	publishDate: selectedField(propertyText(episode, "publishDate"), Schema.NullOr(Schema.String)),
	description: selectedField(propertyText(episode, "description"), Schema.NullOr(Schema.String)),
	state: selectedField(
		episodeDisplayStateExpression(episode, parent, alias),
		EpisodeLifecycleStateSchema,
	),
});

/**
 * Aired and upcoming totals, watched totals and watched minutes for the episodes one scope selects.
 * Watched is judged by display state against the episodic parent.
 */
export const episodicScopedCoverageSelection = (input: {
	readonly alias: string;
	readonly parent: Table;
	readonly scope: (episode: Table) => {
		readonly joins: ReturnType<typeof join>[];
		readonly where: ReturnType<typeof and>;
	};
}) => {
	const episode = table("entity", `${input.alias}Episode`);
	const runtime = propertyNumber(episode, "runtime");
	const scope = input.scope(episode);
	const joins = scope.joins;
	const where = and(scope.where, episodeHasAired(episode));
	const isWatched = and(
		where,
		eq(
			episodeDisplayStateExpression(episode, input.parent, `${input.alias}State`),
			literal("complete"),
		),
	);
	const completion = table("event", `${input.alias}Completion`);
	const loggedMinutes = first(completion, {
		orderBy: eventOrderDescending(completion),
		select: propertyNumber(completion, "timeSpent"),
		where: and(
			eq(column(completion, "entityId"), column(episode, "id")),
			sameSchemaOwner(completion, "eventSchemaPluginId", input.parent),
			eq(column(completion, "eventSchemaSlug"), literal("complete")),
		),
	});
	return {
		episodeTotal: selectedField(count(episode, { joins, where }), Schema.Finite),
		watchedTotal: selectedField(count(episode, { joins, where: isWatched }), Schema.Finite),
		watchedUnknownRuntime: selectedField(
			count(episode, { joins, where: and(isWatched, isNull(runtime)) }),
			Schema.Finite,
		),
		upcomingTotal: selectedField(
			count(episode, { joins, where: and(scope.where, episodeIsUpcoming(episode)) }),
			Schema.Finite,
		),
		watchedMinutes: selectedField(
			sum(episode, coalesce(loggedMinutes, runtime), { joins, where: isWatched }),
			Schema.NullOr(Schema.Finite),
		),
	};
};

/** `episodicScopedCoverageSelection` over one container's episodes. */
export const episodicCoverageSelection = (input: {
	readonly alias: string;
	readonly parent: Table;
	readonly container: Table;
	readonly episodeSchemaSlug: string;
	readonly relationshipSlug: string;
}) =>
	episodicScopedCoverageSelection({
		alias: input.alias,
		parent: input.parent,
		scope: (episode) => episodeTraversal({ ...input, episode }),
	});

/** Predicate matching episodes that belong to one parent, however the schema nests them. */
export const episodicEpisodeMembership = (
	config: EpisodicKindConfig,
	episode: Table,
	parentEntityId: string,
	alias: string,
) => {
	if (config.kind === "podcast") {
		const relationship = table("relationship", `${alias}Relationship`);
		return exists(relationship, {
			where: and(
				sameSchemaOwner(relationship, "relationshipSchemaPluginId", episode),
				eq(column(relationship, "targetEntityId"), column(episode, "id")),
				eq(column(relationship, "sourceEntityId"), literal(parentEntityId)),
				eq(
					column(relationship, "relationshipSchemaSlug"),
					literal(config.parentEpisodeRelationshipSlug),
				),
			),
		});
	}
	const season = table("entity", `${alias}Season`);
	const parentSeason = table("relationship", `${alias}ParentSeason`);
	const seasonEpisode = table("relationship", `${alias}SeasonEpisode`);
	return exists(parentSeason, {
		joins: [
			join("inner", season, eq(column(parentSeason, "targetEntityId"), column(season, "id"))),
			join(
				"inner",
				seasonEpisode,
				eq(column(seasonEpisode, "sourceEntityId"), column(season, "id")),
			),
		],
		where: and(
			entitySchemaIs(season, "show-season"),
			sameSchemaOwner(season, "entitySchemaPluginId", episode),
			sameSchemaOwner(parentSeason, "relationshipSchemaPluginId", episode),
			eq(column(parentSeason, "sourceEntityId"), literal(parentEntityId)),
			eq(
				column(parentSeason, "relationshipSchemaSlug"),
				literal(config.parentSeasonRelationshipSlug),
			),
			relationshipConnects(seasonEpisode, season, episode, config.seasonEpisodeRelationshipSlug),
		),
	});
};

/**
 * Counts one parent row's regular episodes: the upcoming ones, or the aired (required) ones,
 * optionally narrowed to a display state.
 */
const episodicEpisodeCount = (
	config: EpisodicKindConfig,
	parent: Table,
	alias: string,
	filter?: "upcoming" | "complete" | "in_progress",
) => {
	const episode = table("entity", `${alias}Episode`);
	const { joins, where } = episodicEpisodeQuery(
		config,
		parent,
		episode,
		alias,
		filter === "upcoming" ? "upcoming" : "aired",
	);
	return count(episode, {
		joins,
		where:
			filter === undefined || filter === "upcoming"
				? where
				: and(
						where,
						eq(episodeDisplayStateExpression(episode, parent, `${alias}State`), literal(filter)),
					),
	});
};

const episodicCountSelection = (config: EpisodicKindConfig, parent: Table, alias: string) => ({
	airedEpisodes: selectedField(
		episodicEpisodeCount(config, parent, `${alias}Aired`),
		Schema.Finite,
	),
	watchedEpisodes: selectedField(
		episodicEpisodeCount(config, parent, `${alias}Watched`, "complete"),
		Schema.Finite,
	),
	upcomingEpisodes: selectedField(
		episodicEpisodeCount(config, parent, `${alias}Upcoming`, "upcoming"),
		Schema.Finite,
	),
	inProgressEpisodes: selectedField(
		episodicEpisodeCount(config, parent, `${alias}Progress`, "in_progress"),
		Schema.Finite,
	),
});

export const episodicActivityEpisodeSelection = (episode: Table) => ({
	episodeId: selectedField(column(episode, "id"), EntityId),
	episodeName: selectedField(column(episode, "name"), Schema.String),
	episodeNumber: selectedField(propertyNumber(episode, "episodeNumber"), Schema.Finite),
	episodeRuntime: selectedField(propertyNumber(episode, "runtime"), Schema.NullOr(Schema.Finite)),
});

export type EpisodicActivityEpisodeSelection = ReturnType<typeof episodicActivityEpisodeSelection>;

export const episodicParentEventsQuery = (input: {
	readonly reference: PluginIdentityReference;
	readonly limit: number;
	readonly alias: string;
	readonly entityId: string;
	readonly before?: string | undefined;
}) =>
	mediaEntityEventsQuery({
		...input,
		slugs: mediaActivityParentSlugs,
		selection: (event) => ({
			...mediaActivityEventSelection(event),
			startedOn: selectedField(propertyText(event, "startedOn"), Schema.NullOr(IsoDateString)),
			dateUnknown: selectedField(
				propertyBoolean(event, "dateUnknown"),
				Schema.NullOr(Schema.Boolean),
			),
			eventSchemaSlug: selectedField(
				column(event, "eventSchemaSlug"),
				Schema.Literals(mediaActivityParentSlugs),
			),
		}),
	});

const episodicEpisodeEventScope = (
	input: {
		readonly reference: PluginIdentityReference;
		readonly alias: string;
		readonly entityId: string;
		readonly config: EpisodicKindConfig;
	},
	event: Table,
	episode: Table,
	slugs: readonly string[],
) => ({
	joins: [join("inner", episode, eq(column(event, "entityId"), column(episode, "id")))],
	where: and(
		entitySchemaPredicate(episode, input.config.episodeSchemaSlug, input.reference),
		schemaOwnerPredicate(event, "eventSchemaPluginId", input.reference),
		eventSchemaIsOneOf(event, slugs),
		episodicEpisodeMembership(input.config, episode, input.entityId, `${input.alias}Member`),
	),
});

export const episodicEpisodeEventsQuery = <const EpisodeFields extends SelectedSelection>(input: {
	readonly reference: PluginIdentityReference;
	readonly limit: number;
	readonly alias: string;
	readonly entityId: string;
	readonly config: EpisodicKindConfig;
	readonly episodeFields: (episode: Table) => EpisodeFields;
	readonly before?: string | undefined;
	readonly history?: boolean;
}) => {
	const event = table("event", `${input.alias}Event`);
	const episode = table("entity", `${input.alias}Episode`);
	const scope = episodicEpisodeEventScope(
		input,
		event,
		episode,
		input.history ? episodicHistorySlugs : episodicEpisodeSlugs,
	);
	return selectedRows(event, {
		limit: input.limit,
		joins: scope.joins,
		orderBy: eventOrderDescending(event),
		where:
			input.before === undefined
				? scope.where
				: and(scope.where, mediaHistoryBefore(event, input.before)),
		selection: {
			...mediaActivityEventSelection(event),
			...episodicActivityEpisodeSelection(episode),
			...input.episodeFields(episode),
			progressPercent: selectedField(
				propertyNumber(event, "progressPercent"),
				Schema.NullOr(Schema.Finite),
			),
			eventSchemaSlug: selectedField(
				column(event, "eventSchemaSlug"),
				Schema.Literals(episodicHistorySlugs),
			),
		},
	});
};

export const episodicEpisodeProgressQuery = <const EpisodeFields extends SelectedSelection>(input: {
	readonly reference: PluginIdentityReference;
	readonly limit: number;
	readonly alias: string;
	readonly entityId: string;
	readonly config: EpisodicKindConfig;
	readonly orderProperties: readonly string[];
	readonly episodeFields: (episode: Table) => EpisodeFields;
}) => {
	const episode = table("entity", `${input.alias}Episode`);
	const parent = table("entity", `${input.alias}Parent`);
	const event = table("event", `${input.alias}Event`);
	const probe = table("event", `${input.alias}Probe`);
	const isProgressOf = (candidate: Table) =>
		and(
			eq(column(candidate, "entityId"), column(episode, "id")),
			schemaOwnerPredicate(candidate, "eventSchemaPluginId", input.reference),
			eq(column(candidate, "eventSchemaSlug"), literal("progress")),
		);
	return selectedRows(episode, {
		limit: input.limit,
		joins: [join("inner", parent, entityId(parent, input.entityId))],
		selection: { ...episodicActivityEpisodeSelection(episode), ...input.episodeFields(episode) },
		orderBy: [
			...input.orderProperties.map((property) => ascending(propertyNumber(episode, property))),
			ascending(propertyNumber(episode, "episodeNumber")),
			ascending(column(episode, "id")),
		],
		where: and(
			entitySchemaPredicate(episode, input.config.episodeSchemaSlug, input.reference),
			exists(probe, { where: isProgressOf(probe) }),
			schemaOwnerPredicate(parent, "entitySchemaPluginId", input.reference),
			eq(
				episodeDisplayStateExpression(episode, parent, `${input.alias}State`),
				literal("in_progress"),
			),
			episodicEpisodeMembership(input.config, episode, input.entityId, `${input.alias}Member`),
		),
		include: {
			milestone: selectedInclude(event, {
				limit: 1,
				where: isProgressOf(event),
				orderBy: eventOrderDescending(event),
				selection: {
					id: selectedField(column(event, "id"), EventId),
					createdAt: selectedField(column(event, "createdAt"), IsoDateString),
					occurredAt: selectedField(column(event, "occurredAt"), IsoDateString),
					consumedOn: selectedField(
						propertyText(event, "consumedOn"),
						Schema.NullOr(Schema.String),
					),
					progressPercent: selectedField(
						propertyNumber(event, "progressPercent"),
						Schema.NullOr(Schema.Finite),
					),
				},
			}),
		},
	});
};

export const episodicWatchDaysQuery = <const EpisodeFields extends SelectedSelection>(input: {
	readonly reference: PluginIdentityReference;
	readonly limit: number;
	readonly alias: string;
	readonly entityId: string;
	readonly timeZone: string;
	readonly config: EpisodicKindConfig;
	readonly orderProperties: readonly string[];
	readonly episodeFields: (episode: Table) => EpisodeFields;
}) => {
	const event = table("event", `${input.alias}Event`);
	const episode = table("entity", `${input.alias}Episode`);
	return selectedAggregate(event, {
		limit: input.limit,
		joins: [join("inner", episode, eq(column(event, "entityId"), column(episode, "id")))],
		orderBy: [
			groupDescending("day"),
			...input.orderProperties.map(groupAscending),
			groupAscending("episodeNumber"),
		],
		measures: {
			minutes: selectedMeasure(
				{ function: "sum", expr: propertyNumber(event, "timeSpent") },
				Schema.NullOr(Schema.Finite),
			),
		},
		where: and(
			entitySchemaPredicate(episode, input.config.episodeSchemaSlug, input.reference),
			schemaOwnerPredicate(event, "eventSchemaPluginId", input.reference),
			eq(column(event, "eventSchemaSlug"), literal("complete")),
			or(
				isNull(propertyBoolean(event, "dateUnknown")),
				eq(propertyBoolean(event, "dateUnknown"), literal(false)),
			),
			episodicEpisodeMembership(input.config, episode, input.entityId, `${input.alias}Member`),
		),
		groupBy: {
			...input.episodeFields(episode),
			episodeId: selectedField(column(episode, "id"), EntityId),
			episodeName: selectedField(column(episode, "name"), Schema.String),
			episodeNumber: selectedField(propertyNumber(episode, "episodeNumber"), Schema.Finite),
			runtime: selectedField(propertyNumber(episode, "runtime"), Schema.NullOr(Schema.Finite)),
			consumedOn: selectedField(propertyText(event, "consumedOn"), Schema.NullOr(Schema.String)),
			day: selectedField(
				dateBucket(column(event, "occurredAt"), { bucket: "day", timeZone: input.timeZone }),
				IsoDateString,
			),
		},
	});
};

/**
 * Episodes of one container as a top-level row query, so the list pages by cursor.
 * A nested include would only expose `hasMore`.
 */
export const episodicEpisodesRecipe = <const ExtraFields extends SelectedSelection>(input: {
	readonly alias: string;
	readonly order: "asc" | "desc";
	readonly episodeSchemaSlug: string;
	readonly relationshipSlug: string;
	/** Set when the container is not the episodic parent itself but hangs off it, like a season. */
	readonly parentRelationshipSlug?: string;
	readonly extraFields: (episode: Table) => ExtraFields;
}) =>
	defineRecipe(
		(query: {
			readonly reference: PluginIdentityReference;
			readonly limit: number;
			readonly containerId: string;
			readonly after?: string | undefined;
		}) => {
			const episode = table("entity", `${input.alias}Episode`);
			const parent = table("entity", `${input.alias}Parent`);
			const relationship = table("relationship", `${input.alias}Relationship`);
			const parentRelationship = table("relationship", `${input.alias}ParentRelationship`);
			const direction = input.order === "asc" ? ascending : descending;
			const parentJoins =
				input.parentRelationshipSlug === undefined
					? [
							join(
								"inner",
								parent,
								eq(column(parent, "id"), column(relationship, "sourceEntityId")),
							),
						]
					: [
							join(
								"inner",
								parentRelationship,
								and(
									schemaOwnerPredicate(
										parentRelationship,
										"relationshipSchemaPluginId",
										query.reference,
									),
									eq(
										column(parentRelationship, "targetEntityId"),
										column(relationship, "sourceEntityId"),
									),
									eq(
										column(parentRelationship, "relationshipSchemaSlug"),
										literal(input.parentRelationshipSlug),
									),
								),
							),
							join(
								"inner",
								parent,
								eq(column(parent, "id"), column(parentRelationship, "sourceEntityId")),
							),
						];
			return {
				map: ({ episodes }) => Result.succeed(episodes),
				queries: {
					episodes: selectedRows(episode, {
						limit: query.limit,
						...(query.after === undefined ? {} : { after: query.after }),
						orderBy: [
							direction(propertyNumber(episode, "episodeNumber")),
							direction(column(episode, "id")),
						],
						selection: {
							...episodicEpisodeSelection(episode, parent, `${input.alias}State`),
							...input.extraFields(episode),
						},
						joins: [
							join(
								"inner",
								relationship,
								eq(column(relationship, "targetEntityId"), column(episode, "id")),
							),
							...parentJoins,
						],
						where: and(
							entitySchemaPredicate(episode, input.episodeSchemaSlug, query.reference),
							schemaOwnerPredicate(parent, "entitySchemaPluginId", query.reference),
							eq(column(relationship, "sourceEntityId"), literal(query.containerId)),
							relationshipSchemaPredicate(relationship, input.relationshipSlug, query.reference),
						),
					}),
				},
			};
		},
	);

/** Coverage for a parent that holds its episodes directly, as one row on the parent itself. */
export const episodicParentCoverageQuery =
	(config: {
		readonly slug: string;
		readonly alias: string;
		readonly episodeSchemaSlug: string;
		readonly relationshipSlug: string;
	}) =>
	(input: {
		readonly reference: PluginIdentityReference;
		readonly limit: number;
		readonly entityId: string;
	}) => {
		const parent = table("entity", `${config.alias}CoverageParent`);
		return selectedRows(parent, {
			limit: input.limit,
			orderBy: [ascending(column(parent, "id"))],
			where: and(
				entitySchemaPredicate(parent, config.slug, input.reference),
				entityId(parent, input.entityId),
			),
			selection: {
				id: selectedField(column(parent, "id"), EntityId),
				...episodicCoverageSelection({
					parent,
					container: parent,
					alias: `${config.alias}Coverage`,
					relationshipSlug: config.relationshipSlug,
					episodeSchemaSlug: config.episodeSchemaSlug,
				}),
			},
		});
	};

type EpisodicCoverageRows<Row> = {
	readonly items: readonly Row[];
	readonly pageInfo: { readonly hasMore: boolean };
};

export type EpisodicActivityInput = {
	readonly reference: PluginIdentityReference;
	readonly entityId: string;
	readonly timeZone: string;
	readonly coverageLimit: number;
	readonly watchDayLimit: number;
	readonly parentEventLimit: number;
	readonly episodeEventLimit: number;
	readonly episodeProgressLimit: number;
	readonly collectionEventLimit: number;
};

export type EpisodicOverviewInput = {
	readonly reference: PluginIdentityReference;
	readonly entityId: string;
	readonly peopleLimit: number;
	readonly companyLimit: number;
	readonly recommendationLimit: number;
};

/** The episodic counterpart of `mediaFlatRecipes`: everything a parent shares above its episodes. */
export const mediaEpisodicRecipes = <
	const SummaryFields extends SelectedSelection,
	const PresentationFields extends SelectedSelection,
	const EpisodeFields extends SelectedSelection,
	CoverageRow extends { readonly id: string },
	Episode,
	const ExtraOverviewQueries extends MediaExtraQueries = Record<never, never>,
>(config: {
	readonly slug: string;
	readonly alias: string;
	readonly config: EpisodicKindConfig;
	readonly orderProperties: readonly string[];
	readonly summaryFields: (entity: Table) => SummaryFields;
	readonly episodeFields: (episode: Table) => EpisodeFields;
	readonly presentationFields: (entity: Table) => PresentationFields;
	readonly activityEpisode: (
		row: SelectedRow<EpisodicActivityEpisodeSelection & EpisodeFields>,
	) => Episode;
	readonly coverageQuery: (input: {
		readonly reference: PluginIdentityReference;
		readonly limit: number;
		readonly entityId: string;
	}) => SelectedQuery<EpisodicCoverageRows<CoverageRow>>;
	readonly extraOverviewQueries?: (input: EpisodicOverviewInput) => ExtraOverviewQueries;
}) => {
	const summaryRecipe = defineRecipe(
		(input: {
			readonly reference: PluginIdentityReference;
			readonly entityId: string;
			readonly collectionLimit: number;
		}) => ({
			map: ({ summary, requested }) =>
				mediaSummaryResult({
					requested,
					summary: summary && { ...summary, nextUp: summary.nextUp.items[0] ?? null },
				}),
			queries: mediaSummaryQueries({
				...input,
				slug: config.slug,
				include: (entity) => ({
					genres: mediaGenresInclude(entity, config.slug, input.reference),
					nextUp: episodicNextUpInclude(config.config, entity, (episode) => ({
						...episodicEpisodeSelection(episode, entity, `${config.alias}NextUpState`),
						...config.episodeFields(episode),
					})),
				}),
				selection: (entity, provider) => {
					const lifecycle = episodicLifecycleExpressions(
						config.config,
						entity,
						`${config.alias}SummaryLifecycle`,
					);
					return {
						...mediaSummarySelection(entity, provider),
						state: selectedField(lifecycle.state, EpisodicLifecycleStateSchema),
						totalEpisodes: selectedField(
							propertyNumber(entity, "totalEpisodes"),
							Schema.NullOr(Schema.Finite),
						),
						...episodicCountSelection(config.config, entity, `${config.alias}Summary`),
						...config.summaryFields(entity),
					};
				},
			}),
		}),
	);

	const overviewRecipe = defineRecipe((input: EpisodicOverviewInput) => ({
		queries: {
			...mediaOverviewQueries({ ...input, slug: config.slug }),
			...extraOverviewQueries(config.extraOverviewQueries, input),
		},
	}));

	const activityRecipe = defineRecipe((input: EpisodicActivityInput) => {
		const parent = table("entity", `${config.alias}ActivityEntity`);
		const watchEvent = table("event", `${config.alias}WatchCountEvent`);
		const historyEvent = table("event", `${config.alias}HistoryCountEvent`);
		const historyEpisode = table("entity", `${config.alias}HistoryCountEpisode`);
		return {
			map: ({
				totals,
				coverage,
				watchDays,
				parentEvents,
				episodeEvents,
				episodeProgress,
				collectionEvents,
			}) => {
				const events = [
					...parentEvents.items.map((row) => ({ ...row, kind: "parent" as const })),
					...episodeEvents.items.map((row) => ({
						id: row.id,
						text: row.text,
						rating: row.rating,
						progressPercent: null,
						isSpoiler: row.isSpoiler,
						createdAt: row.createdAt,
						timeSpent: row.timeSpent,
						kind: "episode" as const,
						occurredAt: row.occurredAt,
						consumedOn: row.consumedOn,
						eventSchemaSlug: "review" as const,
						episode: config.activityEpisode(row),
					})),
					...episodeProgress.items.flatMap((row) =>
						row.milestone.items.map((milestone) => ({
							...milestone,
							text: null,
							rating: null,
							timeSpent: null,
							isSpoiler: null,
							kind: "episode" as const,
							eventSchemaSlug: "progress" as const,
							episode: config.activityEpisode(row),
						})),
					),
					...mediaCollectionActivityEvents(collectionEvents.items),
				];
				const displayedWatches = new Set(
					watchDays.items.map((row) => JSON.stringify([row.day, row.episodeId])),
				).size;
				return Result.succeed({
					coverage: coverage.items,
					watchDays: watchDays.items,
					watchCount: totals?.watchCount ?? 0,
					events: events.sort(compareMediaActivityDescending),
					truncated:
						coverage.pageInfo.hasMore ||
						watchDays.pageInfo?.hasMore === true ||
						parentEvents.pageInfo.hasMore ||
						episodeEvents.pageInfo.hasMore ||
						episodeProgress.pageInfo.hasMore ||
						collectionEvents.pageInfo.hasMore,
					hasMoreActivities:
						(totals?.historyEventCount ?? 0) >
							episodeEvents.items.length +
								episodeProgress.items.reduce(
									(total, row) => total + row.milestone.items.length,
									0,
								) +
								displayedWatches ||
						watchDays.pageInfo?.hasMore === true ||
						parentEvents.pageInfo.hasMore ||
						episodeEvents.pageInfo.hasMore ||
						episodeProgress.pageInfo.hasMore ||
						collectionEvents.pageInfo.hasMore,
				});
			},
			queries: {
				collectionEvents: mediaCollectionEventsQuery({
					entityId: input.entityId,
					limit: input.collectionEventLimit,
				}),
				coverage: config.coverageQuery({
					entityId: input.entityId,
					reference: input.reference,
					limit: input.coverageLimit,
				}),
				parentEvents: episodicParentEventsQuery({
					entityId: input.entityId,
					reference: input.reference,
					limit: input.parentEventLimit,
					alias: `${config.alias}ParentEvent`,
				}),
				episodeEvents: episodicEpisodeEventsQuery({
					config: config.config,
					entityId: input.entityId,
					reference: input.reference,
					limit: input.episodeEventLimit,
					episodeFields: config.episodeFields,
					alias: `${config.alias}EpisodeEvent`,
				}),
				episodeProgress: episodicEpisodeProgressQuery({
					config: config.config,
					entityId: input.entityId,
					reference: input.reference,
					limit: input.episodeProgressLimit,
					episodeFields: config.episodeFields,
					orderProperties: config.orderProperties,
					alias: `${config.alias}EpisodeProgress`,
				}),
				watchDays: episodicWatchDaysQuery({
					config: config.config,
					entityId: input.entityId,
					timeZone: input.timeZone,
					reference: input.reference,
					limit: input.watchDayLimit,
					alias: `${config.alias}WatchDay`,
					episodeFields: config.episodeFields,
					orderProperties: config.orderProperties,
				}),
				totals: selectedOptionalRow(parent, {
					orderBy: [ascending(column(parent, "id"))],
					where: and(
						entitySchemaPredicate(parent, config.slug, input.reference),
						entityId(parent, input.entityId),
					),
					selection: {
						historyEventCount: selectedField(
							count(
								historyEvent,
								episodicEpisodeEventScope(
									{ ...input, config: config.config, alias: `${config.alias}HistoryCount` },
									historyEvent,
									historyEpisode,
									episodicHistorySlugs,
								),
							),
							Schema.Finite,
						),
						watchCount: selectedField(
							count(watchEvent, {
								where: and(
									eq(column(watchEvent, "entityId"), column(parent, "id")),
									schemaOwnerPredicate(watchEvent, "eventSchemaPluginId", input.reference),
									eq(column(watchEvent, "eventSchemaSlug"), literal("complete")),
								),
							}),
							Schema.Finite,
						),
					},
				}),
			},
		};
	});

	const presentationEntity = table("entity", "entity");
	const presentationLifecycle = episodicLifecycleExpressions(
		config.config,
		presentationEntity,
		`${config.alias}PresentationLifecycle`,
	);
	const presentationSource = selectedPresentationSource({
		table: presentationEntity,
		selection: {
			...entityIdentitySelection(presentationEntity),
			state: selectedField(presentationLifecycle.state, EpisodicLifecycleStateSchema),
			...mediaPresentationImageSelection(presentationEntity),
			publishDate: selectedField(
				propertyText(presentationEntity, "publishDate"),
				Schema.NullOr(Schema.String),
			),
			publishYear: selectedField(
				propertyNumber(presentationEntity, "publishYear"),
				Schema.NullOr(Schema.Finite),
			),
			productionStatus: selectedField(
				propertyText(presentationEntity, "productionStatus"),
				Schema.NullOr(Schema.String),
			),
			...episodicCountSelection(config.config, presentationEntity, `${config.alias}Presentation`),
			...config.presentationFields(presentationEntity),
		},
	});

	const peopleRecipe = mediaPeopleRecipe({ ...config, personFields: creditCharacterSelection });
	const historyRecipe = defineRecipe((input: MediaHistoryInput) => ({
		queries: {
			collectionEvents: mediaCollectionEventsQuery(input),
			parentEvents: episodicParentEventsQuery({ ...input, alias: `${config.alias}HistoryParent` }),
			episodeEvents: episodicEpisodeEventsQuery({
				...input,
				history: true,
				config: config.config,
				episodeFields: config.episodeFields,
				alias: `${config.alias}HistoryEpisode`,
			}),
		},
		map: ({ parentEvents, episodeEvents, collectionEvents }) =>
			Result.succeed(
				mediaHistoryPage(
					[
						...parentEvents.items.map((row) => ({ ...row, kind: "parent" as const })),
						...episodeEvents.items.map((row) => ({
							...row,
							kind: "episode" as const,
							episode: config.activityEpisode(row),
						})),
						...mediaCollectionActivityEvents(collectionEvents.items),
					],
					input.limit,
					parentEvents.pageInfo.hasMore ||
						episodeEvents.pageInfo.hasMore ||
						collectionEvents.pageInfo.hasMore,
				),
			),
	}));
	return {
		peopleRecipe,
		summaryRecipe,
		historyRecipe,
		overviewRecipe,
		activityRecipe,
		presentationSource,
	};
};
