import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	average,
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
	inArray,
	IsoDateString,
	join,
	jsonPath,
	literal,
	lte,
	maximum,
	minimum,
	type Recipe,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/plugin-kit/ryotql";

import type { Table } from "./entity-selections";
import {
	episodicEpisodeQuery,
	type EpisodicKindConfig,
	episodicLifecycleExpressions,
	EpisodicLifecycleStateSchema,
	mediaLifecycleExpressions,
	podcastEpisodicKindConfig,
	publishDate,
	sameSchemaOwner,
	showEpisodicKindConfig,
} from "./lifecycle-expressions";
import { flatMediaSchemaSlugs } from "./media-schema-slugs";

export const LIBRARY_SUMMARY_SCRIPT_SLUG = "projection.library-summary";

/** Output of the `in-media-library` projection; absent values are omitted. */
export const librarySummaryPropertiesSchema = {
	unknownKeys: "strict" as const,
	fields: {
		userRating: {
			label: "Your rating",
			type: "number" as const,
			description: "Average of the user's review ratings, 0-100",
		},
		lifecycleState: {
			label: "Status",
			type: "string" as const,
			description: "Lifecycle state computed from the user's history",
		},
		lastCompletedAt: {
			label: "Last completed",
			type: "datetime" as const,
			description: "When the user last completed this item",
		},
		timesCompleted: {
			type: "number" as const,
			label: "Times completed",
			description: "How many times the user completed this item",
		},
		releaseDate: {
			label: "Release date",
			type: "datetime" as const,
			description: "Publish date, else the start of the publish year",
		},
		nextAiringAt: {
			label: "Next airing",
			type: "datetime" as const,
			description: "Earliest publish date of an unaired regular episode",
		},
		lastActivityAt: {
			label: "Recent activity",
			type: "datetime" as const,
			description: "When the user's latest lifecycle activity occurred",
		},
	},
};

const SummaryRowSchema = {
	id: Schema.String,
	timesCompleted: Schema.Finite,
	state: EpisodicLifecycleStateSchema,
	userRating: Schema.NullOr(Schema.Finite),
	releaseDate: Schema.NullOr(IsoDateString),
	nextAiringAt: Schema.NullOr(IsoDateString),
	lastActivityAt: Schema.NullOr(IsoDateString),
	lastCompletedAt: Schema.NullOr(IsoDateString),
};

const property = (entity: Table, name: string) => jsonPath(column(entity, "properties"), name);

const releaseDate = (entity: Table) =>
	coalesce(
		castDate(property(entity, "publishDate")),
		castDate(concat(castText(property(entity, "publishYear")), literal("-01-01T00:00:00.000Z"))),
	);

const userEventsOf = (entity: Table, alias: string, slug: string) => {
	const event = table("event", alias);
	return {
		event,
		where: and(
			eq(column(event, "entityId"), column(entity, "id")),
			sameSchemaOwner(event, "eventSchemaPluginId", entity),
			eq(column(event, "eventSchemaSlug"), literal(slug)),
		),
	};
};

const sharedSummarySelection = (entity: Table) => {
	const completion = userEventsOf(entity, "summaryCompletion", "complete");
	const review = userEventsOf(entity, "summaryReview", "review");
	return {
		id: selectedField(column(entity, "id"), SummaryRowSchema.id),
		releaseDate: selectedField(releaseDate(entity), SummaryRowSchema.releaseDate),
		timesCompleted: selectedField(
			count(completion.event, { where: completion.where }),
			SummaryRowSchema.timesCompleted,
		),
		userRating: selectedField(
			average(review.event, castNumber(property(review.event, "rating")), { where: review.where }),
			SummaryRowSchema.userRating,
		),
		lastCompletedAt: selectedField(
			maximum(completion.event, column(completion.event, "occurredAt"), {
				where: completion.where,
			}),
			SummaryRowSchema.lastCompletedAt,
		),
	};
};

const nextAiringAt = (config: EpisodicKindConfig, parent: Table) => {
	const episode = table("entity", "summaryUpcoming");
	const upcoming = episodicEpisodeQuery(config, parent, episode, "summaryUpcoming", "upcoming");
	return minimum(episode, publishDate(episode), { joins: upcoming.joins, where: upcoming.where });
};

