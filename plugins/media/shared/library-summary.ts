import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	castDate,
	castNumber,
	castText,
	coalesce,
	column,
	concat,
	conditional,
	count,
	defineRecipe,
	eq,
	exists,
	first,
	gt,
	inArray,
	isNull,
	IsoDateString,
	join,
	jsonPath,
	literal,
	maximum,
	not,
	or,
	parameters,
	type Recipe,
	selectedField,
	selectedRows,
	sum,
	table,
} from "@ryot-app/plugin-kit/ryotql";

import {
	consumptionNumber,
	consumptionReady,
	consumptionRows,
	consumptionValue,
} from "./consumption-recipes";
import type { Table } from "./entity-selections";
import {
	episodeReleaseTime,
	type EpisodicEpisodeCounts,
	episodicEpisodeCounts,
	episodicEpisodeWalk,
	type EpisodicKindConfig,
	episodicLifecycleExpressions,
	EpisodicLifecycleStateSchema,
	episodicNewCycleJoin,
	episodicNextUpId,
	eventSlugIsOneOf,
	lifecycleEventSlugs,
	mediaLifecycleExpressions,
	podcastEpisodicKindConfig,
	type Predicate,
	releaseHasArrived,
	sameSchemaOwner,
	type ScalarExpression,
	showEpisodicKindConfig,
} from "./lifecycle-expressions";
import { flatMediaSchemaSlugs } from "./media-schema-slugs";
import { catalogMessage } from "./messages.generated";
import { averageUserRating } from "./user-rating";

/** Output of the `in-media-library` projection; absent values are omitted. */
export const librarySummaryPropertiesSchema = {
	unknownKeys: "strict" as const,
	fields: {
		airedEpisodes: {
			type: "number" as const,
			description: "Aired regular episodes",
			label: catalogMessage("property.aired-episodes"),
		},
		nextUpEpisodeId: {
			type: "string" as const,
			label: catalogMessage("property.next-episode"),
			description: "The episode the user watches next",
		},
		lifecycleState: {
			type: "string" as const,
			label: catalogMessage("property.status"),
			description: "Lifecycle state computed from the user's history",
		},
		upcomingEpisodes: {
			type: "number" as const,
			label: catalogMessage("property.upcoming-episodes"),
			description: "Regular episodes that have not aired",
		},
		releaseDate: {
			type: "datetime" as const,
			label: catalogMessage("property.release-date"),
			description: "Publish date, else the start of the publish year",
		},
		watchedEpisodes: {
			type: "number" as const,
			label: catalogMessage("property.completed-episodes"),
			description: "Aired regular episodes the user completed",
		},
		nextAiringAt: {
			type: "datetime" as const,
			label: catalogMessage("property.next-airing"),
			description: "Earliest release instant of an unaired regular episode",
		},
		lastActivityAt: {
			type: "datetime" as const,
			label: catalogMessage("property.recent-activity"),
			description: "When the user's latest lifecycle activity occurred",
		},
		inProgressEpisodes: {
			type: "number" as const,
			label: catalogMessage("property.in-progress-episodes"),
			description: "Aired regular episodes the user is partway through",
		},
		nextAiringDate: {
			type: "datetime" as const,
			label: catalogMessage("property.next-airing"),
			description: "Earliest release date of an unaired regular episode without a release instant",
		},
		nextTrackedAiringAt: {
			type: "datetime" as const,
			label: catalogMessage("property.next-tracked-airing"),
			description:
				"Earliest release instant of an unaired regular episode the user has progress on",
		},
		nextTrackedAiringDate: {
			type: "datetime" as const,
			label: catalogMessage("property.next-tracked-airing"),
			description:
				"Earliest release date of an unaired regular episode without a release instant the user has progress on",
		},
	},
};

