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
	currentDate,
	defineRecipe,
	eq,
	exists,
	first,
	gt,
	inArray,
	IsoDateString,
	join,
	jsonPath,
	literal,
	lte,
	maximum,
	minimum,
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
	type EpisodicEpisodeCounts,
	episodicEpisodeCounts,
	episodicEpisodeQuery,
	type EpisodicKindConfig,
	episodicLifecycleExpressions,
	EpisodicLifecycleStateSchema,
	episodicNextUpId,
	eventSlugIsOneOf,
	lifecycleEventSlugs,
	mediaLifecycleExpressions,
	podcastEpisodicKindConfig,
	publishDate,
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
			description: "Earliest publish date of an unaired regular episode",
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
		nextTrackedAiringAt: {
			type: "datetime" as const,
			label: catalogMessage("property.next-tracked-airing"),
			description: "Earliest publish date of an unaired regular episode the user has progress on",
		},
	},
};

const SummaryRowSchema = {
	id: Schema.String,
	state: EpisodicLifecycleStateSchema,
	releaseDate: Schema.NullOr(IsoDateString),
	nextAiringAt: Schema.NullOr(IsoDateString),
	episodeCount: Schema.NullOr(Schema.Finite),
	lastActivityAt: Schema.NullOr(IsoDateString),
	nextUpEpisodeId: Schema.NullOr(Schema.String),
	nextTrackedAiringAt: Schema.NullOr(IsoDateString),
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

const nextAiringAt = (config: EpisodicKindConfig, parent: Table) => {
	const episode = table("entity", "summaryUpcoming");
	const upcoming = episodicEpisodeQuery(config, parent, episode, "summaryUpcoming", "upcoming");
	return minimum(episode, publishDate(episode), { joins: upcoming.joins, where: upcoming.where });
};

const nextTrackedAiringAt = (config: EpisodicKindConfig, parent: Table) => {
	const episode = table("entity", "summaryTracked");
	const event = table("event", "summaryTrackedEvent");
	const upcoming = episodicEpisodeQuery(config, parent, episode, "summaryTracked", "upcoming");
	return minimum(episode, publishDate(episode), {
		joins: upcoming.joins,
		where: and(
			upcoming.where,
			exists(event, {
				where: and(
					eq(column(event, "entityId"), column(episode, "id")),
					sameSchemaOwner(event, "eventSchemaPluginId", episode),
					eventSlugIsOneOf(event, lifecycleEventSlugs),
				),
			}),
		),
	});
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

const lifecycleOf = (kind: LibrarySummaryKind, entity: Table) => {
	if (kind === "other") {
		return {
			nextUp: literal(null),
			activity: literal(null),
			counts: noEpisodeCounts,
			state: literal("untracked"),
			nextAiringAt: literal(null),
			nextTrackedAiringAt: literal(null),
		};
	}
	if (kind === "flat") {
		const lifecycle = mediaLifecycleExpressions(entity, "summaryLifecycle");
		return {
			nextUp: literal(null),
			state: lifecycle.state,
			counts: noEpisodeCounts,
			nextAiringAt: literal(null),
			nextTrackedAiringAt: literal(null),
			activity: lifecycle.latestSignal.occurredAt,
		};
	}
	const lifecycle = episodicLifecycleExpressions(kind, entity, "summaryLifecycle");
	return {
		state: lifecycle.state,
		nextAiringAt: nextAiringAt(kind, entity),
		activity: lifecycle.latestSignal.occurredAt,
		nextTrackedAiringAt: nextTrackedAiringAt(kind, entity),
		nextUp: episodicNextUpId(kind, entity, "summaryNextUp"),
		counts: episodicEpisodeCounts(kind, entity, "summaryCount"),
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
				orderBy: [ascending(column(entity, "id"))],
				where: inArray(column(entity, "id"), summaryParameters.list("entityIds")),
				selection: {
					...sharedSummarySelection(entity),
					state: selectedField(lifecycle.state, SummaryRowSchema.state),
					lastActivityAt: selectedField(lifecycle.activity, SummaryRowSchema.lastActivityAt),
					nextAiringAt: selectedField(lifecycle.nextAiringAt, SummaryRowSchema.nextAiringAt),
					nextUpEpisodeId: selectedField(lifecycle.nextUp, SummaryRowSchema.nextUpEpisodeId),
					airedEpisodes: selectedField(
						lifecycle.counts.airedEpisodes,
						SummaryRowSchema.episodeCount,
					),
					watchedEpisodes: selectedField(
						lifecycle.counts.watchedEpisodes,
						SummaryRowSchema.episodeCount,
					),
					upcomingEpisodes: selectedField(
						lifecycle.counts.upcomingEpisodes,
						SummaryRowSchema.episodeCount,
					),
					inProgressEpisodes: selectedField(
						lifecycle.counts.inProgressEpisodes,
						SummaryRowSchema.episodeCount,
					),
					nextTrackedAiringAt: selectedField(
						lifecycle.nextTrackedAiringAt,
						SummaryRowSchema.nextTrackedAiringAt,
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
			lastActivityAt: row.lastActivityAt,
			watchedEpisodes: row.watchedEpisodes,
			nextUpEpisodeId: row.nextUpEpisodeId,
			upcomingEpisodes: row.upcomingEpisodes,
			inProgressEpisodes: row.inProgressEpisodes,
			nextTrackedAiringAt: row.nextTrackedAiringAt,
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

/** The episode the summary stored as the next to air has aired since the summary was folded. */
const summaryNextAiringPassed = (membership: Table) =>
	lte(castDate(summaryRead(membership, "nextAiringAt")), currentDate());

/** An unaired episode the user has progress on has aired since the fold, so that progress counts. */
const summaryTrackedAiringPassed = (membership: Table) =>
	lte(castDate(summaryRead(membership, "nextTrackedAiringAt")), currentDate());

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
		userRating: averageUserRating(
			"libraryReview",
			column(membership, "sourceEntityId"),
			column(membership, "relationshipSchemaPluginId"),
		),
		lifecycleState: conditional(
			and(eq(stored, literal("caught_up")), summaryNextAiringPassed(membership)),
			literal("in_progress"),
			stored,
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
 * The user's own stored progress on `entity`, through its `in-media-library` link: the lifecycle
 * state, corrected like `librarySummary`, and the completed and in-progress episode counts. An airing
 * changes them only when the user has progress on the episode, so they hold until such an episode
 * airs; null outside the library, while the summary is pending or failed, and after that.
 */
export const libraryProgressSummaryValue = (
	entity: Table,
	name: "lifecycleState" | "watchedEpisodes" | "inProgressEpisodes",
) =>
	readyLibrarySummaryValue(entity, (membership) =>
		conditional(
			summaryTrackedAiringPassed(membership),
			literal(null),
			name === "lifecycleState"
				? librarySummary(membership).lifecycleState
				: castNumber(summaryRead(membership, name)),
		),
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
	readyLibrarySummaryValue(entity, (membership) =>
		conditional(
			summaryNextAiringPassed(membership),
			literal(null),
			castNumber(summaryRead(membership, name)),
		),
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
