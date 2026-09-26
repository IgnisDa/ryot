import type { Effect } from "@ryot-app/sandbox-sdk/effect";
import { Result, Schema } from "@ryot-app/sandbox-sdk/effect";
import {
	and,
	ascending,
	castNumber,
	castText,
	column,
	conditional,
	count,
	countDistinct,
	defineRecipe,
	descending,
	eq,
	executeRyotqlRecipe,
	first,
	isNotNull,
	join,
	jsonPath,
	literal,
	neq,
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
	EpisodicLifecycleStateSchema,
	episodicEpisodeQuery,
	episodicLifecycleExpressions,
	latestParentCompletionExpressions,
	orderExpressionsAreAfter,
	relationshipConnects,
	type EpisodicKindConfig,
	type EventOrderExpressions,
	type Predicate,
	type podcastEpisodicKindConfig,
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

export const CoverageClosingEventSchema = EventOrderTupleSchema;

export type CoverageClosingEvent = Schema.Schema.Type<typeof CoverageClosingEventSchema>;

export const EpisodicLifecycleSnapshotSchema = Schema.Struct({
	parentEntityId: Schema.String,
	coverageComplete: Schema.Boolean,
	state: EpisodicLifecycleStateSchema,
	agreedConsumedOn: Schema.NullOr(Schema.String),
	productionStatus: Schema.NullOr(Schema.String),
	boundaryCompleteEventId: Schema.NullOr(Schema.String),
	latestSignal: Schema.NullOr(AggregateLifecycleSignalSchema),
	boundaryCompleteEvent: Schema.NullOr(EventOrderTupleSchema),
	coverageClosingEvent: Schema.NullOr(CoverageClosingEventSchema),
});

export type EpisodicLifecycleSnapshot = Schema.Schema.Type<typeof EpisodicLifecycleSnapshotSchema>;

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

const eventOrderExpressions = (event: TableReference): EventOrderExpressions => ({
	id: column(event, "id"),
	createdAt: column(event, "createdAt"),
	occurredAt: column(event, "occurredAt"),
});

const eventOrderAscending = (event: TableReference) =>
	[
		ascending(column(event, "occurredAt")),
		ascending(column(event, "createdAt")),
		ascending(column(event, "id")),
	] as const;

const eventOrderDescendingExpressions = (event: EventOrderExpressions) =>
	[descending(event.occurredAt), descending(event.createdAt), descending(event.id)] as const;

const currentCoverageCompletionExpressions = (
	episode: TableReference,
	parent: TableReference,
	alias: string,
) => {
	const boundary = latestParentCompletionExpressions(parent, `${alias}Boundary`);
	const progress = table("event", `${alias}Progress`);
	const progressOrder = eventOrderExpressions(progress);
	const progressWhere = and(
		eq(column(progress, "entityId"), column(episode, "id")),
		eq(column(progress, "sessionEntityId"), column(parent, "id")),
		eq(column(progress, "eventSchemaSlug"), literal("progress")),
	);
	const latestProgress = {
		id: first(progress, {
			where: progressWhere,
			select: column(progress, "id"),
			orderBy: eventOrderDescendingExpressions(progressOrder),
		}),
		createdAt: first(progress, {
			where: progressWhere,
			select: column(progress, "createdAt"),
			orderBy: eventOrderDescendingExpressions(progressOrder),
		}),
		occurredAt: first(progress, {
			where: progressWhere,
			select: column(progress, "occurredAt"),
			orderBy: eventOrderDescendingExpressions(progressOrder),
		}),
	};
	const completion = table("event", `${alias}Completion`);
	const completionOrder = eventOrderExpressions(completion);
	const completionWhere = and(
		eq(column(completion, "entityId"), column(episode, "id")),
		eq(column(completion, "sessionEntityId"), column(parent, "id")),
		eq(column(completion, "eventSchemaSlug"), literal("complete")),
		orderExpressionsAreAfter(completionOrder, boundary),
		orderExpressionsAreAfter(completionOrder, latestProgress),
	);
	const completionField = (field: string) =>
		first(completion, {
			where: completionWhere,
			select: column(completion, field),
			orderBy: eventOrderAscending(completion),
		});

	return {
		id: completionField("id"),
		createdAt: completionField("createdAt"),
		occurredAt: completionField("occurredAt"),
		consumedOn: first(completion, {
			where: completionWhere,
			orderBy: eventOrderAscending(completion),
			select: castText(jsonPath(column(completion, "properties"), "consumedOn")),
		}),
	};
};

const aggregateCoverageCompletionExpressions = (
	config: EpisodicKindConfig,
	parent: TableReference,
	coverageComplete: Predicate,
	alias: string,
) => {
	const episode = table("entity", `${alias}Episode`);
	const episodeQuery = episodicEpisodeQuery(config, parent, episode, alias);
	const completion = currentCoverageCompletionExpressions(episode, parent, `${alias}Episode`);
	const completedEpisode = and(episodeQuery.where, isNotNull(completion.id));
	const closingField = (field: ScalarExpression) =>
		first(episode, {
			select: field,
			where: completedEpisode,
			joins: episodeQuery.joins,
			orderBy: eventOrderDescendingExpressions(completion),
		});
	const requiredCount = count(episode, { joins: episodeQuery.joins, where: episodeQuery.where });
	const nonemptyConsumedOn = and(
		completedEpisode,
		isNotNull(completion.consumedOn),
		neq(completion.consumedOn, literal("")),
	);
	const matchingConsumedOnCount = count(episode, {
		joins: episodeQuery.joins,
		where: nonemptyConsumedOn,
	});
	const distinctConsumedOnCount = countDistinct(episode, completion.consumedOn, {
		joins: episodeQuery.joins,
		where: nonemptyConsumedOn,
	});
	const agreedConsumedOn = first(episode, {
		joins: episodeQuery.joins,
		where: nonemptyConsumedOn,
		select: completion.consumedOn,
		orderBy: [ascending(column(episode, "id"))],
	});
	return {
		agreedConsumedOn: conditional(
			and(
				coverageComplete,
				eq(matchingConsumedOnCount, requiredCount),
				eq(distinctConsumedOnCount, literal(1)),
			),
			agreedConsumedOn,
			literal(null),
		),
		closingEvent: {
			id: conditional(coverageComplete, closingField(completion.id), literal(null)),
			createdAt: conditional(coverageComplete, closingField(completion.createdAt), literal(null)),
			occurredAt: conditional(coverageComplete, closingField(completion.occurredAt), literal(null)),
		},
	};
};

export const episodicLifecycleSnapshotRecipe = defineRecipe(
	(input: { readonly parentEntityId: string; readonly config: EpisodicKindConfig }) => {
		const parent = table("entity", "lifecycleSnapshotParent");
		const expressions = episodicLifecycleExpressions(input.config, parent, "lifecycleSnapshot");
		const completion = aggregateCoverageCompletionExpressions(
			input.config,
			parent,
			expressions.coverageComplete,
			"lifecycleSnapshotCompletion",
		);
		return {
			map: ({ parent: parentResult }) => {
				if (!parentResult) {
					return Result.succeed(null);
				}
				const boundaryCompleteEvent = eventOrderFromNullableFields({
					id: parentResult.boundaryId,
					createdAt: parentResult.boundaryCreatedAt,
					occurredAt: parentResult.boundaryOccurredAt,
				});
				const coverageClosingEvent = eventOrderFromNullableFields({
					id: parentResult.closingId,
					createdAt: parentResult.closingCreatedAt,
					occurredAt: parentResult.closingOccurredAt,
				});
				return Result.succeed({
					coverageClosingEvent,
					boundaryCompleteEvent,
					state: parentResult.state,
					parentEntityId: parentResult.parentEntityId,
					agreedConsumedOn: parentResult.agreedConsumedOn,
					coverageComplete: parentResult.coverageComplete,
					productionStatus: parentResult.productionStatus,
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
						closingId: selectedField(completion.closingEvent.id, Schema.NullOr(Schema.String)),
						agreedConsumedOn: selectedField(
							completion.agreedConsumedOn,
							Schema.NullOr(Schema.String),
						),
						boundaryId: selectedField(
							expressions.boundaryCompleteEvent.id,
							Schema.NullOr(Schema.String),
						),
						closingCreatedAt: selectedField(
							completion.closingEvent.createdAt,
							Schema.NullOr(Schema.String),
						),
						closingOccurredAt: selectedField(
							completion.closingEvent.occurredAt,
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

export const readEpisodicLifecycleSnapshot = <Error, Requirements>(
	input: { readonly parentEntityId: string; readonly config: EpisodicKindConfig },
	executeRyotql: (document: RyotQLDocument) => Effect.Effect<unknown, Error, Requirements>,
) => executeRyotqlRecipe(executeRyotql, episodicLifecycleSnapshotRecipe(input));
