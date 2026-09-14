import { Effect, Result, Schema } from "@ryot-app/sandbox-sdk/effect";
import {
	and,
	ascending,
	castDate,
	castNumber,
	castText,
	column,
	conditional,
	defineRecipe,
	eq,
	eventIsAfter,
	eventOrderDescending,
	executeRyotqlRecipe,
	gt,
	join,
	jsonPath,
	literal,
	selectedField,
	selectedOptionalRow,
	selectedRows,
	table,
	type PreparedRecipe,
	type Recipe,
	type RyotQLDocument,
} from "@ryot-app/sandbox-sdk/ryotql";

import {
	entitySchemaIs,
	EpisodeLifecycleStateSchema,
	EpisodicLifecycleStateSchema,
	episodicCoverageExpressions,
	episodicLifecycleExpressions,
	eventSlugIsOneOf,
	latestAggregateSignalExpressions,
	latestEpisodeLifecycleExpressions,
	latestParentCompletionExpressions,
	lifecycleEventSlugs,
	orderExpressionsAreAfter,
	relationshipConnects,
	type EpisodicKindConfig,
	type EventOrderExpressions,
	type ScalarExpression,
	type showEpisodicKindConfig,
	type TableReference,
} from "../../shared/lifecycle-expressions";

export const EventOrderTupleSchema = Schema.Struct({
	id: Schema.String,
	createdAt: Schema.String,
	occurredAt: Schema.String,
});

export type EventOrderTuple = Schema.Schema.Type<typeof EventOrderTupleSchema>;

export const EpisodeParentResolutionSchema = Schema.Union([
	Schema.Struct({ parentEntityId: Schema.String, kind: Schema.Literal("podcast") }),
	Schema.Struct({
		seasonNumber: Schema.Number,
		kind: Schema.Literal("show"),
		parentEntityId: Schema.String,
	}),
]);

export type EpisodeParentResolution = Schema.Schema.Type<typeof EpisodeParentResolutionSchema>;

const AggregateLifecycleSignalSlugSchema = Schema.Literals([
	"backlog",
	"progress",
	"complete",
	"dropped",
	"on_hold",
]);

export const AggregateLifecycleSignalSchema = Schema.Struct({
	id: Schema.String,
	entityId: Schema.String,
	createdAt: Schema.String,
	occurredAt: Schema.String,
	kind: Schema.Literals(["parent", "episode"]),
	eventSchemaSlug: AggregateLifecycleSignalSlugSchema,
});

export type AggregateLifecycleSignal = Schema.Schema.Type<typeof AggregateLifecycleSignalSchema>;

export const CurrentCycleChildEventSchema = Schema.Struct({
	id: Schema.String,
	entityId: Schema.String,
	createdAt: Schema.String,
	occurredAt: Schema.String,
	consumedOn: Schema.NullOr(Schema.String),
	eventSchemaSlug: Schema.Literals(["progress", "complete"]),
});

export type CurrentCycleChildEvent = Schema.Schema.Type<typeof CurrentCycleChildEventSchema>;

export const CoverageClosingEventSchema = EventOrderTupleSchema;

export type CoverageClosingEvent = Schema.Schema.Type<typeof CoverageClosingEventSchema>;

export const EpisodicCoverageReplaySchema = Schema.Struct({
	coverageComplete: Schema.Boolean,
	agreedConsumedOn: Schema.NullOr(Schema.String),
	coverageClosingEvent: Schema.NullOr(CoverageClosingEventSchema),
});

export type EpisodicCoverageReplay = Schema.Schema.Type<typeof EpisodicCoverageReplaySchema>;

export const EpisodicLifecycleSnapshotSchema = Schema.Struct({
	parentEntityId: Schema.String,
	coverageComplete: Schema.Boolean,
	state: EpisodicLifecycleStateSchema,
	agreedConsumedOn: Schema.NullOr(Schema.String),
	productionStatus: Schema.NullOr(Schema.String),
	requiredEpisodeIds: Schema.Array(Schema.String),
	boundaryCompleteEventId: Schema.NullOr(Schema.String),
	latestSignal: Schema.NullOr(AggregateLifecycleSignalSchema),
	boundaryCompleteEvent: Schema.NullOr(EventOrderTupleSchema),
	coverageClosingEvent: Schema.NullOr(CoverageClosingEventSchema),
});

