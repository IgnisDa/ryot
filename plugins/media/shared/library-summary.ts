import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	castDate,
	castText,
	coalesce,
	column,
	concat,
	conditional,
	count,
	defineRecipe,
	eq,
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
	episodeReleaseOrder,
	episodeReleaseTime,
	episodicEpisodeQuery,
	type EpisodicKindConfig,
	episodicLifecycleExpressions,
	EpisodicLifecycleStateSchema,
	mediaLifecycleExpressions,
	podcastEpisodicKindConfig,
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
		nextAiringEpisodeId: {
			type: "string" as const,
			label: catalogMessage("property.episode"),
			description: "Identity of the next episode",
		},
		nextAiringAt: {
			type: "datetime" as const,
			label: catalogMessage("property.next-airing"),
			description: "Exact release instant for the next episode",
		},
		lifecycleState: {
			type: "string" as const,
			label: catalogMessage("property.status"),
			description: "Lifecycle state computed from the user's history",
		},
		releaseDate: {
			type: "datetime" as const,
			label: catalogMessage("property.release-date"),
			description: "Publish date, else the start of the publish year",
		},
		nextAiringDate: {
			type: "datetime" as const,
			label: catalogMessage("property.next-airing"),
			description: "Date for the next episode when its airtime is unknown",
		},
		lastActivityAt: {
			type: "datetime" as const,
			label: catalogMessage("property.recent-activity"),
			description: "When the user's latest lifecycle activity occurred",
		},
	},
};

const SummaryRowSchema = {
	id: Schema.String,
	state: EpisodicLifecycleStateSchema,
	releaseDate: Schema.NullOr(IsoDateString),
	nextAiringAt: Schema.NullOr(IsoDateString),
	nextAiringDate: Schema.NullOr(IsoDateString),
	lastActivityAt: Schema.NullOr(IsoDateString),
	nextAiringEpisodeId: Schema.NullOr(Schema.String),
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

const nextAiring = (config: EpisodicKindConfig, parent: Table) => {
	const episode = table("entity", "summaryUpcoming");
	const { joins, where } = episodicEpisodeQuery(
		config,
		parent,
		episode,
		"summaryUpcoming",
		"upcoming",
	);
	const { date, instant } = episodeReleaseTime(episode);
	const id = column(episode, "id");
	const select = (value: ScalarExpression) =>
		first(episode, {
			joins,
			where,
			select: value,
			orderBy: [...episodeReleaseOrder(episode), ascending(id)],
		});
	return {
		nextAiringAt: select(instant),
		nextAiringEpisodeId: select(id),
		nextAiringDate: select(conditional(isNull(instant), date, literal(null))),
	};
};

const noNextAiring = {
	nextAiringAt: literal(null),
	nextAiringDate: literal(null),
	nextAiringEpisodeId: literal(null),
};

export type LibrarySummaryKind = "flat" | "other" | EpisodicKindConfig;

const flatSlugs = new Set<string>(flatMediaSchemaSlugs);

export const librarySummaryKind = (entitySchemaSlug: string): LibrarySummaryKind =>
	[showEpisodicKindConfig, podcastEpisodicKindConfig].find(
		({ parentSchemaSlug }) => parentSchemaSlug === entitySchemaSlug,
	) ?? (flatSlugs.has(entitySchemaSlug) ? "flat" : "other");

const lifecycleOf = (kind: LibrarySummaryKind, entity: Table) => {
	if (kind === "other") {
		return { activity: literal(null), state: literal("untracked"), ...noNextAiring };
	}
	if (kind === "flat") {
		const lifecycle = mediaLifecycleExpressions(entity, "summaryLifecycle");
		return { state: lifecycle.state, ...noNextAiring, activity: lifecycle.latestSignal.occurredAt };
	}
	const lifecycle = episodicLifecycleExpressions(kind, entity, "summaryLifecycle");
	return {
		state: lifecycle.state,
		...nextAiring(kind, entity),
		activity: lifecycle.latestSignal.occurredAt,
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
					nextAiringDate: selectedField(lifecycle.nextAiringDate, SummaryRowSchema.nextAiringDate),
					nextAiringEpisodeId: selectedField(
						lifecycle.nextAiringEpisodeId,
						SummaryRowSchema.nextAiringEpisodeId,
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
			nextAiringDate: row.nextAiringDate,
			lastActivityAt: row.lastActivityAt,
			nextAiringEpisodeId: row.nextAiringEpisodeId,
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
		lifecycleState: conditional(
			and(
				eq(stored, literal("caught_up")),
				releaseHasArrived(castDate(read("nextAiringDate")), castDate(read("nextAiringAt"))),
			),
			literal("in_progress"),
			stored,
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
