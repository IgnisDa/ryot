import { Effect, Result, Schema } from "@ryot/sandbox-sdk/effect";
import {
	and,
	ascending,
	castDate,
	castNumber,
	castText,
	column,
	conditional,
	count,
	defineRecipe,
	eq,
	eventIsAfter,
	eventOrderDescending,
	executeRyotqlRecipe,
	gt,
	inArray,
	isNull,
	join,
	jsonPath,
	latestEventField,
	literal,
	or,
	selectedField,
	selectedOptionalRow,
	selectedRows,
	table,
	type PreparedRecipe,
	type Recipe,
	type RyotQLDocument,
} from "@ryot/sandbox-sdk/ryotql";

type Predicate = Parameters<typeof conditional>[0];
type ScalarExpression = Parameters<typeof ascending>[0];
type TableReference = Parameters<typeof column>[0];

export const EpisodicLifecycleStateSchema = Schema.Literals([
	"untracked",
	"backlog",
	"in_progress",
	"on_hold",
	"dropped",
	"caught_up",
	"complete",
]);

export type EpisodicLifecycleState = Schema.Schema.Type<typeof EpisodicLifecycleStateSchema>;

export const EpisodeLifecycleStateSchema = Schema.Literals([
	"untracked",
	"in_progress",
	"complete",
]);

export type EpisodeLifecycleState = Schema.Schema.Type<typeof EpisodeLifecycleStateSchema>;

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
		parentEntityId: Schema.String,
		kind: Schema.Literal("show"),
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
	eventSchemaSlug: AggregateLifecycleSignalSlugSchema,
	kind: Schema.Literals(["parent", "episode"]),
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

export type EpisodicKindConfig =
	| {
			readonly kind: "show";
			readonly parentSchemaSlug: "show";
			readonly episodeSchemaSlug: "show-episode";
			readonly parentSeasonRelationshipSlug: "show-to-show-season";
			readonly seasonEpisodeRelationshipSlug: "show-season-to-show-episode";
	  }
	| {
			readonly kind: "podcast";
			readonly parentSchemaSlug: "podcast";
			readonly episodeSchemaSlug: "podcast-episode";
			readonly parentEpisodeRelationshipSlug: "podcast-to-podcast-episode";
	  };

export const showEpisodicKindConfig = {
	kind: "show",
	parentSchemaSlug: "show",
	episodeSchemaSlug: "show-episode",
	parentSeasonRelationshipSlug: "show-to-show-season",
	seasonEpisodeRelationshipSlug: "show-season-to-show-episode",
} as const satisfies EpisodicKindConfig;

export const podcastEpisodicKindConfig = {
	kind: "podcast",
	parentSchemaSlug: "podcast",
	episodeSchemaSlug: "podcast-episode",
	parentEpisodeRelationshipSlug: "podcast-to-podcast-episode",
} as const satisfies EpisodicKindConfig;

type EventOrderExpressions = {
	readonly id: ScalarExpression;
	readonly createdAt: ScalarExpression;
	readonly occurredAt: ScalarExpression;
};

type AggregateLifecycleExpressions = {
	readonly state: ScalarExpression;
	readonly coverageComplete: Predicate;
	readonly coverageStructureValid: Predicate;
	readonly boundaryCompleteEvent: EventOrderExpressions;
	readonly latestSignal: EventOrderExpressions & {
		readonly entityId: ScalarExpression;
		readonly eventSchemaSlug: ScalarExpression;
	};
};

const lifecycleEventSlugs = ["progress", "complete"] as const;
const parentLifecycleEventSlugs = ["backlog", "complete", "dropped", "on_hold"] as const;

const eventOrderAscending = (event: TableReference) =>
	eventOrderDescending(event).map(({ expr }) => ascending(expr));

const entitySchemaIs = (entity: TableReference, slug: string) =>
	eq(column(entity, "entitySchemaSlug"), literal(slug));