const SummaryRowSchema = {
	id: Schema.String,
	state: EpisodicLifecycleStateSchema,
	release: Schema.NullOr(IsoDateString),
	releaseDate: Schema.NullOr(IsoDateString),
	episodeCount: Schema.NullOr(Schema.Finite),
	lastActivityAt: Schema.NullOr(IsoDateString),
	nextUpEpisodeId: Schema.NullOr(Schema.String),
};

const property = (entity: Table, name: string) => jsonPath(column(entity, "properties"), name);

const releaseDate = (entity: Table) =>
	coalesce(
		castDate(property(entity, "publishDate")),
		castDate(concat(castText(property(entity, "publishYear")), literal("-01-01T00:00:00.000Z"))),
	);

const sharedSummarySelection = (entity: Table) => {
	return {
		id: selectedField(column(entity, "id"), SummaryRowSchema.id),
		releaseDate: selectedField(releaseDate(entity), SummaryRowSchema.releaseDate),
	};
};

export type LibrarySummaryKind = "flat" | "other" | EpisodicKindConfig;

const flatSlugs = new Set<string>(flatMediaSchemaSlugs);

export const librarySummaryKind = (entitySchemaSlug: string): LibrarySummaryKind =>
	[showEpisodicKindConfig, podcastEpisodicKindConfig].find(
		({ parentSchemaSlug }) => parentSchemaSlug === entitySchemaSlug,
	) ?? (flatSlugs.has(entitySchemaSlug) ? "flat" : "other");

const noEpisodeCounts: EpisodicEpisodeCounts = {
	airedEpisodes: literal(null),
	watchedEpisodes: literal(null),
	upcomingEpisodes: literal(null),
	inProgressEpisodes: literal(null),
};

const noRelease = { date: literal(null), instant: literal(null) };

const lifecycleOf = (kind: LibrarySummaryKind, entity: Table) => {
	if (kind === "other") {
		return {
			joins: [],
			nextUp: literal(null),
			nextAiring: noRelease,
			activity: literal(null),
			counts: noEpisodeCounts,
			state: literal("untracked"),
			nextTrackedAiring: noRelease,
		};
	}
	if (kind === "flat") {
		const lifecycle = mediaLifecycleExpressions(entity, "summaryLifecycle");
		return {
			joins: [],
			nextUp: literal(null),
			nextAiring: noRelease,
			state: lifecycle.state,
			counts: noEpisodeCounts,
			nextTrackedAiring: noRelease,
			activity: lifecycle.latestSignal.occurredAt,
		};
	}
	const lifecycle = episodicLifecycleExpressions(kind, entity, "summary");
	const cycle = episodicNewCycleJoin(entity, "summaryCycle");
	const upcoming = episodicEpisodeWalk(kind, entity, "summaryUpcoming", "upcoming");
	const release = episodeReleaseTime(upcoming.episode);
	const dated = isNull(release.instant);
	const event = table("event", "summaryTrackedEvent");
	const tracked = exists(event, {
		where: and(
			eq(column(event, "entityId"), column(upcoming.episode, "id")),
			sameSchemaOwner(event, "eventSchemaPluginId", upcoming.episode),
			eventSlugIsOneOf(event, lifecycleEventSlugs),
		),
	});
	return {
		joins: [cycle.join],
		state: lifecycle.state,
		activity: lifecycle.latestSignal.occurredAt,
		counts: episodicEpisodeCounts(kind, entity, "summary", cycle.newCycle),
		nextUp: episodicNextUpId(kind, entity, "summaryNextUp", cycle.newCycle),
		nextAiring: {
			instant: upcoming.minimum(release.instant),
			date: upcoming.minimum(conditional(dated, release.date, literal(null))),
		},
		nextTrackedAiring: {
			instant: upcoming.minimum(conditional(tracked, release.instant, literal(null))),
			date: upcoming.minimum(conditional(and(tracked, dated), release.date, literal(null))),
		},
	};
};
export const librarySummaryEntitiesRecipe = (() => {
	const inputParameters = parameters({
		fields: {
			entityIds: {
				type: "array",
				validation: { required: true },
				description: "entityIds for this selection",
				label: catalogMessage("query-parameter.entities"),
				items: {
					type: "string",
					description: "Selected ID",
					label: catalogMessage("query-parameter.id"),
				},
			},
		},
	});
	const entity = table("entity", "summaryKindEntity");
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ items }) => Result.succeed(items.items),
		queries: {
			items: selectedRows(entity, {
				limit: 100,
				orderBy: [ascending(column(entity, "id"))],
				where: inArray(column(entity, "id"), inputParameters.list("entityIds")),
				selection: {
					id: selectedField(column(entity, "id"), Schema.String),
					entitySchemaSlug: selectedField(column(entity, "entitySchemaSlug"), Schema.String),
				},
			}),
		},
	});
})();
/**
 * Library summaries computed live from the user's history for `entityIds` of one kind. Only the
 * projection processor runs this; readers use `librarySummary` over the stored projection.
 */
