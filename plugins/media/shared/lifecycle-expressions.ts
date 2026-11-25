import { Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	castDate,
	castJson,
	castNumber,
	castText,
	coalesce,
	column,
	conditional,
	count,
	descending,
	divide,
	eq,
	exists,
	first,
	gt,
	gte,
	inArray,
	isNotNull,
	isNull,
	join,
	jsonPath,
	literal,
	localDate,
	lte,
	minimum,
	multiply,
	neq,
	now,
	or,
	reportingTimeZone,
	round,
	selectedInclude,
	type SelectedSelection,
	sum,
	table,
} from "@ryot-app/plugin-kit/ryotql";

export type Predicate = Parameters<typeof conditional>[0];
export type TableReference = Parameters<typeof column>[0];
export type ScalarExpression = Parameters<typeof ascending>[0];

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
			readonly kind: "podcast";
			readonly parentSchemaSlug: "podcast";
			readonly episodeSchemaSlug: "podcast-episode";
			readonly parentEpisodeRelationshipSlug: "podcast-to-podcast-episode";
	  }
	| {
			readonly kind: "show";
			readonly parentSchemaSlug: "show";
			readonly episodeSchemaSlug: "show-episode";
			readonly parentSeasonRelationshipSlug: "show-to-show-season";
			readonly seasonEpisodeRelationshipSlug: "show-season-to-show-episode";
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

export const lifecycleEventSlugs = ["progress", "complete"] as const;
const parentLifecycleEventSlugs = ["backlog", "complete", "dropped", "on_hold"] as const;
const mediaLifecycleSignalSlugs = [
	"backlog",
	"progress",
	"complete",
	"dropped",
	"on_hold",
	"list-state",
] as const;

export const sameSchemaOwner = (from: TableReference, ownerField: string, parent: TableReference) =>
	eq(column(from, ownerField), column(parent, "entitySchemaPluginId"));

export const entitySchemaIs = (entity: TableReference, slug: string) =>
	eq(column(entity, "entitySchemaSlug"), literal(slug));

/** The ownership and slug of a relationship from `parent` to `child`, without its endpoints. */
const relationshipOwnership = (
	relationship: TableReference,
	parent: TableReference,
	child: TableReference,
	slug: string,
) => [
	sameSchemaOwner(relationship, "relationshipSchemaPluginId", parent),
	sameSchemaOwner(child, "entitySchemaPluginId", parent),
	eq(column(relationship, "relationshipSchemaSlug"), literal(slug)),
];

export const relationshipConnects = (
	relationship: TableReference,
	parent: TableReference,
	child: TableReference,
	slug: string,
) =>
	and(
		eq(column(relationship, "sourceEntityId"), column(parent, "id")),
		eq(column(relationship, "targetEntityId"), column(child, "id")),
		...relationshipOwnership(relationship, parent, child, slug),
	);

export const eventSlugIsOneOf = (event: TableReference, slugs: readonly string[]) =>
	inArray(
		column(event, "eventSchemaSlug"),
		slugs.map((slug) => literal(slug)),
	);

const mediaEventOrderExpressions = (event: TableReference): EventOrderExpressions => ({
	id: column(event, "orderKey"),
	occurredAt: column(event, "occurredAt"),
	createdAt: column(event, "orderCreatedAt"),
});

const mediaEventOrderDescending = (event: TableReference) => {
	const order = mediaEventOrderExpressions(event);
	return [descending(order.occurredAt), descending(order.createdAt), descending(order.id)] as const;
};

const latestLifecycleField = (
	event: TableReference,
	options: {
		where: Predicate;
		select: ScalarExpression;
		joins?: readonly ReturnType<typeof join>[];
	},
) => first(event, { ...options, orderBy: mediaEventOrderDescending(event) });

const latestField = (
	event: TableReference,
	field: string,
	where: Predicate,
	joins?: readonly ReturnType<typeof join>[],
) => {
	const order = mediaEventOrderExpressions(event);
	let select: ScalarExpression = column(event, field);
	if (field === "id") {
		select = order.id;
	}
	if (field === "createdAt") {
		select = order.createdAt;
	}
	return latestLifecycleField(event, { where, select, ...(joins ? { joins } : {}) });
};

const latestEventOrderExpressions = (where: Predicate, alias: string): EventOrderExpressions => {
	const event = table("event", alias);
	return {
		id: latestField(event, "id", where),
		createdAt: latestField(event, "createdAt", where),
		occurredAt: latestField(event, "occurredAt", where),
	};
};

/** Whether `later` sorts at or before `event` in `mediaEventOrderDescending`. */
const orderIsAtLeast = (later: TableReference, event: TableReference) => {
	const laterOrder = mediaEventOrderExpressions(later);
	const order = mediaEventOrderExpressions(event);
	return or(
		gt(laterOrder.occurredAt, order.occurredAt),
		and(
			eq(laterOrder.occurredAt, order.occurredAt),
			or(
				gt(laterOrder.createdAt, order.createdAt),
				and(eq(laterOrder.createdAt, order.createdAt), gte(laterOrder.id, order.id)),
			),
		),
	);
};

/**
 * A left join of the parent's completions at or after `event`. `event` follows the latest one, as
 * `orderExpressionsAreAfter` judges it, exactly when none joins.
 */
const parentCompletionsSince = (event: TableReference, parent: TableReference, alias: string) => {
	const completion = table("event", alias);
	return {
		none: isNull(column(completion, "id")),
		join: join(
			"left",
			completion,
			and(
				eq(column(completion, "entityId"), column(parent, "id")),
				sameSchemaOwner(completion, "eventSchemaPluginId", parent),
				eq(column(completion, "sessionEntityId"), column(parent, "id")),
				eq(column(completion, "eventSchemaSlug"), literal("complete")),
				orderIsAtLeast(completion, event),
			),
		),
	};
};

export const orderExpressionsAreAfter = (
	current: EventOrderExpressions,
	boundary: EventOrderExpressions,
) =>
	or(
		isNull(boundary.id),
		gt(current.occurredAt, boundary.occurredAt),
		and(
			eq(current.occurredAt, boundary.occurredAt),
			or(
				gt(current.createdAt, boundary.createdAt),
				and(eq(current.createdAt, boundary.createdAt), gt(current.id, boundary.id)),
			),
		),
	);

const latestEntityCompletionExpressions = (
	entity: TableReference,
	alias: string,
): EventOrderExpressions => {
	const event = table("event", alias);
	const where = and(
		eq(column(event, "entityId"), column(entity, "id")),
		sameSchemaOwner(event, "eventSchemaPluginId", entity),
		eq(column(event, "eventSchemaSlug"), literal("complete")),
	);
	return latestEventOrderExpressions(where, alias);
};

const mediaStateFromLatestSignal = (
	eventSchemaSlug: ScalarExpression,
	listState: ScalarExpression,
) =>
	conditional(
		eq(eventSchemaSlug, literal("list-state")),
		listState,
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
		),
	);