export type EpisodicLifecycleSnapshot = Schema.Schema.Type<typeof EpisodicLifecycleSnapshotSchema>;

export const podcastEpisodicKindConfig = {
	kind: "podcast",
	parentSchemaSlug: "podcast",
	episodeSchemaSlug: "podcast-episode",
	parentEpisodeRelationshipSlug: "podcast-to-podcast-episode",
} as const satisfies EpisodicKindConfig;

const eventOrderAscending = (event: TableReference) =>
	eventOrderDescending(event).map(({ expr }) => ascending(expr));

const episodeRelationshipQuery = (
	config: EpisodicKindConfig,
	parent: TableReference,
	episode: TableReference,
	alias: string,
) => {
	if (config.kind === "podcast") {
		const relationship = table("relationship", `${alias}Relationship`);
		return {
			joins: [
				join(
					"inner",
					relationship,
					eq(column(relationship, "targetEntityId"), column(episode, "id")),
				),
			],
			where: and(
				entitySchemaIs(episode, config.episodeSchemaSlug),
				relationshipConnects(relationship, parent, episode, config.parentEpisodeRelationshipSlug),
			),
		};
	}

	const season = table("entity", `${alias}Season`);
	const showSeason = table("relationship", `${alias}ShowSeason`);
	const seasonEpisode = table("relationship", `${alias}SeasonEpisode`);
	return {
		joins: [
			join(
				"inner",
				seasonEpisode,
				eq(column(seasonEpisode, "targetEntityId"), column(episode, "id")),
			),
			join("inner", season, eq(column(seasonEpisode, "sourceEntityId"), column(season, "id"))),
			join("inner", showSeason, eq(column(showSeason, "targetEntityId"), column(season, "id"))),
		],
		where: and(
			entitySchemaIs(episode, config.episodeSchemaSlug),
			entitySchemaIs(season, "show-season"),
			gt(castNumber(jsonPath(column(season, "properties"), "seasonNumber")), literal(0)),
			relationshipConnects(showSeason, parent, season, config.parentSeasonRelationshipSlug),
			relationshipConnects(seasonEpisode, season, episode, config.seasonEpisodeRelationshipSlug),
		),
	};
};

export const episodicCoverageExpression = (
	config: EpisodicKindConfig,
	parent: TableReference,
	alias = "episodicCoverage",
) => episodicCoverageExpressions(config, parent, alias).coverageComplete;

export const currentCycleEpisodeLifecycleStateExpression = (
	episode: TableReference,
	parent: TableReference,
	alias = "currentCycleEpisodeLifecycle",
) => {
	const latest = latestEpisodeLifecycleExpressions(episode, parent, `${alias}Event`);
	const boundary = latestParentCompletionExpressions(parent, `${alias}Boundary`);
	return conditional(
		and(
			orderExpressionsAreAfter(latest, boundary),
			eq(latest.eventSchemaSlug, literal("complete")),
		),
		literal("complete"),
		conditional(
			and(
				orderExpressionsAreAfter(latest, boundary),
				eq(latest.eventSchemaSlug, literal("progress")),
			),
			literal("in_progress"),
			literal("untracked"),
		),
	);
};

