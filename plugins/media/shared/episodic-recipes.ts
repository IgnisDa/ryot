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
	eq,
	eventOrderDescending,
	exists,
	first,
	groupAscending,
	groupDescending,
	inArray,
	isNull,
	IsoDateString,
	join,
	literal,
	selectedAggregate,
	selectedField,
	selectedInclude,
	selectedMeasure,
	selectedOptionalRow,
	selectedRows,
	sum,
	table,
	type SelectedQuery,
	type SelectedRow,
	type SelectedSelection,
} from "@ryot-app/plugin-kit/ryotql";
import { EntityId, EventId } from "@ryot-app/plugin-kit/schema";

import {
	entityId,
	entityIdentitySelection,
	entitySchema,
	propertyJson,
	propertyNumber,
	propertyText,
	relationshipTo,
	type Table,
} from "./entity-selections";
import {
	episodeDisplayStateExpression,
	episodeHasAired,
	episodeIsUpcoming,
	EpisodeLifecycleStateSchema,
	EpisodicLifecycleStateSchema,
	episodicEpisodeQuery,
	episodicLifecycleExpressions,
	episodicNextUpInclude,
	type EpisodicKindConfig,
} from "./lifecycle-expressions";
import { MediaImageListSchema } from "./media-image";
import {
	compareMediaActivityDescending,
	eventSchemaIsOneOf,
	extraOverviewQueries,
	mediaActivityEventSelection,
	mediaActivityParentSlugs,
	mediaCollectionActivityEvents,
	mediaCollectionEventsQuery,
	mediaEntityEventsQuery,
	mediaOverviewQueries,
	mediaSummaryQueries,
	mediaSummaryResult,
	mediaSummarySelection,
	type MediaExtraQueries,
} from "./media-recipes";

const EPISODIC_PRESENTATION_LIMIT = 100;

const episodicEpisodeSlugs = ["review"] as const;

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
			entitySchema(input.episode, input.episodeSchemaSlug),
			relationshipTo(relationship, input.container, input.episode, input.relationshipSlug),
		),
	};
};

export const episodicEpisodeSelection = (episode: Table, parent: Table, alias: string) => ({
	...entityIdentitySelection(episode),
	images: selectedField(propertyJson(episode, "images"), MediaImageListSchema),
	episodeNumber: selectedField(propertyNumber(episode, "episodeNumber"), Schema.Number),
	runtime: selectedField(propertyNumber(episode, "runtime"), Schema.NullOr(Schema.Number)),
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
			eq(column(completion, "eventSchemaSlug"), literal("complete")),
		),
	});
	return {
		episodeTotal: selectedField(count(episode, { joins, where }), Schema.Number),
		watchedTotal: selectedField(count(episode, { joins, where: isWatched }), Schema.Number),
		watchedUnknownRuntime: selectedField(
			count(episode, { joins, where: and(isWatched, isNull(runtime)) }),
			Schema.Number,
		),
		upcomingTotal: selectedField(
			count(episode, { joins, where: and(scope.where, episodeIsUpcoming(episode)) }),
			Schema.Number,
		),
		watchedMinutes: selectedField(
			sum(episode, coalesce(loggedMinutes, runtime), { joins, where: isWatched }),
			Schema.NullOr(Schema.Number),
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
			entitySchema(season, "show-season"),
			eq(column(parentSeason, "sourceEntityId"), literal(parentEntityId)),
			eq(
				column(parentSeason, "relationshipSchemaSlug"),
				literal(config.parentSeasonRelationshipSlug),
			),
			relationshipTo(seasonEpisode, season, episode, config.seasonEpisodeRelationshipSlug),
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
		Schema.Number,
	),
	watchedEpisodes: selectedField(
		episodicEpisodeCount(config, parent, `${alias}Watched`, "complete"),
		Schema.Number,
	),
	upcomingEpisodes: selectedField(
		episodicEpisodeCount(config, parent, `${alias}Upcoming`, "upcoming"),
		Schema.Number,
	),
	inProgressEpisodes: selectedField(
		episodicEpisodeCount(config, parent, `${alias}Progress`, "in_progress"),
		Schema.Number,
	),
});