export const mediaLifecycleExpressions = (entity: TableReference, alias = "mediaLifecycle") => {
	const signalAlias = `${alias}Signal`;
	const signalEvent = table("event", signalAlias);
	const signalWhere = and(
		sameSchemaOwner(signalEvent, "eventSchemaPluginId", entity),
		eq(column(signalEvent, "entityId"), column(entity, "id")),
		eventSlugIsOneOf(signalEvent, mediaLifecycleSignalSlugs),
	);
	const latestSignal = {
		...latestEventOrderExpressions(signalWhere, signalAlias),
		entityId: latestField(signalEvent, "entityId", signalWhere),
		eventSchemaSlug: latestField(signalEvent, "eventSchemaSlug", signalWhere),
		listState: latestLifecycleField(signalEvent, {
			where: signalWhere,
			select: castText(jsonPath(column(signalEvent, "properties"), "state")),
		}),
	};
	const progressAlias = `${alias}Progress`;
	const progressEvent = table("event", progressAlias);
	const progressWhere = and(
		sameSchemaOwner(progressEvent, "eventSchemaPluginId", entity),
		eq(column(progressEvent, "entityId"), column(entity, "id")),
		eq(column(progressEvent, "eventSchemaSlug"), literal("progress")),
	);
	const latestProgress = latestEventOrderExpressions(progressWhere, progressAlias);
	const progressProperty = (name: string) =>
		castNumber(jsonPath(column(progressEvent, "properties"), name));
	const entityProperty = (name: string) => castNumber(jsonPath(column(entity, "properties"), name));
	const progressPosition = castNumber(
		jsonPath(column(progressEvent, "properties"), "position", "position"),
	);
	const progressPositionUnit = castText(
		jsonPath(column(progressEvent, "properties"), "position", "unit"),
	);
	const positionWhere = and(progressWhere, isNotNull(progressPosition));
	const latestPosition = latestLifecycleField(progressEvent, {
		where: positionWhere,
		select: castJson(jsonPath(column(progressEvent, "properties"), "position")),
	});
	const latestPositionFraction = latestLifecycleField(progressEvent, {
		where: positionWhere,
		select: divide(
			progressPosition,
			conditional(
				eq(progressPositionUnit, literal("volumes")),
				entityProperty("volumes"),
				conditional(
					eq(progressPositionUnit, literal("chapters")),
					entityProperty("chapters"),
					entityProperty("episodes"),
				),
			),
		),
	});
	const boundaryCompleteEvent = latestEntityCompletionExpressions(entity, `${alias}Boundary`);
	const progressBoundaryAlias = `${alias}ProgressBoundary`;
	const progressBoundaryEvent = table("event", progressBoundaryAlias);
	const progressBoundaryWhere = and(
		sameSchemaOwner(progressBoundaryEvent, "eventSchemaPluginId", entity),
		eq(column(progressBoundaryEvent, "entityId"), column(entity, "id")),
		eventSlugIsOneOf(progressBoundaryEvent, ["complete", "list-state"]),
	);
	const latestProgressBoundary = latestEventOrderExpressions(
		progressBoundaryWhere,
		progressBoundaryAlias,
	);
	const isCurrentProgress = orderExpressionsAreAfter(latestProgress, latestProgressBoundary);
	return {
		latestSignal,
		boundaryCompleteEvent,
		position: conditional(
			eq(latestSignal.eventSchemaSlug, literal("list-state")),
			literal(null),
			conditional(isCurrentProgress, latestPosition, literal(null)),
		),
		state: conditional(
			isNull(latestSignal.id),
			literal("untracked"),
			latestLifecycleField(signalEvent, {
				where: signalWhere,
				select: mediaStateFromLatestSignal(
					column(signalEvent, "eventSchemaSlug"),
					castText(jsonPath(column(signalEvent, "properties"), "state")),
				),
			}),
		),
		progressPercent: conditional(
			eq(latestSignal.eventSchemaSlug, literal("list-state")),
			literal(null),
			conditional(
				isCurrentProgress,
				coalesce(
					divide(round(multiply(latestPositionFraction, literal(10000))), literal(100)),
					latestLifecycleField(progressEvent, {
						where: progressWhere,
						select: progressProperty("progressPercent"),
					}),
				),
				literal(null),
			),
		),
	};
};