export function resolveEpisodeParentRecipe(input: {
	readonly config: typeof showEpisodicKindConfig;
	readonly episodeEntityId: string;
}): PreparedRecipe<Extract<EpisodeParentResolution, { kind: "show" }> | null>;
export function resolveEpisodeParentRecipe(input: {
	readonly config: typeof podcastEpisodicKindConfig;
	readonly episodeEntityId: string;
}): PreparedRecipe<Extract<EpisodeParentResolution, { kind: "podcast" }> | null>;
export function resolveEpisodeParentRecipe(input: {
	readonly config: EpisodicKindConfig;
	readonly episodeEntityId: string;
}) {
	const episode = table("entity", "resolvedEpisode");
	const parent = table("entity", "resolvedParent");
	if (input.config.kind === "podcast") {
		const config = input.config;
		const relationship = table("relationship", "resolvedPodcastEpisode");
		return defineRecipe(() => ({
			map: ({ parents }) => {
				const match = parents.items.length === 1 ? parents.items[0] : undefined;
				return Result.succeed(match ? { ...match, kind: "podcast" as const } : null);
			},
			queries: {
				parents: selectedRows(parent, {
					limit: 2,
					orderBy: [ascending(column(parent, "id"))],
					selection: { parentEntityId: selectedField(column(parent, "id"), Schema.String) },
					joins: [
						join(
							"inner",
							relationship,
							eq(column(relationship, "sourceEntityId"), column(parent, "id")),
						),
						join(
							"inner",
							episode,
							eq(column(relationship, "targetEntityId"), column(episode, "id")),
						),
					],
					where: and(
						entitySchemaIs(parent, config.parentSchemaSlug),
						entitySchemaIs(episode, config.episodeSchemaSlug),
						eq(column(episode, "id"), literal(input.episodeEntityId)),
						relationshipConnects(
							relationship,
							parent,
							episode,
							config.parentEpisodeRelationshipSlug,
						),
					),
				}),
			},
		}))();
	}

	const config = input.config;
	const season = table("entity", "resolvedSeason");
	const showSeason = table("relationship", "resolvedShowSeason");
	const seasonEpisode = table("relationship", "resolvedSeasonEpisode");
	return defineRecipe(() => ({
		map: ({ parents }) => {
			const match = parents.items.length === 1 ? parents.items[0] : undefined;
			return Result.succeed(match ? { ...match, kind: "show" as const } : null);
		},
		queries: {
			parents: selectedRows(parent, {
				limit: 2,
				orderBy: [ascending(column(parent, "id"))],
				selection: {
					parentEntityId: selectedField(column(parent, "id"), Schema.String),
					seasonNumber: selectedField(
						castNumber(jsonPath(column(season, "properties"), "seasonNumber")),
						Schema.Number,
					),
				},
				joins: [
					join("inner", showSeason, eq(column(showSeason, "sourceEntityId"), column(parent, "id"))),
					join("inner", season, eq(column(showSeason, "targetEntityId"), column(season, "id"))),
					join(
						"inner",
						seasonEpisode,
						eq(column(seasonEpisode, "sourceEntityId"), column(season, "id")),
					),
					join(
						"inner",
						episode,
						eq(column(seasonEpisode, "targetEntityId"), column(episode, "id")),
					),
				],
				where: and(
					entitySchemaIs(parent, config.parentSchemaSlug),
					entitySchemaIs(season, "show-season"),
					entitySchemaIs(episode, config.episodeSchemaSlug),
					eq(column(episode, "id"), literal(input.episodeEntityId)),
					relationshipConnects(showSeason, parent, season, config.parentSeasonRelationshipSlug),
					relationshipConnects(
						seasonEpisode,
						season,
						episode,
						config.seasonEpisodeRelationshipSlug,
					),
				),
			}),
		},
	}))();
}

const signalSelection = (expressions: {
	readonly id: ScalarExpression;
	readonly entityId: ScalarExpression;
	readonly createdAt: ScalarExpression;
	readonly occurredAt: ScalarExpression;
	readonly eventSchemaSlug: ScalarExpression;
}) => ({
	id: selectedField(expressions.id, Schema.NullOr(Schema.String)),
	entityId: selectedField(expressions.entityId, Schema.NullOr(Schema.String)),
	createdAt: selectedField(expressions.createdAt, Schema.NullOr(Schema.String)),
	occurredAt: selectedField(expressions.occurredAt, Schema.NullOr(Schema.String)),
	eventSchemaSlug: selectedField(
		expressions.eventSchemaSlug,
		Schema.NullOr(AggregateLifecycleSignalSlugSchema),
	),
});