const summaryParameters = parameters({
	fields: {
		entityIds: {
			type: "array",
			validation: { required: true },
			label: catalogMessage("query-parameter.entities"),
			description: "Titles whose library state to compute",
			items: {
				type: "string",
				description: "Title ID",
				label: catalogMessage("query-parameter.entity"),
			},
		},
	},
});
export const librarySummarySourceRecipe = (input: { readonly kind: LibrarySummaryKind }) => {
	const entity = table("entity", "summaryEntity");
	const lifecycle = lifecycleOf(input.kind, entity);
	return defineRecipe({
		parameters: summaryParameters.schema,
		map: ({ items }) => Result.succeed(items.items),
		queries: {
			items: selectedRows(entity, {
				limit: 100,
				joins: lifecycle.joins,
				orderBy: [ascending(column(entity, "id"))],
				where: inArray(column(entity, "id"), summaryParameters.list("entityIds")),
				selection: {
					...sharedSummarySelection(entity),
					state: selectedField(lifecycle.state, SummaryRowSchema.state),
					lastActivityAt: selectedField(lifecycle.activity, SummaryRowSchema.lastActivityAt),
					nextAiringDate: selectedField(lifecycle.nextAiring.date, SummaryRowSchema.release),
					nextUpEpisodeId: selectedField(lifecycle.nextUp, SummaryRowSchema.nextUpEpisodeId),
					nextAiringAt: selectedField(lifecycle.nextAiring.instant, SummaryRowSchema.release),
					airedEpisodes: selectedField(
						lifecycle.counts.airedEpisodes,
						SummaryRowSchema.episodeCount,
					),
					watchedEpisodes: selectedField(
						lifecycle.counts.watchedEpisodes,
						SummaryRowSchema.episodeCount,
					),
					nextTrackedAiringDate: selectedField(
						lifecycle.nextTrackedAiring.date,
						SummaryRowSchema.release,
					),
					upcomingEpisodes: selectedField(
						lifecycle.counts.upcomingEpisodes,
						SummaryRowSchema.episodeCount,
					),
					nextTrackedAiringAt: selectedField(
						lifecycle.nextTrackedAiring.instant,
						SummaryRowSchema.release,
					),
					inProgressEpisodes: selectedField(
						lifecycle.counts.inProgressEpisodes,
						SummaryRowSchema.episodeCount,
					),
				},
			}),
		},
	});
};
export type LibrarySummarySourceRow = Recipe.Success<
	ReturnType<typeof librarySummarySourceRecipe>