/**
 * The state of the episode's latest progress or completion in the parent's session while that event
 * follows the parent's latest completion, otherwise `untracked`.
 */
const currentCycleEpisodeState = (
	episode: TableReference,
	parent: TableReference,
	alias: string,
) => {
	const event = table("event", alias);
	const since = parentCompletionsSince(event, parent, `${alias}Completion`);
	return coalesce(
		latestLifecycleField(event, {
			joins: [since.join],
			select: episodeStateFromLatest(column(event, "eventSchemaSlug")),
			where: and(
				eq(column(event, "entityId"), column(episode, "id")),
				sameSchemaOwner(event, "eventSchemaPluginId", episode),
				eq(column(event, "sessionEntityId"), column(parent, "id")),
				eventSlugIsOneOf(event, lifecycleEventSlugs),
				since.none,
			),
		}),
		literal("untracked"),
	);
};

const latestEpisodeEventExpressions = (episode: TableReference, alias: string) => {
	const event = table("event", alias);
	const where = and(
		sameSchemaOwner(event, "eventSchemaPluginId", episode),
		eq(column(event, "entityId"), column(episode, "id")),
		eventSlugIsOneOf(event, lifecycleEventSlugs),
	);
	return {
		sessionEntityId: latestField(event, "sessionEntityId", where),
		state: coalesce(
			latestLifecycleField(event, {
				where,
				select: episodeStateFromLatest(column(event, "eventSchemaSlug")),
			}),
			literal("untracked"),
		),
	};
};