const signalFromNullableFields = (
	parentEntityId: string,
	fields: {
		readonly id: string | null;
		readonly entityId: string | null;
		readonly createdAt: string | null;
		readonly occurredAt: string | null;
		readonly eventSchemaSlug: AggregateLifecycleSignal["eventSchemaSlug"] | null;
	},
): AggregateLifecycleSignal | null => {
	if (
		fields.id === null ||
		fields.entityId === null ||
		fields.createdAt === null ||
		fields.occurredAt === null ||
		fields.eventSchemaSlug === null
	) {
		return null;
	}
	return {
		id: fields.id,
		entityId: fields.entityId,
		createdAt: fields.createdAt,
		occurredAt: fields.occurredAt,
		eventSchemaSlug: fields.eventSchemaSlug,
		kind: fields.entityId === parentEntityId ? "parent" : "episode",
	};
};

export const latestAggregateLifecycleSignalRecipe = defineRecipe(
	(input: { readonly config: EpisodicKindConfig; readonly parentEntityId: string }) => {
		const parent = table("entity", "lifecycleSignalParent");
		const expressions = latestAggregateSignalExpressions(input.config, parent, "lifecycleSignal");
		return {
			map: ({ parent: parentResult }) =>
				Result.succeed(
					parentResult ? signalFromNullableFields(input.parentEntityId, parentResult) : null,
				),
			queries: {
				parent: selectedOptionalRow(parent, {
					selection: signalSelection(expressions),
					orderBy: [ascending(column(parent, "id"))],
					where: and(
						entitySchemaIs(parent, input.config.parentSchemaSlug),
						eq(column(parent, "id"), literal(input.parentEntityId)),
					),
				}),
			},
		};
	},
);

export type LatestAggregateLifecycleSignalResult = Recipe.Success<
	typeof latestAggregateLifecycleSignalRecipe
>;

const eventOrderSelection = (expressions: EventOrderExpressions) => ({
	id: selectedField(expressions.id, Schema.NullOr(Schema.String)),
	createdAt: selectedField(expressions.createdAt, Schema.NullOr(Schema.String)),
	occurredAt: selectedField(expressions.occurredAt, Schema.NullOr(Schema.String)),
});

const eventOrderFromNullableFields = (fields: {
	readonly id: string | null;
	readonly createdAt: string | null;
	readonly occurredAt: string | null;
}): EventOrderTuple | null => {
	if (fields.id === null || fields.createdAt === null || fields.occurredAt === null) {
		return null;
	}
	return { id: fields.id, createdAt: fields.createdAt, occurredAt: fields.occurredAt };
};

export const latestParentCompletionBoundaryRecipe = defineRecipe(
	(input: { readonly config: EpisodicKindConfig; readonly parentEntityId: string }) => {
		const parent = table("entity", "completionBoundaryParent");
		const boundary = latestParentCompletionExpressions(parent, "completionBoundaryEvent");
		return {
			map: ({ parent: parentResult }) =>
				Result.succeed(parentResult ? eventOrderFromNullableFields(parentResult) : null),
			queries: {
				parent: selectedOptionalRow(parent, {
					selection: eventOrderSelection(boundary),
					orderBy: [ascending(column(parent, "id"))],
					where: and(
						entitySchemaIs(parent, input.config.parentSchemaSlug),
						eq(column(parent, "id"), literal(input.parentEntityId)),
					),
				}),
			},
		};
	},
);

export type LatestParentCompletionBoundaryResult = Recipe.Success<
	typeof latestParentCompletionBoundaryRecipe
>;

