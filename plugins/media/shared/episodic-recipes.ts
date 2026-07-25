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
	EpisodeLifecycleStateSchema,
	EpisodicLifecycleStateSchema,
	episodeLifecycleStateExpression,
	episodicLifecycleExpressions,
	type EpisodicKindConfig,
} from "./lifecycle-expressions";
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

export const episodicEpisodeSelection = (episode: Table, alias: string) => ({
	...entityIdentitySelection(episode),
	images: selectedField(propertyJson(episode, "images"), MediaImageListSchema),
	episodeNumber: selectedField(propertyNumber(episode, "episodeNumber"), Schema.Number),
	runtime: selectedField(propertyNumber(episode, "runtime"), Schema.NullOr(Schema.Number)),
	publishDate: selectedField(propertyText(episode, "publishDate"), Schema.NullOr(Schema.String)),
	description: selectedField(propertyText(episode, "description"), Schema.NullOr(Schema.String)),
	state: selectedField(
		episodeLifecycleStateExpression(episode, alias),
		EpisodeLifecycleStateSchema,
	),
});

/** Episode totals, watched totals and watched minutes for one container's episodes. */
export const episodicCoverageSelection = (input: {
	readonly alias: string;
	readonly container: Table;
	readonly episodeSchemaSlug: string;
	readonly relationshipSlug: string;
}) => {
	const episode = table("entity", `${input.alias}Episode`);
	const runtime = propertyNumber(episode, "runtime");
	const { joins, where } = episodeTraversal({ ...input, episode });
	const isWatched = and(
		where,
		eq(episodeLifecycleStateExpression(episode, `${input.alias}Lifecycle`), literal("complete")),
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
		watchedMinutes: selectedField(
			sum(episode, coalesce(loggedMinutes, runtime), { joins, where: isWatched }),
			Schema.NullOr(Schema.Number),
		),
	};
};

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