>[number];
export const librarySummaryProperties = (row: LibrarySummarySourceRow) =>
	Object.fromEntries(
		Object.entries({
			lifecycleState: row.state,
			releaseDate: row.releaseDate,
			nextAiringAt: row.nextAiringAt,
			airedEpisodes: row.airedEpisodes,
			nextAiringDate: row.nextAiringDate,
			lastActivityAt: row.lastActivityAt,
			watchedEpisodes: row.watchedEpisodes,
			nextUpEpisodeId: row.nextUpEpisodeId,
			upcomingEpisodes: row.upcomingEpisodes,
			inProgressEpisodes: row.inProgressEpisodes,
			nextTrackedAiringAt: row.nextTrackedAiringAt,
			nextTrackedAiringDate: row.nextTrackedAiringDate,
		}).filter(([, value]) => value !== null),
	);

export const libraryMembershipJoin = (entity: Table, alias: string) => {
	const membership = table("relationship", alias);
	return {
		membership,
		join: join(
			"inner",
			membership,
			and(
				eq(column(membership, "sourceEntityId"), column(entity, "id")),
				sameSchemaOwner(membership, "relationshipSchemaPluginId", entity),
				eq(column(membership, "relationshipSchemaSlug"), literal("in-media-library")),
			),
		),
	};
};

const summaryRead = (membership: Table, name: string) =>
	jsonPath(column(membership, "projection"), name);

const summaryReleaseArrived = (membership: Table, name: "nextAiring" | "nextTrackedAiring") =>
	releaseHasArrived({
		date: castDate(summaryRead(membership, `${name}Date`)),
		instant: castDate(summaryRead(membership, `${name}At`)),
	});

/** The episode the summary stored as the next to air has aired since the summary was folded. */
const summaryNextAiringPassed = (membership: Table) =>
	summaryReleaseArrived(membership, "nextAiring");

/** An unaired episode the user has progress on has aired since the fold, so that progress counts. */
const summaryTrackedAiringPassed = (membership: Table) =>
	summaryReleaseArrived(membership, "nextTrackedAiring");

/** A stored `caught_up` reads as in progress once the summary's next airing has passed. */
const correctedLifecycleState = (stored: ScalarExpression, nextAiringPassed: Predicate) =>
	conditional(
		and(eq(stored, literal("caught_up")), nextAiringPassed),
		literal("in_progress"),
		stored,
	);

/** The summary is folded; a pending or failed one keeps its last output until a fold writes. */
const summaryReady = (membership: Table) =>
	eq(column(membership, "projectionStatus"), literal("ready"));

/**
 * Library summary values read from a `in-media-library` relationship's projection. A pending
 * projection reads as null. A caught-up title whose next episode has aired reads as in progress.
 */
export const librarySummary = (membership: Table) => {
	const read = (name: string) => summaryRead(membership, name);
	const stored = castText(read("lifecycleState"));
	const event = table("event", "libraryConsumption");
	const own = and(
		eq(column(event, "entityId"), column(membership, "sourceEntityId")),
		eq(column(event, "eventSchemaPluginId"), column(membership, "relationshipSchemaPluginId")),
	);
	const scope = and(own, consumptionRows(event));
	const ready = and(scope, consumptionReady(event));
	const pending = gt(count(event, { where: and(scope, not(consumptionReady(event))) }), literal(0));
	return {
		releaseDate: castDate(read("releaseDate")),
		lastActivityAt: castDate(read("lastActivityAt")),
		lifecycleState: correctedLifecycleState(stored, summaryNextAiringPassed(membership)),
		userRating: averageUserRating(
			"libraryReview",
			column(membership, "sourceEntityId"),
			column(membership, "relationshipSchemaPluginId"),
		),
		timesCompleted: conditional(
			pending,
			literal(null),
			coalesce(
				sum(event, consumptionNumber(event, "titleCompletions"), { where: ready }),
				literal(0),
			),
		),
		lastCompletedAt: conditional(
			pending,
			literal(null),
			maximum(event, castDate(consumptionValue(event, "attribution", "value")), {
				where: and(
					ready,
					gt(consumptionNumber(event, "titleCompletions"), literal(0)),
					eq(castText(consumptionValue(event, "attribution", "kind")), literal("instant")),
				),
			}),
		),
	};
};