const relationshipConnects = (
	relationship: TableReference,
	parent: TableReference,
	child: TableReference,
	slug: string,
) =>
	and(
		eq(column(relationship, "sourceEntityId"), column(parent, "id")),
		eq(column(relationship, "targetEntityId"), column(child, "id")),
		eq(column(relationship, "relationshipSchemaSlug"), literal(slug)),
	);

const eventSlugIsOneOf = (event: TableReference, slugs: readonly string[]) =>
	inArray(
		column(event, "eventSchemaSlug"),
		slugs.map((slug) => literal(slug)),
	);

const latestField = (
	event: TableReference,
	field: string,
	where: Predicate,
	joins?: readonly ReturnType<typeof join>[],
) =>
	latestEventField(event, {
		where,
		select: column(event, field),
		...(joins ? { joins } : {}),
	});

const latestEventOrderExpressions = (where: Predicate, alias: string): EventOrderExpressions => {
	const event = table("event", alias);
	return {
		id: latestField(event, "id", where),
		createdAt: latestField(event, "createdAt", where),
		occurredAt: latestField(event, "occurredAt", where),
	};
};

const latestParentCompletionExpressions = (
	parent: TableReference,
	alias: string,
): EventOrderExpressions => {
	const event = table("event", alias);
	const where = and(
		eq(column(event, "entityId"), column(parent, "id")),
		eq(column(event, "sessionEntityId"), column(parent, "id")),
		eq(column(event, "eventSchemaSlug"), literal("complete")),
	);
	return latestEventOrderExpressions(where, alias);
};

const orderExpressionsAreAfter = (
	current: EventOrderExpressions,
	boundary: EventOrderExpressions,
) =>
	or(
		isNull(boundary.id),
		gt(current.occurredAt, boundary.occurredAt),
		and(eq(current.occurredAt, boundary.occurredAt), gt(current.createdAt, boundary.createdAt)),
		and(
			eq(current.occurredAt, boundary.occurredAt),
			eq(current.createdAt, boundary.createdAt),
			gt(current.id, boundary.id),
		),
	);

const latestEpisodeLifecycleExpressions = (
	episode: TableReference,
	parent: TableReference,
	alias: string,
) => {
	const event = table("event", alias);
	const where = and(
		eq(column(event, "entityId"), column(episode, "id")),
		eq(column(event, "sessionEntityId"), column(parent, "id")),
		eventSlugIsOneOf(event, lifecycleEventSlugs),
	);
	return {
		...latestEventOrderExpressions(where, alias),
		eventSchemaSlug: latestField(event, "eventSchemaSlug", where),
	};
};

const latestEpisodeEventExpressions = (episode: TableReference, alias: string) => {
	const event = table("event", alias);
	const where = and(
		eq(column(event, "entityId"), column(episode, "id")),
		eventSlugIsOneOf(event, lifecycleEventSlugs),
	);
	return {
		...latestEventOrderExpressions(where, alias),
		eventSchemaSlug: latestField(event, "eventSchemaSlug", where),
	};
};

const episodeIsCovered = (episode: TableReference, parent: TableReference, alias: string) => {
	const latest = latestEpisodeLifecycleExpressions(episode, parent, `${alias}Lifecycle`);
	const boundary = latestParentCompletionExpressions(parent, `${alias}Boundary`);
	return and(
		eq(latest.eventSchemaSlug, literal("complete")),
		orderExpressionsAreAfter(latest, boundary),
	);
};

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

