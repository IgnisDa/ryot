import { Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	castDate,
	castNumber,
	column,
	conditional,
	count,
	currentDate,
	descending,
	eq,
	first,
	gt,
	inArray,
	isNotNull,
	isNull,
	join,
	jsonPath,
	latestEventField,
	literal,
	lte,
	neq,
	or,
	selectedInclude,
	table,
	type SelectedSelection,
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

export const MediaLifecycleStateSchema = Schema.Literals([
	"untracked",
	"backlog",
	"in_progress",
	"on_hold",
	"dropped",
	"complete",
]);

export type MediaLifecycleState = Schema.Schema.Type<typeof MediaLifecycleStateSchema>;

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

export const podcastEpisodicKindConfig = {
	kind: "podcast",
	parentSchemaSlug: "podcast",
	episodeSchemaSlug: "podcast-episode",
	parentEpisodeRelationshipSlug: "podcast-to-podcast-episode",
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
const mediaLifecycleSignalSlugs = [
	"backlog",
	"progress",
	"complete",
	"dropped",
	"on_hold",
] as const;

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

export const latestEntityCompletionExpressions = (
	entity: TableReference,
	alias: string,
): EventOrderExpressions => {
	const event = table("event", alias);
	const where = and(
		eq(column(event, "entityId"), column(entity, "id")),
		eq(column(event, "eventSchemaSlug"), literal("complete")),
	);
	return latestEventOrderExpressions(where, alias);
};

const mediaStateFromLatestSignal = (eventSchemaSlug: ScalarExpression) =>
	conditional(
		eq(eventSchemaSlug, literal("backlog")),
		literal("backlog"),
		conditional(
			eq(eventSchemaSlug, literal("on_hold")),
			literal("on_hold"),
			conditional(
				eq(eventSchemaSlug, literal("dropped")),
				literal("dropped"),
				conditional(
					eq(eventSchemaSlug, literal("complete")),
					literal("complete"),
					literal("in_progress"),
				),
			),
		),
	);

export const mediaLifecycleExpressions = (entity: TableReference, alias = "mediaLifecycle") => {
	const signalAlias = `${alias}Signal`;
	const signalEvent = table("event", signalAlias);
	const signalWhere = and(
		eq(column(signalEvent, "entityId"), column(entity, "id")),
		eventSlugIsOneOf(signalEvent, mediaLifecycleSignalSlugs),
	);
	const latestSignal = {
		...latestEventOrderExpressions(signalWhere, signalAlias),
		entityId: latestField(signalEvent, "entityId", signalWhere),
		eventSchemaSlug: latestField(signalEvent, "eventSchemaSlug", signalWhere),
	};
	const progressAlias = `${alias}Progress`;
	const progressEvent = table("event", progressAlias);
	const progressWhere = and(
		eq(column(progressEvent, "entityId"), column(entity, "id")),
		eq(column(progressEvent, "eventSchemaSlug"), literal("progress")),
	);
	const latestProgress = latestEventOrderExpressions(progressWhere, progressAlias);
	const boundaryCompleteEvent = latestEntityCompletionExpressions(entity, `${alias}Boundary`);
	return {
		latestSignal,
		boundaryCompleteEvent,
		state: conditional(
			isNull(latestSignal.id),
			literal("untracked"),
			mediaStateFromLatestSignal(latestSignal.eventSchemaSlug),
		),
		progressPercent: conditional(
			orderExpressionsAreAfter(latestProgress, boundaryCompleteEvent),
			latestEventField(progressEvent, {
				where: progressWhere,
				select: castNumber(jsonPath(column(progressEvent, "properties"), "progressPercent")),
			}),
			literal(null),
		),
	};
};

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
		sessionEntityId: latestField(event, "sessionEntityId", where),
	};
};

const publishDate = (episode: TableReference) =>
	castDate(jsonPath(column(episode, "properties"), "publishDate"));

/** A null or malformed `publishDate` casts to null and counts as aired. */
export const episodeHasAired = (episode: TableReference) =>
	or(isNull(publishDate(episode)), lte(publishDate(episode), currentDate()));

export const episodeIsUpcoming = (episode: TableReference) =>
	and(isNotNull(publishDate(episode)), gt(publishDate(episode), currentDate()));

type EpisodeAiring = "aired" | "upcoming" | "any";

const airingFilters = {
	any: () => undefined,
	aired: episodeHasAired,
	upcoming: episodeIsUpcoming,
} satisfies Record<EpisodeAiring, (episode: TableReference) => Predicate | undefined>;

/**
 * Joins and predicate selecting a parent's regular episodes - every episode of a regular season
 * (`seasonNumber > 0`) for a show, every related episode for a podcast - narrowed by airing. The
 * aired set is the required set that coverage, counts, and next-up are judged over. `position`
 * orders the episodes: `(seasonNumber, episodeNumber)` for a show, `episodeNumber` for a podcast.
 */
export const episodicEpisodeQuery = (
	config: EpisodicKindConfig,
	parent: TableReference,
	episode: TableReference,
	alias: string,
	airing: EpisodeAiring = "aired",
) => {
	const airingFilter = airingFilters[airing](episode);
	const airingPredicates = airingFilter === undefined ? [] : [airingFilter];
	const episodeNumber = castNumber(jsonPath(column(episode, "properties"), "episodeNumber"));
	if (config.kind === "podcast") {
		const relationship = table("relationship", `${alias}Relationship`);
		return {
			position: [episodeNumber],
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
				...airingPredicates,
			),
		};
	}

	const season = table("entity", `${alias}Season`);
	const showSeason = table("relationship", `${alias}ShowSeason`);
	const seasonEpisode = table("relationship", `${alias}SeasonEpisode`);
	const seasonNumber = castNumber(jsonPath(column(season, "properties"), "seasonNumber"));
	return {
		position: [seasonNumber, episodeNumber],
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
			gt(seasonNumber, literal(0)),
			relationshipConnects(showSeason, parent, season, config.parentSeasonRelationshipSlug),
			relationshipConnects(seasonEpisode, season, episode, config.seasonEpisodeRelationshipSlug),
			...airingPredicates,
		),
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