export const episodicActivityEpisodeSelection = (episode: Table) => ({
	episodeId: selectedField(column(episode, "id"), EntityId),
	episodeName: selectedField(column(episode, "name"), Schema.String),
	episodeNumber: selectedField(propertyNumber(episode, "episodeNumber"), Schema.Number),
	episodeRuntime: selectedField(propertyNumber(episode, "runtime"), Schema.NullOr(Schema.Number)),
});

export type EpisodicActivityEpisodeSelection = ReturnType<typeof episodicActivityEpisodeSelection>;

export const episodicParentEventsQuery = (input: {
	readonly limit: number;
	readonly alias: string;
	readonly entityId: string;
}) =>
	mediaEntityEventsQuery({
		...input,
		slugs: mediaActivityParentSlugs,
		selection: (event) => ({
			...mediaActivityEventSelection(event),
			startedOn: selectedField(propertyText(event, "startedOn"), Schema.NullOr(IsoDateString)),
			completedOn: selectedField(propertyText(event, "completedOn"), Schema.NullOr(IsoDateString)),
			eventSchemaSlug: selectedField(
				column(event, "eventSchemaSlug"),
				Schema.Literals(mediaActivityParentSlugs),
			),
		}),
	});

export const episodicEpisodeEventsQuery = <const EpisodeFields extends SelectedSelection>(input: {
	readonly limit: number;
	readonly alias: string;
	readonly entityId: string;
	readonly config: EpisodicKindConfig;
	readonly episodeFields: (episode: Table) => EpisodeFields;
}) => {
	const event = table("event", `${input.alias}Event`);
	const episode = table("entity", `${input.alias}Episode`);
	return selectedRows(event, {
		limit: input.limit,
		orderBy: eventOrderDescending(event),
		joins: [join("inner", episode, eq(column(event, "entityId"), column(episode, "id")))],
		where: and(
			entitySchema(episode, input.config.episodeSchemaSlug),
			eventSchemaIsOneOf(event, episodicEpisodeSlugs),
			episodicEpisodeMembership(input.config, episode, input.entityId, `${input.alias}Member`),
		),
		selection: {
			...mediaActivityEventSelection(event),
			...episodicActivityEpisodeSelection(episode),
			...input.episodeFields(episode),
			eventSchemaSlug: selectedField(
				column(event, "eventSchemaSlug"),
				Schema.Literals(episodicEpisodeSlugs),
			),
		},
	});
};

export const episodicEpisodeProgressQuery = <const EpisodeFields extends SelectedSelection>(input: {
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
			entitySchema(episode, input.config.episodeSchemaSlug),
			exists(probe, { where: isProgressOf(probe) }),
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
						Schema.NullOr(Schema.Number),
					),
				},
			}),
		},
	});
};