const episodicCoverageExpressions = (
	config: EpisodicKindConfig,
	parent: TableReference,
	alias = "episodicCoverage",
) => {
	if (config.kind === "podcast") {
		const episode = table("entity", `${alias}Episode`);
		const relationship = table("relationship", `${alias}Relationship`);
		const joins = [
			join(
				"inner",
				relationship,
				eq(column(relationship, "targetEntityId"), column(episode, "id")),
			),
		];
		const where = and(
			entitySchemaIs(episode, config.episodeSchemaSlug),
			relationshipConnects(relationship, parent, episode, config.parentEpisodeRelationshipSlug),
		);
		const required = count(episode, { joins, where });
		const covered = count(episode, {
			joins,
			where: and(where, episodeIsCovered(episode, parent, `${alias}Episode`)),
		});
		const coverageStructureValid = gt(required, literal(0));
		return {
			coverageStructureValid,
			coverageComplete: and(coverageStructureValid, eq(covered, required)),
		};
	}

	const season = table("entity", `${alias}Season`);
	const showSeason = table("relationship", `${alias}ShowSeason`);
	const seasonJoins = [
		join("inner", showSeason, eq(column(showSeason, "targetEntityId"), column(season, "id"))),
	];
	const regularSeason = and(
		entitySchemaIs(season, "show-season"),
		gt(castNumber(jsonPath(column(season, "properties"), "seasonNumber")), literal(0)),
		relationshipConnects(showSeason, parent, season, config.parentSeasonRelationshipSlug),
	);
	const regularSeasonCount = count(season, { joins: seasonJoins, where: regularSeason });
	const episode = table("entity", `${alias}Episode`);
	const seasonEpisode = table("relationship", `${alias}SeasonEpisode`);
	const episodeJoins = [
		join(
			"inner",
			seasonEpisode,
			eq(column(seasonEpisode, "targetEntityId"), column(episode, "id")),
		),
	];
	const requiredEpisode = and(
		entitySchemaIs(episode, config.episodeSchemaSlug),
		relationshipConnects(seasonEpisode, season, episode, config.seasonEpisodeRelationshipSlug),
	);
	const requiredEpisodeCount = count(episode, {
		joins: episodeJoins,
		where: requiredEpisode,
	});
	const coveredEpisodeCount = count(episode, {
		joins: episodeJoins,
		where: and(requiredEpisode, episodeIsCovered(episode, parent, `${alias}Episode`)),
	});
	const nonemptySeasonCount = count(season, {
		joins: seasonJoins,
		where: and(regularSeason, gt(requiredEpisodeCount, literal(0))),
	});
	const validSeasonCount = count(season, {
		joins: seasonJoins,
		where: and(
			regularSeason,
			gt(requiredEpisodeCount, literal(0)),
			eq(coveredEpisodeCount, requiredEpisodeCount),
		),
	});
	const coverageStructureValid = and(
		gt(regularSeasonCount, literal(0)),
		eq(nonemptySeasonCount, regularSeasonCount),
	);
	return {
		coverageStructureValid,
		coverageComplete: and(coverageStructureValid, eq(validSeasonCount, regularSeasonCount)),
	};
};

export const episodicCoverageExpression = (
	config: EpisodicKindConfig,
	parent: TableReference,
	alias = "episodicCoverage",
) => episodicCoverageExpressions(config, parent, alias).coverageComplete;

const latestAggregateSignalExpressions = (
	config: EpisodicKindConfig,
	parent: TableReference,
	alias: string,
) => {
	const event = table("event", `${alias}Event`);
	const entity = table("entity", `${alias}Entity`);
	const joins = [join("inner", entity, eq(column(event, "entityId"), column(entity, "id")))];
	const where = and(
		eq(column(event, "sessionEntityId"), column(parent, "id")),
		or(
			and(
				eq(column(entity, "id"), column(parent, "id")),
				entitySchemaIs(entity, config.parentSchemaSlug),
				eventSlugIsOneOf(event, parentLifecycleEventSlugs),
			),
			and(
				entitySchemaIs(entity, config.episodeSchemaSlug),
				eventSlugIsOneOf(event, lifecycleEventSlugs),
			),
		),
	);
	return {
		id: latestField(event, "id", where, joins),
		entityId: latestField(event, "entityId", where, joins),
		createdAt: latestField(event, "createdAt", where, joins),
		occurredAt: latestField(event, "occurredAt", where, joins),
		eventSchemaSlug: latestField(event, "eventSchemaSlug", where, joins),
	};
};