/** Counts the episodes below one parent row, optionally narrowed to a lifecycle state. */
export const episodicEpisodeCount = (
	config: EpisodicKindConfig,
	parent: Table,
	alias: string,
	state?: "complete" | "in_progress",
) => {
	const episode = table("entity", `${alias}Episode`);
	const stateFilter =
		state === undefined
			? []
			: [eq(episodeLifecycleStateExpression(episode, `${alias}Lifecycle`), literal(state))];
	if (config.kind === "podcast") {
		const relationship = table("relationship", `${alias}Relationship`);
		return count(episode, {
			joins: [
				join(
					"inner",
					relationship,
					eq(column(relationship, "targetEntityId"), column(episode, "id")),
				),
			],
			where: and(
				entitySchema(episode, config.episodeSchemaSlug),
				relationshipTo(relationship, parent, episode, config.parentEpisodeRelationshipSlug),
				...stateFilter,
			),
		});
	}
	const season = table("entity", `${alias}Season`);
	const parentSeason = table("relationship", `${alias}ParentSeason`);
	const seasonEpisode = table("relationship", `${alias}SeasonEpisode`);
	return count(episode, {
		joins: [
			join(
				"inner",
				seasonEpisode,
				eq(column(seasonEpisode, "targetEntityId"), column(episode, "id")),
			),
			join("inner", season, eq(column(seasonEpisode, "sourceEntityId"), column(season, "id"))),
			join("inner", parentSeason, eq(column(parentSeason, "targetEntityId"), column(season, "id"))),
		],
		where: and(
			entitySchema(episode, config.episodeSchemaSlug),
			entitySchema(season, "show-season"),
			eq(column(parentSeason, "sourceEntityId"), column(parent, "id")),
			eq(
				column(parentSeason, "relationshipSchemaSlug"),
				literal(config.parentSeasonRelationshipSlug),
			),
			eq(
				column(seasonEpisode, "relationshipSchemaSlug"),
				literal(config.seasonEpisodeRelationshipSlug),
			),
			...stateFilter,
		),
	});
};

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
}) => {
	const event = table("event", input.alias);
	return selectedRows(event, {
		limit: input.limit,
		orderBy: eventOrderDescending(event),
		where: and(
			eq(column(event, "entityId"), literal(input.entityId)),
			eventSchemaIsOneOf(event, mediaActivityParentSlugs),
		),
		selection: {
			...mediaActivityEventSelection(event),
			startedOn: selectedField(propertyText(event, "startedOn"), Schema.NullOr(IsoDateString)),
			completedOn: selectedField(propertyText(event, "completedOn"), Schema.NullOr(IsoDateString)),
			eventSchemaSlug: selectedField(
				column(event, "eventSchemaSlug"),
				Schema.Literals(mediaActivityParentSlugs),
			),
		},
	});
};

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
	const event = table("event", `${input.alias}Event`);
	const probe = table("event", `${input.alias}Probe`);
	const isProgressOf = (candidate: Table) =>
		and(
			eq(column(candidate, "entityId"), column(episode, "id")),
			eq(column(candidate, "eventSchemaSlug"), literal("progress")),
		);
	return selectedRows(episode, {
		limit: input.limit,
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
				episodeLifecycleStateExpression(episode, `${input.alias}Lifecycle`),
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
	readonly extraFields: (episode: Table) => ExtraFields;
}) =>
	defineRecipe(
		(query: {
			readonly limit: number;
			readonly containerId: string;
			readonly after?: string | undefined;
		}) => {
			const episode = table("entity", `${input.alias}Episode`);
			const relationship = table("relationship", `${input.alias}Relationship`);
			const direction = input.order === "asc" ? ascending : descending;
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
							...episodicEpisodeSelection(episode, `${input.alias}Lifecycle`),
							...input.extraFields(episode),
						},
						joins: [
							join(
								"inner",
								relationship,
								eq(column(relationship, "targetEntityId"), column(episode, "id")),
							),
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
}) => {
	const summaryRecipe = defineRecipe(
		(input: { readonly entityId: string; readonly collectionLimit: number }) => {
			const entity = table("entity", "entity");
			const provider = table("sandboxProvider", "provider");
			const lifecycle = episodicLifecycleExpressions(
				config.config,
				entity,
				`${config.alias}SummaryLifecycle`,
			);
			return {
				map: ({ summary, requested }) =>
					Result.succeed({
						summary: summary ?? null,
						entitySchemaSlug: requested?.schemaSlug ?? null,
					}),
				queries: {
					requested: requestedSchemaQuery(input.entityId),
					summary: selectedOptionalRow(entity, {
						orderBy: [ascending(column(entity, "id"))],
						include: { collections: collectionMembershipInclude(input.collectionLimit) },
						where: and(entitySchema(entity, config.slug), entityId(entity, input.entityId)),
						joins: [
							join("left", provider, eq(column(entity, "providerId"), column(provider, "id"))),
						],
						selection: {
							...mediaSummarySelection(entity, provider),
							state: selectedField(lifecycle.state, EpisodicLifecycleStateSchema),
							totalEpisodes: selectedField(
								propertyNumber(entity, "totalEpisodes"),
								Schema.NullOr(Schema.Number),
							),
							storedEpisodes: selectedField(
								episodicEpisodeCount(config.config, entity, `${config.alias}SummaryStored`),
								Schema.Number,
							),
							watchedEpisodes: selectedField(
								episodicEpisodeCount(
									config.config,
									entity,
									`${config.alias}SummaryWatched`,
									"complete",
								),
								Schema.Number,
							),
							inProgressEpisodes: selectedField(
								episodicEpisodeCount(
									config.config,
									entity,
									`${config.alias}SummaryProgress`,
									"in_progress",
								),
								Schema.Number,
							),
							...config.summaryFields(entity),
						},
					}),
				},
			};
		},
	);

	const overviewQueries = (input: EpisodicOverviewInput) =>
		mediaOverviewQueries({ ...input, slug: config.slug });

	const overviewRecipe = defineRecipe((input: EpisodicOverviewInput) => ({
		queries: overviewQueries(input),
	}));

	const activityRecipe = defineRecipe((input: EpisodicActivityInput) => {
		const parent = table("entity", `${config.alias}ActivityEntity`);
		const watchEvent = table("event", `${config.alias}WatchCountEvent`);
		return {
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
					...collectionEvents.items.map(({ collectionId, collectionName, ...row }) => ({
						...row,
						text: null,
						rating: null,
						timeSpent: null,
						isSpoiler: null,
						consumedOn: null,
						kind: "collection" as const,
						collection: { id: collectionId, name: collectionName },
					})),
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
						storedEpisodes: selectedField(
							episodicEpisodeCount(config.config, entity, `${config.alias}PresentationStored`),
							Schema.Number,
						),
						watchedEpisodes: selectedField(
							episodicEpisodeCount(
								config.config,
								entity,
								`${config.alias}PresentationWatched`,
								"complete",
							),
							Schema.Number,
						),
						inProgressEpisodes: selectedField(
							episodicEpisodeCount(
								config.config,
								entity,
								`${config.alias}PresentationProgress`,
								"in_progress",
							),
							Schema.Number,
						),
						...config.presentationFields(entity),
					},
				}),
			},
		};
	});

	return { summaryRecipe, overviewRecipe, activityRecipe, overviewQueries, presentationRecipe };
};