export const episodicWatchDaysQuery = <const EpisodeFields extends SelectedSelection>(input: {
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
				Schema.NullOr(Schema.Number),
			),
		},
		where: and(
			entitySchema(episode, input.config.episodeSchemaSlug),
			eq(column(event, "eventSchemaSlug"), literal("complete")),
			episodicEpisodeMembership(input.config, episode, input.entityId, `${input.alias}Member`),
		),
		groupBy: {
			...input.episodeFields(episode),
			episodeId: selectedField(column(episode, "id"), EntityId),
			episodeName: selectedField(column(episode, "name"), Schema.String),
			episodeNumber: selectedField(propertyNumber(episode, "episodeNumber"), Schema.Number),
			runtime: selectedField(propertyNumber(episode, "runtime"), Schema.NullOr(Schema.Number)),
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
							entitySchema(episode, input.episodeSchemaSlug),
							eq(column(relationship, "sourceEntityId"), literal(query.containerId)),
							eq(column(relationship, "relationshipSchemaSlug"), literal(input.relationshipSlug)),
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
	(input: { readonly limit: number; readonly entityId: string }) => {
		const parent = table("entity", `${config.alias}CoverageParent`);
		return selectedRows(parent, {
			limit: input.limit,
			orderBy: [ascending(column(parent, "id"))],
			where: and(entitySchema(parent, config.slug), entityId(parent, input.entityId)),
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
		readonly limit: number;
		readonly entityId: string;
	}) => SelectedQuery<EpisodicCoverageRows<CoverageRow>>;
	readonly extraOverviewQueries?: (input: EpisodicOverviewInput) => ExtraOverviewQueries;
}) => {
	const summaryRecipe = defineRecipe(
		(input: { readonly entityId: string; readonly collectionLimit: number }) => ({
			map: ({ summary, requested }) =>
				mediaSummaryResult({
					requested,
					summary: summary && { ...summary, nextUp: summary.nextUp.items[0] ?? null },
				}),
			queries: mediaSummaryQueries({
				...input,
				slug: config.slug,
				include: (entity) => ({
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
							Schema.NullOr(Schema.Number),
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
						episode: config.activityEpisode(row),
						eventSchemaSlug: row.eventSchemaSlug,
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
				});
			},
			queries: {
				coverage: config.coverageQuery({ entityId: input.entityId, limit: input.coverageLimit }),
				collectionEvents: mediaCollectionEventsQuery({
					entityId: input.entityId,
					limit: input.collectionEventLimit,
				}),
				parentEvents: episodicParentEventsQuery({
					entityId: input.entityId,
					limit: input.parentEventLimit,
					alias: `${config.alias}ParentEvent`,
				}),
				episodeEvents: episodicEpisodeEventsQuery({
					config: config.config,
					entityId: input.entityId,
					limit: input.episodeEventLimit,
					episodeFields: config.episodeFields,
					alias: `${config.alias}EpisodeEvent`,
				}),
				episodeProgress: episodicEpisodeProgressQuery({
					config: config.config,
					entityId: input.entityId,
					limit: input.episodeProgressLimit,
					episodeFields: config.episodeFields,
					orderProperties: config.orderProperties,
					alias: `${config.alias}EpisodeProgress`,
				}),
				watchDays: episodicWatchDaysQuery({
					config: config.config,
					entityId: input.entityId,
					timeZone: input.timeZone,
					limit: input.watchDayLimit,
					alias: `${config.alias}WatchDay`,
					episodeFields: config.episodeFields,
					orderProperties: config.orderProperties,
				}),
				totals: selectedOptionalRow(parent, {
					orderBy: [ascending(column(parent, "id"))],
					where: and(entitySchema(parent, config.slug), entityId(parent, input.entityId)),
					selection: {
						watchCount: selectedField(
							count(watchEvent, {
								where: and(
									eq(column(watchEvent, "entityId"), column(parent, "id")),
									eq(column(watchEvent, "eventSchemaSlug"), literal("complete")),
								),
							}),
							Schema.Number,
						),
					},
				}),
			},
		};
	});

	const presentationRecipe = defineRecipe((entityIds: readonly string[]) => {
		const entity = table("entity", `${config.alias}PresentationEntity`);
		const lifecycle = episodicLifecycleExpressions(
			config.config,
			entity,
			`${config.alias}PresentationLifecycle`,
		);
		return {
			map: ({ rows }) => Result.succeed(rows.items),
			queries: {
				rows: selectedRows(entity, {
					limit: EPISODIC_PRESENTATION_LIMIT,
					orderBy: [ascending(column(entity, "id"))],
					where: and(
						entitySchema(entity, config.slug),
						inArray(
							column(entity, "id"),
							entityIds.map((requestedId) => literal(requestedId)),
						),
					),
					selection: {
						...entityIdentitySelection(entity),
						state: selectedField(lifecycle.state, EpisodicLifecycleStateSchema),
						images: selectedField(propertyJson(entity, "images"), MediaImageListSchema),
						publishDate: selectedField(
							propertyText(entity, "publishDate"),
							Schema.NullOr(Schema.String),
						),
						publishYear: selectedField(
							propertyNumber(entity, "publishYear"),
							Schema.NullOr(Schema.Number),
						),
						productionStatus: selectedField(
							propertyText(entity, "productionStatus"),
							Schema.NullOr(Schema.String),
						),
						...episodicCountSelection(config.config, entity, `${config.alias}Presentation`),
						...config.presentationFields(entity),
					},
				}),
			},
		};
	});

	return { summaryRecipe, overviewRecipe, activityRecipe, presentationRecipe };
};