export type LibrarySummaryKind = "flat" | "other" | EpisodicKindConfig;

const flatSlugs = new Set<string>(flatMediaSchemaSlugs);

export const librarySummaryKind = (entitySchemaSlug: string): LibrarySummaryKind =>
	[showEpisodicKindConfig, podcastEpisodicKindConfig].find(
		({ parentSchemaSlug }) => parentSchemaSlug === entitySchemaSlug,
	) ?? (flatSlugs.has(entitySchemaSlug) ? "flat" : "other");

const lifecycleOf = (kind: LibrarySummaryKind, entity: Table) => {
	if (kind === "other") {
		return { activity: literal(null), state: literal("untracked"), nextAiringAt: literal(null) };
	}
	if (kind === "flat") {
		const lifecycle = mediaLifecycleExpressions(entity, "summaryLifecycle");
		return {
			state: lifecycle.state,
			nextAiringAt: literal(null),
			activity: lifecycle.latestSignal.occurredAt,
		};
	}
	const lifecycle = episodicLifecycleExpressions(kind, entity, "summaryLifecycle");
	return {
		state: lifecycle.state,
		nextAiringAt: nextAiringAt(kind, entity),
		activity: lifecycle.latestSignal.occurredAt,
	};
};

/**
 * Library summaries computed live from the user's history for `entityIds` of one kind. Only the
 * projection processor runs this; readers use `librarySummary` over the stored projection.
 */
export const librarySummarySourceRecipe = defineRecipe(
	(input: {
		readonly kind: LibrarySummaryKind;
		readonly entityIds: readonly [string, ...string[]];
	}) => {
		const entity = table("entity", "summaryEntity");
		const lifecycle = lifecycleOf(input.kind, entity);
		return {
			map: ({ items }) => Result.succeed(items.items),
			queries: {
				items: selectedRows(entity, {
					limit: input.entityIds.length,
					orderBy: [ascending(column(entity, "id"))],
					where: inArray(
						column(entity, "id"),
						input.entityIds.map((id) => literal(id)),
					),
					selection: {
						...sharedSummarySelection(entity),
						state: selectedField(lifecycle.state, SummaryRowSchema.state),
						lastActivityAt: selectedField(lifecycle.activity, SummaryRowSchema.lastActivityAt),
						nextAiringAt: selectedField(lifecycle.nextAiringAt, SummaryRowSchema.nextAiringAt),
					},
				}),
			},
		};
	},
);

export type LibrarySummarySourceRow = Recipe.Success<typeof librarySummarySourceRecipe>[number];

/** Projection properties for a computed row, omitting absent values. */
export const librarySummaryProperties = (row: LibrarySummarySourceRow) =>
	Object.fromEntries(
		Object.entries({
			lifecycleState: row.state,
			userRating: row.userRating,
			releaseDate: row.releaseDate,
			nextAiringAt: row.nextAiringAt,
			timesCompleted: row.timesCompleted,
			lastActivityAt: row.lastActivityAt,
			lastCompletedAt: row.lastCompletedAt,
		}).filter(([, value]) => value !== null),
	);

/** Inner join of `entity` to its `in-media-library` relationship, aliased `alias`. */
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

/**
 * Library summary values read from a `in-media-library` relationship's projection. A pending
 * projection reads as null. A caught-up title whose next episode has aired reads as in progress.
 */
export const librarySummary = (membership: Table) => {
	const read = (name: string) => jsonPath(column(membership, "projection"), name);
	const stored = castText(read("lifecycleState"));
	return {
		releaseDate: castDate(read("releaseDate")),
		userRating: castNumber(read("userRating")),
		lastActivityAt: castDate(read("lastActivityAt")),
		lastCompletedAt: castDate(read("lastCompletedAt")),
		timesCompleted: castNumber(read("timesCompleted")),
		lifecycleState: conditional(
			and(eq(stored, literal("caught_up")), lte(castDate(read("nextAiringAt")), currentDate())),
			literal("in_progress"),
			stored,
		),
	};
};