export const episodeCurrentLifecycleStateRecipe = defineRecipe(
	(input: {
		readonly parentEntityId: string;
		readonly episodeEntityId: string;
		readonly config: EpisodicKindConfig;
	}) => {
		const episode = table("entity", "currentEpisode");
		const parent = table("entity", "currentEpisodeParent");
		return {
			map: ({ episode: episodeResult }) => Result.succeed(episodeResult?.state ?? null),
			queries: {
				episode: selectedOptionalRow(episode, {
					orderBy: [ascending(column(episode, "id"))],
					joins: [join("inner", parent, eq(column(parent, "id"), literal(input.parentEntityId)))],
					selection: {
						state: selectedField(
							currentCycleEpisodeLifecycleStateExpression(episode, parent, "currentEpisodeState"),
							EpisodeLifecycleStateSchema,
						),
					},
					where: and(
						entitySchemaIs(episode, input.config.episodeSchemaSlug),
						entitySchemaIs(parent, input.config.parentSchemaSlug),
						eq(column(episode, "id"), literal(input.episodeEntityId)),
					),
				}),
			},
		};
	},
);

export type EpisodeCurrentLifecycleStateResult = Recipe.Success<
	typeof episodeCurrentLifecycleStateRecipe
>;

export const episodicCoverageRecipe = defineRecipe(
	(input: { readonly config: EpisodicKindConfig; readonly parentEntityId: string }) => {
		const parent = table("entity", "coverageParent");
		return {
			map: ({ parent: parentResult }) => Result.succeed(parentResult ?? null),
			queries: {
				parent: selectedOptionalRow(parent, {
					orderBy: [ascending(column(parent, "id"))],
					where: and(
						entitySchemaIs(parent, input.config.parentSchemaSlug),
						eq(column(parent, "id"), literal(input.parentEntityId)),
					),
					selection: {
						parentEntityId: selectedField(column(parent, "id"), Schema.String),
						coverageComplete: selectedField(
							conditional(
								episodicCoverageExpression(input.config, parent, "currentCoverage"),
								literal(true),
								literal(false),
							),
							Schema.Boolean,
						),
					},
				}),
			},
		};
	},
);

export type EpisodicCoverageResult = Recipe.Success<typeof episodicCoverageRecipe>;

export const requiredEpisodeIdsRecipe = defineRecipe(
	(input: {
		readonly parentEntityId: string;
		readonly after?: string | undefined;
		readonly limit?: number | undefined;
		readonly config: EpisodicKindConfig;
	}) => {
		const parent = table("entity", "requiredParent");
		const episode = table("entity", "requiredEpisode");
		const query = episodeRelationshipQuery(input.config, parent, episode, "required");
		return {
			map: ({ episodes }) =>
				Result.succeed({
					pageInfo: episodes.pageInfo,
					items: episodes.items.map(({ entityId }) => entityId),
				}),
			queries: {
				episodes: selectedRows(episode, {
					after: input.after,
					limit: input.limit ?? 100,
					orderBy: [ascending(column(episode, "id"))],
					selection: { entityId: selectedField(column(episode, "id"), Schema.String) },
					where: and(entitySchemaIs(parent, input.config.parentSchemaSlug), query.where),
					joins: [
						join("inner", parent, eq(column(parent, "id"), literal(input.parentEntityId))),
						...query.joins,
					],
				}),
			},
		};
	},
);

export type RequiredEpisodeIdsResult = Recipe.Success<typeof requiredEpisodeIdsRecipe>;

const fixedBoundaryPredicate = (event: TableReference, boundary: EventOrderTuple | null) =>
	boundary === null
		? eq(literal(true), literal(true))
		: eventIsAfter(event, {
				id: literal(boundary.id),
				createdAt: castDate(literal(boundary.createdAt)),
				occurredAt: castDate(literal(boundary.occurredAt)),
			});

