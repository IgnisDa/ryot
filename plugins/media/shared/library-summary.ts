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
	episodicEpisodeQuery,
	type EpisodicKindConfig,
	episodicLifecycleExpressions,
	EpisodicLifecycleStateSchema,
	mediaLifecycleExpressions,
	podcastEpisodicKindConfig,
	publishDate,
	sameSchemaOwner,
	type ScalarExpression,
	showEpisodicKindConfig,
} from "./lifecycle-expressions";
import { flatMediaSchemaSlugs } from "./media-schema-slugs";

export const LIBRARY_SUMMARY_SCRIPT_SLUG = "projection.library-summary";

/** Output of the `in-media-library` projection; absent values are omitted. */
export const librarySummaryPropertiesSchema = {
	unknownKeys: "strict" as const,
	fields: {
		lifecycleState: {
			label: "Status",
			type: "string" as const,
			description: "Lifecycle state computed from the user's history",
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
	state: EpisodicLifecycleStateSchema,
	releaseDate: Schema.NullOr(IsoDateString),
	nextAiringAt: Schema.NullOr(IsoDateString),
	lastActivityAt: Schema.NullOr(IsoDateString),
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

export const librarySummaryEntitiesRecipe = defineRecipe(
	(input: { readonly entityIds: readonly [string, ...string[]] }) => {
		const entity = table("entity", "summaryKindEntity");
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
						id: selectedField(column(entity, "id"), Schema.String),
						entitySchemaSlug: selectedField(column(entity, "entitySchemaSlug"), Schema.String),
					},
				}),
			},
		};
	},
);

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

export const librarySummaryProperties = (row: LibrarySummarySourceRow) =>
	Object.fromEntries(
		Object.entries({
			lifecycleState: row.state,
			releaseDate: row.releaseDate,
			nextAiringAt: row.nextAiringAt,
			lastActivityAt: row.lastActivityAt,
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

/**
 * Library summary values read from a `in-media-library` relationship's projection. A pending
 * projection reads as null. A caught-up title whose next episode has aired reads as in progress.
 */
export const librarySummary = (membership: Table) => {
	const read = (name: string) => jsonPath(column(membership, "projection"), name);
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
		userRating: average(event, castNumber(property(event, "rating")), {
			where: and(own, eq(column(event, "eventSchemaSlug"), literal("review"))),
		}),
		lifecycleState: conditional(
			and(eq(stored, literal("caught_up")), lte(castDate(read("nextAiringAt")), currentDate())),
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
