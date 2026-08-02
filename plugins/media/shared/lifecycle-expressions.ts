import { Schema } from "@ryot-app/plugin-kit/effect";
import type { ascending } from "@ryot-app/plugin-kit/ryotql";
import {
	and,
	castNumber,
	column,
	conditional,
	count,
	eq,
	gt,
	inArray,
	isNull,
	join,
	jsonPath,
	latestEventField,
	literal,
	or,
	table,
} from "@ryot-app/plugin-kit/ryotql";

export type Predicate = Parameters<typeof conditional>[0];
export type ScalarExpression = Parameters<typeof ascending>[0];
export type TableReference = Parameters<typeof column>[0];

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

export type EventOrderExpressions = {
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

export const lifecycleEventSlugs = ["progress", "complete"] as const;
const parentLifecycleEventSlugs = ["backlog", "complete", "dropped", "on_hold"] as const;

export const entitySchemaIs = (entity: TableReference, slug: string) =>
	eq(column(entity, "entitySchemaSlug"), literal(slug));

export const relationshipConnects = (
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

export const eventSlugIsOneOf = (event: TableReference, slugs: readonly string[]) =>
	inArray(
		column(event, "eventSchemaSlug"),
		slugs.map((slug) => literal(slug)),
	);

const latestField = (
	event: TableReference,
	field: string,
	where: Predicate,
	joins?: readonly ReturnType<typeof join>[],
) => latestEventField(event, { where, select: column(event, field), ...(joins ? { joins } : {}) });

const latestEventOrderExpressions = (where: Predicate, alias: string): EventOrderExpressions => {
	const event = table("event", alias);
	return {
		id: latestField(event, "id", where),
		createdAt: latestField(event, "createdAt", where),
		occurredAt: latestField(event, "occurredAt", where),
	};
};

export const latestParentCompletionExpressions = (
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

export const orderExpressionsAreAfter = (
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

export const latestEpisodeLifecycleExpressions = (
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

export const episodicCoverageExpressions = (
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
	const requiredEpisodeCount = count(episode, { joins: episodeJoins, where: requiredEpisode });
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

export const latestAggregateSignalExpressions = (
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
	return { state, latestSignal, coverageComplete, boundaryCompleteEvent, coverageStructureValid };
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