export const currentCycleChildEventsRecipe = defineRecipe(
	(input: {
		readonly parentEntityId: string;
		readonly after?: string | undefined;
		readonly limit?: number | undefined;
		readonly config: EpisodicKindConfig;
		readonly boundary: EventOrderTuple | null;
	}) => {
		const event = table("event", "currentCycleEvent");
		const parent = table("entity", "currentCycleParent");
		const episode = table("entity", "currentCycleEpisode");
		const query = episodeRelationshipQuery(input.config, parent, episode, "currentCycle");
		return {
			map: ({ events }) => Result.succeed(events),
			queries: {
				events: selectedRows(event, {
					after: input.after,
					limit: input.limit ?? 100,
					orderBy: eventOrderAscending(event),
					joins: [
						join("inner", parent, eq(column(parent, "id"), literal(input.parentEntityId))),
						join("inner", episode, eq(column(event, "entityId"), column(episode, "id"))),
						...query.joins,
					],
					where: and(
						entitySchemaIs(parent, input.config.parentSchemaSlug),
						query.where,
						eq(column(event, "sessionEntityId"), column(parent, "id")),
						eventSlugIsOneOf(event, lifecycleEventSlugs),
						fixedBoundaryPredicate(event, input.boundary),
					),
					selection: {
						id: selectedField(column(event, "id"), Schema.String),
						entityId: selectedField(column(event, "entityId"), Schema.String),
						createdAt: selectedField(column(event, "createdAt"), Schema.String),
						occurredAt: selectedField(column(event, "occurredAt"), Schema.String),
						eventSchemaSlug: selectedField(
							column(event, "eventSchemaSlug"),
							Schema.Literals(["progress", "complete"]),
						),
						consumedOn: selectedField(
							castText(jsonPath(column(event, "properties"), "consumedOn")),
							Schema.NullOr(Schema.String),
						),
					},
				}),
			},
		};
	},
);

export type CurrentCycleChildEventsResult = Recipe.Success<typeof currentCycleChildEventsRecipe>;

export const replayCurrentCycleCoverage = (
	requiredEpisodeIds: readonly string[],
	events: readonly CurrentCycleChildEvent[],
): EpisodicCoverageReplay => {
	let coverageComplete = false;
	let agreedConsumedOn: string | null = null;
	const required = new Set(requiredEpisodeIds);
	let coverageClosingEvent: CoverageClosingEvent | null = null;
	const latestComplete = new Map<string, CurrentCycleChildEvent>();

	for (const event of events) {
		if (!required.has(event.entityId)) {
			continue;
		}
		if (event.eventSchemaSlug === "complete") {
			latestComplete.set(event.entityId, event);
		} else {
			latestComplete.delete(event.entityId);
		}

		const nextCoverageComplete =
			required.size > 0 && [...required].every((entityId) => latestComplete.has(entityId));
		if (!coverageComplete && nextCoverageComplete) {
			coverageClosingEvent = {
				id: event.id,
				createdAt: event.createdAt,
				occurredAt: event.occurredAt,
			};
			const consumedOnValues = [...required].map(
				(entityId) => latestComplete.get(entityId)?.consumedOn ?? null,
			);
			const firstConsumedOn = consumedOnValues[0] ?? null;
			agreedConsumedOn =
				firstConsumedOn !== null &&
				firstConsumedOn.length > 0 &&
				consumedOnValues.every((value) => value === firstConsumedOn)
					? firstConsumedOn
					: null;
		}
		coverageComplete = nextCoverageComplete;
	}

	return { agreedConsumedOn, coverageComplete, coverageClosingEvent };
};