export const publishDate = (episode: TableReference) =>
	castDate(jsonPath(column(episode, "properties"), "publishDate"));

/** `publishDate` as an indexed column. Date windows filter on this, not on the property. */
export const occursAt = (entity: TableReference) => column(entity, "occursAt");

/** An episode's release: its known `airingAt` instant, otherwise its `occursAt` date. */
export const episodeReleaseTime = (episode: TableReference) => ({
	date: occursAt(episode),
	instant: castDate(jsonPath(column(episode, "properties"), "airingAt")),
});

export const reportingToday = castDate(localDate(now(), { timeZone: reportingTimeZone }));

export const episodeReleaseDay = (episode: TableReference) => {
	const { date, instant } = episodeReleaseTime(episode);
	return coalesce(castDate(localDate(instant, { timeZone: reportingTimeZone })), date);
};

/** Release order is arrival order: by reporting day, a date-only release before timed ones. */
export const episodeReleaseOrder = (episode: TableReference) => {
	const { instant } = episodeReleaseTime(episode);
	return [
		ascending(episodeReleaseDay(episode)),
		ascending(conditional(isNull(instant), literal(0), literal(1))),
		ascending(instant),
	] as const;
};

type Release = { readonly date: ScalarExpression; readonly instant: ScalarExpression };

const instantHasArrived = (instant: ScalarExpression) => lte(instant, now());

const dateHasArrived = (date: ScalarExpression) => lte(date, reportingToday);

/**
 * Whether a release in a set has arrived, given the set's earliest instant and the earliest date
 * among its releases without an instant.
 */
export const releaseHasArrived = (release: Release) =>
	or(instantHasArrived(release.instant), dateHasArrived(release.date));

/** An episode with neither a date nor an instant counts as aired. */
export const episodeHasAired = (episode: TableReference) => {
	const { date, instant } = episodeReleaseTime(episode);
	return or(
		instantHasArrived(instant),
		and(isNull(instant), or(isNull(date), dateHasArrived(date))),
	);
};

export const episodeIsUpcoming = (episode: TableReference) => {
	const { date, instant } = episodeReleaseTime(episode);
	return or(gt(instant, now()), and(isNull(instant), gt(date, reportingToday)));
};

type EpisodeAiring = "any" | "aired" | "upcoming";

const episodeNumberOf = (episode: TableReference) =>
	castNumber(jsonPath(column(episode, "properties"), "episodeNumber"));

const seasonNumberOf = (season: TableReference) =>
	castNumber(jsonPath(column(season, "properties"), "seasonNumber"));

const airingFilters = {
	any: () => undefined,
	aired: episodeHasAired,
	upcoming: episodeIsUpcoming,
} satisfies Record<EpisodeAiring, (episode: TableReference) => Predicate | undefined>;

/**
 * Joins and predicate selecting a parent's regular episodes - every episode of a regular season
 * (`seasonNumber > 0`) for a show, every related episode for a podcast - narrowed by airing.
 * The aired set is the required set that coverage, counts, and next-up are judged over. `position`
 * orders the episodes: `(seasonNumber, episodeNumber)` for a show, `episodeNumber` for a podcast.
 * `seasons: "all"` also selects season-zero specials; `parentId` links each episode to its parent.
 * `joins` start from the episode; `parentJoins` start from `parent` and end at the episode. Either
 * holds the links' endpoints, so `where` must be read with one of them.
 */