export const episodicLifecycleExpressions = (
	config: EpisodicKindConfig,
	parent: TableReference,
	alias = "episodicLifecycle",
): AggregateLifecycleExpressions => {
	const latestSignal = latestAggregateSignalExpressions(config, parent, `${alias}Signal`);
	const { coverageComplete, coverageStructureValid } = episodicCoverageExpressions(
		config,
		parent,
		`${alias}Coverage`,
	);
	const boundaryCompleteEvent = latestParentCompletionExpressions(parent, `${alias}Boundary`);
	const parentState = conditional(
		eq(latestSignal.eventSchemaSlug, literal("backlog")),
		literal("backlog"),
		conditional(
			eq(latestSignal.eventSchemaSlug, literal("on_hold")),
			literal("on_hold"),
			conditional(
				eq(latestSignal.eventSchemaSlug, literal("dropped")),
				literal("dropped"),
				literal("complete"),
			),
		),
	);
	const state = conditional(
		isNull(latestSignal.id),
		literal("untracked"),
		conditional(
			eq(latestSignal.entityId, column(parent, "id")),
			parentState,
			conditional(coverageComplete, literal("caught_up"), literal("in_progress")),
		),
	);
	return {
		state,
		latestSignal,
		coverageComplete,
		boundaryCompleteEvent,
		coverageStructureValid,
	};
};

const episodeStateFromLatest = (latestEventSchemaSlug: ScalarExpression) =>
	conditional(
		eq(latestEventSchemaSlug, literal("complete")),
		literal("complete"),
		conditional(
			eq(latestEventSchemaSlug, literal("progress")),
			literal("in_progress"),
			literal("untracked"),
		),
	);