/** A value read from `entity`'s own `in-media-library` relationship; null outside the library. */
export const libraryMembershipValue = (
	entity: Table,
	read: (membership: Table) => ScalarExpression,
) => {
	const membership = table("relationship", "summaryMembership");
	return first(membership, {
		select: read(membership),
		orderBy: [ascending(column(membership, "id"))],
		where: and(
			eq(column(membership, "sourceEntityId"), column(entity, "id")),
			sameSchemaOwner(membership, "relationshipSchemaPluginId", entity),
			eq(column(membership, "relationshipSchemaSlug"), literal("in-media-library")),
		),
	});
};

/**
 * A value read from `entity`'s own `in-media-library` link while its summary is ready: null outside
 * the library and while the summary is pending or failed, which keeps the output of its last fold.
 * An aggregate, not `first`, so a row's values fuse into one read of the link and its status.
 */
const readyLibrarySummaryValue = (entity: Table, read: (membership: Table) => ScalarExpression) => {
	const membership = table("relationship", "readySummaryMembership");
	return maximum(membership, read(membership), {
		where: and(
			eq(column(membership, "sourceEntityId"), column(entity, "id")),
			sameSchemaOwner(membership, "relationshipSchemaPluginId", entity),
			eq(column(membership, "relationshipSchemaSlug"), literal("in-media-library")),
			summaryReady(membership),
		),
	});
};

/**
 * Whether `entity`'s ready summary still holds against `passed`, read as its own measure so every
 * stored value it gates shares one check; null outside the library and while not ready.
 */
const readySummaryHolds = (entity: Table, passed: (membership: Table) => Predicate) =>
	eq(
		readyLibrarySummaryValue(entity, (membership) =>
			conditional(passed(membership), literal(0), literal(1)),
		),
		literal(1),
	);

/**
 * The user's own stored progress on `entity`, through its `in-media-library` link: the lifecycle
 * state, corrected like `librarySummary`, and the completed and in-progress episode counts. An airing
 * changes them only when the user has progress on the episode or the state is `caught_up`, which
 * `librarySummary` corrects, so they hold until an episode with progress airs; null outside the
 * library, while the summary is pending or failed, and after that.
 */
export const libraryProgressSummaryValue = (
	entity: Table,
	name: "lifecycleState" | "watchedEpisodes" | "inProgressEpisodes",
) =>
	conditional(
		readySummaryHolds(entity, summaryTrackedAiringPassed),
		name === "lifecycleState"
			? correctedLifecycleState(
					readyLibrarySummaryValue(entity, (membership) => castText(summaryRead(membership, name))),
					not(readySummaryHolds(entity, summaryNextAiringPassed)),
				)
			: readyLibrarySummaryValue(entity, (membership) => castNumber(summaryRead(membership, name))),
		literal(null),
	);

/**
 * A stored episode count of `entity`'s own `in-media-library` link while it still holds: null
 * outside the library, while the summary is pending or failed, and once an episode it counted as
 * upcoming has aired, since airing changes the counts without a fold.
 */
export const currentLibrarySummaryValue = (
	entity: Table,
	name: "airedEpisodes" | "upcomingEpisodes",
) =>
	conditional(
		readySummaryHolds(entity, summaryNextAiringPassed),
		readyLibrarySummaryValue(entity, (membership) => castNumber(summaryRead(membership, name))),
		literal(null),
	);

/**
 * The ID of the episode the user watches next in the title `membership` links: the stored one while
 * the summary is ready and no episode it counted as upcoming has aired, otherwise resolved live.
 */
export const libraryNextUpEpisodeId = (
	config: EpisodicKindConfig,
	membership: Table,
	parent: Table,
	alias: string,
) =>
	conditional(
		or(not(summaryReady(membership)), summaryNextAiringPassed(membership)),
		episodicNextUpId(config, parent, alias),
		castText(summaryRead(membership, "nextUpEpisodeId")),
	);