export const episodicEpisodeQuery = (
	config: EpisodicKindConfig,
	parent: TableReference,
	episode: TableReference,
	alias: string,
	airing: EpisodeAiring = "aired",
	seasons: "all" | "regular" = "regular",
) => {
	const airingFilter = airingFilters[airing](episode);
	const airingPredicates = airingFilter === undefined ? [] : [airingFilter];
	const episodeNumber = episodeNumberOf(episode);
	if (config.kind === "podcast") {
		const relationship = table("relationship", `${alias}Relationship`);
		return {
			season: null,
			links: [relationship],
			position: [episodeNumber] as const,
			parentId: column(relationship, "sourceEntityId"),
			joins: [
				join(
					"inner",
					relationship,
					eq(column(relationship, "targetEntityId"), column(episode, "id")),
				),
			],
			parentJoins: [
				join(
					"inner",
					relationship,
					eq(column(relationship, "sourceEntityId"), column(parent, "id")),
				),
				join("inner", episode, eq(column(relationship, "targetEntityId"), column(episode, "id"))),
			],
			where: and(
				entitySchemaIs(episode, config.episodeSchemaSlug),
				eq(column(relationship, "sourceEntityId"), column(parent, "id")),
				...relationshipOwnership(
					relationship,
					parent,
					episode,
					config.parentEpisodeRelationshipSlug,
				),
				...airingPredicates,
			),
		};
	}

	const season = table("entity", `${alias}Season`);
	const showSeason = table("relationship", `${alias}ShowSeason`);
	const seasonEpisode = table("relationship", `${alias}SeasonEpisode`);
	const seasonNumber = seasonNumberOf(season);
	return {
		season,
		links: [showSeason, seasonEpisode],
		parentId: column(showSeason, "sourceEntityId"),
		position: [seasonNumber, episodeNumber] as const,
		joins: [
			join(
				"inner",
				seasonEpisode,
				eq(column(seasonEpisode, "targetEntityId"), column(episode, "id")),
			),
			join("inner", season, eq(column(seasonEpisode, "sourceEntityId"), column(season, "id"))),
			join("inner", showSeason, eq(column(showSeason, "targetEntityId"), column(season, "id"))),
		],
		parentJoins: [
			join("inner", showSeason, eq(column(showSeason, "sourceEntityId"), column(parent, "id"))),
			join("inner", season, eq(column(showSeason, "targetEntityId"), column(season, "id"))),
			join(
				"inner",
				seasonEpisode,
				eq(column(seasonEpisode, "sourceEntityId"), column(season, "id")),
			),
			join("inner", episode, eq(column(seasonEpisode, "targetEntityId"), column(episode, "id"))),
		],
		where: and(
			entitySchemaIs(episode, config.episodeSchemaSlug),
			entitySchemaIs(season, "show-season"),
			...(seasons === "regular" ? [gt(seasonNumber, literal(0))] : []),
			eq(column(showSeason, "sourceEntityId"), column(parent, "id")),
			...relationshipOwnership(showSeason, parent, season, config.parentSeasonRelationshipSlug),
			...relationshipOwnership(
				seasonEpisode,
				season,
				episode,
				config.seasonEpisodeRelationshipSlug,
			),
			...airingPredicates,
		),
	};
};

/**
 * A parent's regular episodes of one airing. Its measures share one query set, so they fuse into one
 * pass over the episodes.
 */