export const episodeLifecycleStateExpression = (
	episode: TableReference,
	alias = "episodeLifecycle",
) =>
	episodeStateFromLatest(latestEpisodeEventExpressions(episode, `${alias}Event`).eventSchemaSlug);

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
			queries: {
				parents: selectedRows(parent, {
					limit: 2,
					orderBy: [ascending(column(parent, "id"))],
					selection: {
						parentEntityId: selectedField(column(parent, "id"), Schema.String),
					},
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
			map: ({ parents }) => {
				const match = parents.items.length === 1 ? parents.items[0] : undefined;
				return Result.succeed(match ? { ...match, kind: "podcast" as const } : null);
			},
		}))();
	}

	const config = input.config;
	const season = table("entity", "resolvedSeason");
	const showSeason = table("relationship", "resolvedShowSeason");
	const seasonEpisode = table("relationship", "resolvedSeasonEpisode");
	return defineRecipe(() => ({
		queries: {
			parents: selectedRows(parent, {
				limit: 2,
				orderBy: [ascending(column(parent, "id"))],
				selection: {
					seasonNumber: selectedField(
						castNumber(jsonPath(column(season, "properties"), "seasonNumber")),
						Schema.Number,
					),
					parentEntityId: selectedField(column(parent, "id"), Schema.String),
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
		map: ({ parents }) => {
			const match = parents.items.length === 1 ? parents.items[0] : undefined;
			return Result.succeed(match ? { ...match, kind: "show" as const } : null);
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
			map: ({ parent: parentResult }) =>
				Result.succeed(
					parentResult ? signalFromNullableFields(input.parentEntityId, parentResult) : null,
				),
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
			map: ({ parent: parentResult }) =>
				Result.succeed(parentResult ? eventOrderFromNullableFields(parentResult) : null),
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
			queries: {
				episode: selectedOptionalRow(episode, {
					selection: {
						state: selectedField(
							currentCycleEpisodeLifecycleStateExpression(episode, parent, "currentEpisodeState"),
							EpisodeLifecycleStateSchema,
						),
					},
					orderBy: [ascending(column(episode, "id"))],
					joins: [join("inner", parent, eq(column(parent, "id"), literal(input.parentEntityId)))],
					where: and(
						entitySchemaIs(episode, input.config.episodeSchemaSlug),
						entitySchemaIs(parent, input.config.parentSchemaSlug),
						eq(column(episode, "id"), literal(input.episodeEntityId)),
					),
				}),
			},
			map: ({ episode: episodeResult }) => Result.succeed(episodeResult?.state ?? null),
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
			queries: {
				parent: selectedOptionalRow(parent, {
					selection: {
						coverageComplete: selectedField(
							conditional(
								episodicCoverageExpression(input.config, parent, "currentCoverage"),
								literal(true),
								literal(false),
							),
							Schema.Boolean,
						),
						parentEntityId: selectedField(column(parent, "id"), Schema.String),
					},
					orderBy: [ascending(column(parent, "id"))],
					where: and(
						entitySchemaIs(parent, input.config.parentSchemaSlug),
						eq(column(parent, "id"), literal(input.parentEntityId)),
					),
				}),
			},
			map: ({ parent: parentResult }) => Result.succeed(parentResult ?? null),
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
			queries: {
				episodes: selectedRows(episode, {
					after: input.after,
					limit: input.limit ?? 100,
					joins: [
						join("inner", parent, eq(column(parent, "id"), literal(input.parentEntityId))),
						...query.joins,
					],
					orderBy: [ascending(column(episode, "id"))],
					selection: { entityId: selectedField(column(episode, "id"), Schema.String) },
					where: and(entitySchemaIs(parent, input.config.parentSchemaSlug), query.where),
				}),
			},
			map: ({ episodes }) =>
				Result.succeed({
					pageInfo: episodes.pageInfo,
					items: episodes.items.map(({ entityId }) => entityId),
				}),
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
			queries: {
				events: selectedRows(event, {
					after: input.after,
					limit: input.limit ?? 100,
					joins: [
						join("inner", parent, eq(column(parent, "id"), literal(input.parentEntityId))),
						join("inner", episode, eq(column(event, "entityId"), column(episode, "id"))),
						...query.joins,
					],
					orderBy: eventOrderAscending(event),
					selection: {
						id: selectedField(column(event, "id"), Schema.String),
						entityId: selectedField(column(event, "entityId"), Schema.String),
						createdAt: selectedField(column(event, "createdAt"), Schema.String),
						consumedOn: selectedField(
							castText(jsonPath(column(event, "properties"), "consumedOn")),
							Schema.NullOr(Schema.String),
						),
						occurredAt: selectedField(column(event, "occurredAt"), Schema.String),
						eventSchemaSlug: selectedField(
							column(event, "eventSchemaSlug"),
							Schema.Literals(["progress", "complete"]),
						),
					},
					where: and(
						entitySchemaIs(parent, input.config.parentSchemaSlug),
						query.where,
						eq(column(event, "sessionEntityId"), column(parent, "id")),
						eventSlugIsOneOf(event, lifecycleEventSlugs),
						fixedBoundaryPredicate(event, input.boundary),
					),
				}),
			},
			map: ({ events }) => Result.succeed(events),
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
			queries: {
				parent: selectedOptionalRow(parent, {
					selection: {
						...signalSelection(expressions.latestSignal),
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
						state: selectedField(expressions.state, EpisodicLifecycleStateSchema),
						coverageComplete: selectedField(
							conditional(expressions.coverageComplete, literal(true), literal(false)),
							Schema.Boolean,
						),
						coverageStructureValid: selectedField(
							conditional(expressions.coverageStructureValid, literal(true), literal(false)),
							Schema.Boolean,
						),
						parentEntityId: selectedField(column(parent, "id"), Schema.String),
						productionStatus: selectedField(
							castText(jsonPath(column(parent, "properties"), "productionStatus")),
							Schema.NullOr(Schema.String),
						),
					},
					orderBy: [ascending(column(parent, "id"))],
					where: and(
						entitySchemaIs(parent, input.config.parentSchemaSlug),
						eq(column(parent, "id"), literal(input.parentEntityId)),
					),
				}),
			},
			map: ({ parent: parentResult }) => {
				if (!parentResult) {
					return Result.succeed(null);
				}
				const replay = replayCurrentCycleCoverage(input.requiredEpisodeIds, input.childEvents);
				const validReplay = parentResult.coverageStructureValid
					? replay
					: {
							agreedConsumedOn: null,
							coverageComplete: false,
							coverageClosingEvent: null,
						};
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