/**
 * Current-cycle coverage over the required (aired) episodes. A season with nothing aired holds no
 * required episode, so it neither satisfies nor blocks coverage; empty coverage is never complete.
 */
const episodicCoverageExpressions = (
	config: EpisodicKindConfig,
	parent: TableReference,
	alias = "episodicCoverage",
) => {
	const episode = table("entity", `${alias}Episode`);
	const { joins, where } = episodicEpisodeQuery(config, parent, episode, `${alias}Required`);
	const requiredCount = count(episode, { joins, where });
	const coveredCount = count(episode, {
		joins,
		where: and(where, episodeIsCovered(episode, parent, `${alias}Episode`)),
	});
	const coverageStructureValid = gt(requiredCount, literal(0));
	return {
		coverageStructureValid,
		coverageComplete: and(coverageStructureValid, eq(coveredCount, requiredCount)),
	};
};

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

/**
 * The state an episode shows in lists, counts, and next-up. Once a new cycle has begun - a
 * regular-episode progress or completion after the parent's latest completion - it is the
 * episode's current-cycle state; until then it is the episode's lifetime latest state, so a
 * completed show still lists what was watched. Season-zero specials carry no parent session and sit
 * outside cycles, so they always show their lifetime latest state.
 */
export const episodeDisplayStateExpression = (
	episode: TableReference,
	parent: TableReference,
	alias = "episodeDisplayState",
) => {
	const boundary = latestParentCompletionExpressions(parent, `${alias}Boundary`);
	const cycleEvent = table("event", `${alias}Cycle`);
	const cycleSignal = latestEventOrderExpressions(
		and(
			eq(column(cycleEvent, "sessionEntityId"), column(parent, "id")),
			neq(column(cycleEvent, "entityId"), column(parent, "id")),
			eventSlugIsOneOf(cycleEvent, lifecycleEventSlugs),
		),
		`${alias}Cycle`,
	);
	const current = latestEpisodeLifecycleExpressions(episode, parent, `${alias}Current`);
	const lifetime = latestEpisodeEventExpressions(episode, `${alias}Lifetime`);
	return conditional(
		and(
			isNotNull(lifetime.sessionEntityId),
			isNotNull(cycleSignal.id),
			orderExpressionsAreAfter(cycleSignal, boundary),
		),
		conditional(
			orderExpressionsAreAfter(current, boundary),
			episodeStateFromLatest(current.eventSchemaSlug),
			literal("untracked"),
		),
		episodeStateFromLatest(lifetime.eventSchemaSlug),
	);
};

const showPositionIsAfterAnchor = (
	config: EpisodicKindConfig,
	parent: TableReference,
	position: readonly ScalarExpression[],
	alias: string,
) => {
	const anchor = table("entity", `${alias}Anchor`);
	const anchorQuery = episodicEpisodeQuery(config, parent, anchor, `${alias}Anchor`);
	const where = and(
		anchorQuery.where,
		eq(episodeDisplayStateExpression(anchor, parent, `${alias}AnchorState`), literal("complete")),
	);
	const [anchorSeasonNumber, anchorEpisodeNumber] = anchorQuery.position;
	const [season, episode] = position;
	if (!anchorSeasonNumber || !anchorEpisodeNumber || !season || !episode) {
		throw new Error("Show episodes are positioned by season and episode number");
	}
	const orderBy = [
		descending(anchorSeasonNumber),
		descending(anchorEpisodeNumber),
		descending(column(anchor, "id")),
	] as const;
	const anchorAt = (select: ScalarExpression) =>
		first(anchor, { where, select, orderBy, joins: anchorQuery.joins });
	const anchorSeason = anchorAt(anchorSeasonNumber);
	const anchorEpisode = anchorAt(anchorEpisodeNumber);
	return and(
		isNotNull(anchorSeason),
		or(gt(season, anchorSeason), and(eq(season, anchorSeason), gt(episode, anchorEpisode))),
	);
};

/**
 * The parent's next episode as a limit-1 include, judged by display state over the required set:
 * the `in_progress` episode (lowest position for a show, newest for a podcast); otherwise, for a
 * show, the lowest untracked episode after the highest completed one - none without that anchor
 * or with nothing after it - and for a podcast the newest untracked episode.
 */
export const episodicNextUpInclude = <const Selection extends SelectedSelection>(
	config: EpisodicKindConfig,
	parent: TableReference,
	selection: (episode: TableReference) => Selection,
	alias = "nextUp",
) => {
	const candidate = table("entity", `${alias}Candidate`);
	const scope = episodicEpisodeQuery(config, parent, candidate, `${alias}Candidate`);
	const state = episodeDisplayStateExpression(candidate, parent, `${alias}CandidateState`);
	const isInProgress = eq(state, literal("in_progress"));
	const isUntracked = eq(state, literal("untracked"));
	const direction = config.kind === "show" ? ascending : descending;
	return selectedInclude(candidate, {
		limit: 1,
		joins: scope.joins,
		selection: selection(candidate),
		orderBy: [
			ascending(conditional(isInProgress, literal(0), literal(1))),
			...scope.position.map((expression) => direction(expression)),
			direction(column(candidate, "id")),
		],
		where: and(
			scope.where,
			or(
				isInProgress,
				config.kind === "show"
					? and(isUntracked, showPositionIsAfterAnchor(config, parent, scope.position, alias))
					: isUntracked,
			),
		),
	});
};