export const episodicEpisodeWalk = (
	config: EpisodicKindConfig,
	parent: TableReference,
	alias: string,
	airing: "aired" | "upcoming",
) => {
	const episode = table("entity", `${alias}Episode`);
	const { joins, where } = episodicEpisodeQuery(config, parent, episode, alias, airing);
	const scope = { joins, where };
	return {
		episode,
		count: count(episode, scope),
		minimum: (expr: ScalarExpression) => minimum(episode, expr, scope),
		countWhere: (predicate: Predicate) =>
			coalesce(sum(episode, conditional(predicate, literal(1), literal(0)), scope), literal(0)),
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
		sameSchemaOwner(event, "eventSchemaPluginId", parent),
		sameSchemaOwner(entity, "entitySchemaPluginId", parent),
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
	const slug = column(event, "eventSchemaSlug");
	return {
		occurredAt: latestField(event, "occurredAt", where, joins),
		parentState: latestLifecycleField(event, {
			joins,
			where,
			select: conditional(
				eq(column(event, "entityId"), column(parent, "id")),
				conditional(
					eq(slug, literal("backlog")),
					literal("backlog"),
					conditional(
						eq(slug, literal("on_hold")),
						literal("on_hold"),
						conditional(eq(slug, literal("dropped")), literal("dropped"), literal("complete")),
					),
				),
				literal(null),
			),
		}),
	};
};

/**
 * The parent's state from its latest aggregate signal: the parent's own state when that signal is a
 * parent event, otherwise `caught_up` once current-cycle coverage over the required (aired) episodes
 * is complete and `in_progress` before. A season with nothing aired holds no required episode, so it
 * neither satisfies nor blocks coverage; empty coverage is never complete.
 */
export const episodicLifecycleExpressions = (
	config: EpisodicKindConfig,
	parent: TableReference,
	alias = "episodicLifecycle",
) => {
	const latestSignal = latestAggregateSignalExpressions(config, parent, `${alias}Signal`);
	const required = episodicEpisodeWalk(config, parent, `${alias}Aired`, "aired");
	const covered = required.countWhere(
		eq(
			currentCycleEpisodeState(required.episode, parent, `${alias}AiredCurrent`),
			literal("complete"),
		),
	);
	const state = conditional(
		isNull(latestSignal.occurredAt),
		literal("untracked"),
		coalesce(
			latestSignal.parentState,
			conditional(
				and(gt(required.count, literal(0)), eq(covered, required.count)),
				literal("caught_up"),
				literal("in_progress"),
			),
		),
	);
	return { state, latestSignal };
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
 * Progresses and completions in the parent's session, other than on the parent itself, after the
 * parent's latest completion.
 */
const newCycleSignals = (parent: TableReference, alias: string) => {
	const event = table("event", alias);
	const since = parentCompletionsSince(event, parent, `${alias}Completion`);
	return {
		event,
		joins: [since.join],
		where: and(
			eq(column(event, "sessionEntityId"), column(parent, "id")),
			sameSchemaOwner(event, "eventSchemaPluginId", parent),
			neq(column(event, "entityId"), column(parent, "id")),
			eventSlugIsOneOf(event, lifecycleEventSlugs),
			since.none,
		),
	};
};

/** Whether a new cycle has begun: one of `newCycleSignals` exists. */
const episodicNewCycle = (parent: TableReference, alias: string) => {
	const { event, ...signals } = newCycleSignals(parent, alias);
	return exists(event, signals);
};

/**
 * The parent's latest new-cycle signal as a left join, for a query that reads whether a new cycle
 * has begun for many episodes: `newCycle` is `episodicNewCycle` read once.
 */
export const episodicNewCycleJoin = (parent: TableReference, alias: string) => {
	const { event, ...signals } = newCycleSignals(parent, `${alias}Signal`);
	const signal = table("event", alias);
	return {
		newCycle: isNotNull(column(signal, "id")),
		join: join(
			"left",
			signal,
			eq(
				column(signal, "id"),
				latestLifecycleField(event, { ...signals, select: column(event, "id") }),
			),
		),
	};
};

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
	newCycle: Predicate = episodicNewCycle(parent, `${alias}Cycle`),
) => {
	const lifetime = latestEpisodeEventExpressions(episode, `${alias}Lifetime`);
	return conditional(
		and(isNotNull(lifetime.sessionEntityId), newCycle),
		currentCycleEpisodeState(episode, parent, `${alias}Current`),
		lifetime.state,
	);
};

export type EpisodicEpisodeCounts = Readonly<
	Record<
		"airedEpisodes" | "watchedEpisodes" | "upcomingEpisodes" | "inProgressEpisodes",
		ScalarExpression
	>
>;

/**
 * A parent's aired and upcoming regular episodes, and the aired ones watched or in progress. The aired
 * walk is `episodicLifecycleExpressions`' coverage walk under the same alias, so they fuse.
 */
export const episodicEpisodeCounts = (
	config: EpisodicKindConfig,
	parent: TableReference,
	alias: string,
	newCycle?: Predicate,
): EpisodicEpisodeCounts => {
	const aired = episodicEpisodeWalk(config, parent, `${alias}Aired`, "aired");
	const state = episodeDisplayStateExpression(
		aired.episode,
		parent,
		`${alias}AiredState`,
		newCycle,
	);
	return {
		airedEpisodes: aired.count,
		watchedEpisodes: aired.countWhere(eq(state, literal("complete"))),
		inProgressEpisodes: aired.countWhere(eq(state, literal("in_progress"))),
		upcomingEpisodes: episodicEpisodeWalk(config, parent, `${alias}Upcoming`, "upcoming").count,
	};
};

/**
 * Whether the user has an event `episodicLifecycleExpressions` or the watched and in-progress
 * `episodicEpisodeCounts` read for `parent`: one in its session, or a progress or completion of one
 * of its aired regular episodes. Without one, its state is untracked and both counts are zero.
 */
export const episodicHistoryExists = (
	config: EpisodicKindConfig,
	parent: TableReference,
	alias: string,
) => {
	const sessionEvent = table("event", `${alias}Session`);
	const episode = table("entity", `${alias}Episode`);
	const episodeEvent = table("event", `${alias}EpisodeEvent`);
	const aired = episodicEpisodeQuery(config, parent, episode, `${alias}Episode`);
	return or(
		exists(sessionEvent, {
			where: and(
				eq(column(sessionEvent, "sessionEntityId"), column(parent, "id")),
				sameSchemaOwner(sessionEvent, "eventSchemaPluginId", parent),
			),
		}),
		exists(episode, {
			joins: aired.joins,
			where: and(
				aired.where,
				exists(episodeEvent, {
					where: and(
						eq(column(episodeEvent, "entityId"), column(episode, "id")),
						sameSchemaOwner(episodeEvent, "eventSchemaPluginId", episode),
						eventSlugIsOneOf(episodeEvent, lifecycleEventSlugs),
					),
				}),
			),
		}),
	);
};

/**
 * The highest completed regular episode of a show by season and episode number, joined through its
 * season link, and whether a position is after it; nothing is after a missing anchor.
 */
const showAnchor = (
	config: EpisodicKindConfig,
	parent: TableReference,
	alias: string,
	newCycle?: Predicate,
) => {
	const anchor = table("entity", `${alias}Anchor`);
	const anchorQuery = episodicEpisodeQuery(config, parent, anchor, `${alias}Anchor`);
	const [anchorSeasonNumber, anchorEpisodeNumber] = anchorQuery.position;
	const [, anchorLink] = anchorQuery.links;
	if (!anchorEpisodeNumber || !anchorLink) {
		throw new Error("Show episodes are positioned by season and episode number");
	}
	const link = table("relationship", `${alias}AnchorLink`);
	const season = table("entity", `${alias}AnchorSeason`);
	const episode = table("entity", `${alias}AnchorEpisode`);
	const anchorLinkId = first(anchor, {
		joins: anchorQuery.joins,
		select: column(anchorLink, "id"),
		orderBy: [
			descending(anchorSeasonNumber),
			descending(anchorEpisodeNumber),
			descending(column(anchor, "id")),
		],
		where: and(
			anchorQuery.where,
			eq(
				episodeDisplayStateExpression(anchor, parent, `${alias}AnchorState`, newCycle),
				literal("complete"),
			),
		),
	});
	return {
		joins: [
			join("left", link, eq(column(link, "id"), anchorLinkId)),
			join("left", season, eq(column(season, "id"), column(link, "sourceEntityId"))),
			join("left", episode, eq(column(episode, "id"), column(link, "targetEntityId"))),
		],
		isAfter: (position: readonly ScalarExpression[]) => {
			const [seasonNumber, episodeNumber] = position;
			if (!seasonNumber || !episodeNumber) {
				throw new Error("Show episodes are positioned by season and episode number");
			}
			const anchorSeason = seasonNumberOf(season);
			return or(
				gt(seasonNumber, anchorSeason),
				and(eq(seasonNumber, anchorSeason), gt(episodeNumber, episodeNumberOf(episode))),
			);
		},
	};
};

/**
 * The lowest regular episode of the parent that `narrow` keeps, by position for a show and newest
 * first for a podcast.
 */
const nextEpisodeId = (
	config: EpisodicKindConfig,
	parent: TableReference,
	alias: string,
	narrow: (
		episode: TableReference,
		position: readonly ScalarExpression[],
	) => { readonly where: Predicate; readonly joins?: readonly ReturnType<typeof join>[] },
) => {
	const episode = table("entity", `${alias}Episode`);
	const scope = episodicEpisodeQuery(config, parent, episode, alias);
	const narrowed = narrow(episode, scope.position);
	const direction = config.kind === "show" ? ascending : descending;
	const [leading, ...trailing] = scope.position;
	return first(episode, {
		select: column(episode, "id"),
		where: and(scope.where, narrowed.where),
		joins: [...scope.joins, ...(narrowed.joins ?? [])],
		orderBy: [
			direction(leading),
			...[...trailing, column(episode, "id")].map((expression) => direction(expression)),
		],
	});
};

/**
 * The ID of the parent's next episode, judged by display state over the required set: the
 * `in_progress` episode (lowest position for a show, newest for a podcast); otherwise, for a show, the
 * lowest episode after the highest completed one, which is untracked - none without that anchor or
 * with nothing after it - and for a podcast the newest untracked episode. Null when there is none.
 */
export const episodicNextUpId = (
	config: EpisodicKindConfig,
	parent: TableReference,
	alias: string,
	newCycle?: Predicate,
) => {
	const progress = table("event", `${alias}Progress`);
	return coalesce(
		nextEpisodeId(config, parent, `${alias}InProgress`, (episode) => ({
			where: and(
				exists(progress, {
					where: and(
						eq(column(progress, "entityId"), column(episode, "id")),
						sameSchemaOwner(progress, "eventSchemaPluginId", episode),
						eq(column(progress, "eventSchemaSlug"), literal("progress")),
					),
				}),
				eq(
					episodeDisplayStateExpression(episode, parent, `${alias}InProgressState`, newCycle),
					literal("in_progress"),
				),
			),
		})),
		config.kind === "show"
			? nextEpisodeId(config, parent, `${alias}AfterAnchor`, (_, position) => {
					const anchor = showAnchor(config, parent, alias, newCycle);
					return { joins: anchor.joins, where: anchor.isAfter(position) };
				})
			: nextEpisodeId(config, parent, `${alias}Untracked`, (episode) => ({
					where: eq(
						episodeDisplayStateExpression(episode, parent, `${alias}UntrackedState`, newCycle),
						literal("untracked"),
					),
				})),
	);
};

/** The episode `episodicNextUpId` resolves, as a limit-1 include. */
export const episodicNextUpInclude = <const Selection extends SelectedSelection>(
	config: EpisodicKindConfig,
	parent: TableReference,
	selection: (episode: TableReference) => Selection,
	alias = "nextUp",
) => {
	const episode = table("entity", alias);
	return selectedInclude(episode, {
		limit: 1,
		selection: selection(episode),
		orderBy: [ascending(column(episode, "id"))],
		where: eq(column(episode, "id"), episodicNextUpId(config, parent, alias)),
	});
};