export const episodicLifecycleSnapshotRecipe = defineRecipe(
	(input: {
		readonly parentEntityId: string;
		readonly config: EpisodicKindConfig;
		readonly requiredEpisodeIds: readonly string[];
		readonly childEvents: readonly CurrentCycleChildEvent[];
	}) => {
		const parent = table("entity", "lifecycleSnapshotParent");
		const expressions = episodicLifecycleExpressions(input.config, parent, "lifecycleSnapshot");
		return {
			map: ({ parent: parentResult }) => {
				if (!parentResult) {
					return Result.succeed(null);
				}
				const replay = replayCurrentCycleCoverage(input.requiredEpisodeIds, input.childEvents);
				const validReplay = parentResult.coverageStructureValid
					? replay
					: { agreedConsumedOn: null, coverageComplete: false, coverageClosingEvent: null };
				const boundaryCompleteEvent = eventOrderFromNullableFields({
					id: parentResult.boundaryId,
					createdAt: parentResult.boundaryCreatedAt,
					occurredAt: parentResult.boundaryOccurredAt,
				});
				return Result.succeed({
					...validReplay,
					boundaryCompleteEvent,
					state: parentResult.state,
					parentEntityId: parentResult.parentEntityId,
					coverageComplete: parentResult.coverageComplete,
					productionStatus: parentResult.productionStatus,
					requiredEpisodeIds: [...input.requiredEpisodeIds],
					boundaryCompleteEventId: boundaryCompleteEvent?.id ?? null,
					latestSignal: signalFromNullableFields(input.parentEntityId, parentResult),
				});
			},
			queries: {
				parent: selectedOptionalRow(parent, {
					orderBy: [ascending(column(parent, "id"))],
					where: and(
						entitySchemaIs(parent, input.config.parentSchemaSlug),
						eq(column(parent, "id"), literal(input.parentEntityId)),
					),
					selection: {
						...signalSelection(expressions.latestSignal),
						parentEntityId: selectedField(column(parent, "id"), Schema.String),
						state: selectedField(expressions.state, EpisodicLifecycleStateSchema),
						boundaryId: selectedField(
							expressions.boundaryCompleteEvent.id,
							Schema.NullOr(Schema.String),
						),
						boundaryCreatedAt: selectedField(
							expressions.boundaryCompleteEvent.createdAt,
							Schema.NullOr(Schema.String),
						),
						boundaryOccurredAt: selectedField(
							expressions.boundaryCompleteEvent.occurredAt,
							Schema.NullOr(Schema.String),
						),
						coverageComplete: selectedField(
							conditional(expressions.coverageComplete, literal(true), literal(false)),
							Schema.Boolean,
						),
						productionStatus: selectedField(
							castText(jsonPath(column(parent, "properties"), "productionStatus")),
							Schema.NullOr(Schema.String),
						),
						coverageStructureValid: selectedField(
							conditional(expressions.coverageStructureValid, literal(true), literal(false)),
							Schema.Boolean,
						),
					},
				}),
			},
		};
	},
);

export type EpisodicLifecycleSnapshotResult = Recipe.Success<
	typeof episodicLifecycleSnapshotRecipe
>;

const nextPageCursor = (pageInfo: {
	readonly hasMore: boolean;
	readonly nextCursor: string | null;
}) => {
	if (!pageInfo.hasMore) {
		return null;
	}
	if (pageInfo.nextCursor === null) {
		throw new Error("RyotQL page reports more lifecycle rows without a next cursor");
	}
	return pageInfo.nextCursor;
};

export const readEpisodicLifecycleSnapshot = <Error, Requirements>(
	input: {
		readonly parentEntityId: string;
		readonly config: EpisodicKindConfig;
		readonly pageSize?: number | undefined;
	},
	executeRyotql: (document: RyotQLDocument) => Effect.Effect<unknown, Error, Requirements>,
) =>
	Effect.gen(function* () {
		const boundary = yield* executeRyotqlRecipe(
			executeRyotql,
			latestParentCompletionBoundaryRecipe(input),
		);
		const requiredEpisodeIds: string[] = [];
		let requiredAfter: string | undefined;
		do {
			const page = yield* executeRyotqlRecipe(
				executeRyotql,
				requiredEpisodeIdsRecipe({ ...input, after: requiredAfter, limit: input.pageSize }),
			);
			requiredEpisodeIds.push(...page.items);
			requiredAfter = nextPageCursor(page.pageInfo) ?? undefined;
		} while (requiredAfter !== undefined);

		const childEvents: CurrentCycleChildEvent[] = [];
		let eventAfter: string | undefined;
		do {
			const page = yield* executeRyotqlRecipe(
				executeRyotql,
				currentCycleChildEventsRecipe({
					...input,
					boundary,
					after: eventAfter,
					limit: input.pageSize,
				}),
			);
			childEvents.push(...page.items);
			eventAfter = nextPageCursor(page.pageInfo) ?? undefined;
		} while (eventAfter !== undefined);

		return yield* executeRyotqlRecipe(
			executeRyotql,
			episodicLifecycleSnapshotRecipe({ ...input, childEvents, requiredEpisodeIds }),
		);
	});
