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
	defineRecipe,
	eq,
	first,
	inArray,
	isNotNull,
	IsoDateString,
	join,
	jsonPath,
	literal,
	parameters,
	type Recipe,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/plugin-kit/ryotql";

import type { Table } from "./entity-selections";
import {
	type EpisodicEpisodeCounts,
	episodicEpisodeCounts,
	type EpisodicKindConfig,
	episodicLifecycleExpressions,
	EpisodicLifecycleStateSchema,
	episodicNewCycleJoin,
	episodicNextRelease,
	episodicNextUpId,
	mediaLifecycleExpressions,
	podcastEpisodicKindConfig,
	type Predicate,
	sameSchemaOwner,
	type ScalarExpression,
	showEpisodicKindConfig,
} from "./lifecycle-expressions";
import { flatMediaSchemaSlugs } from "./media-schema-slugs";
import { catalogMessage } from "./messages.generated";

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
		nextRelease: {
			type: "object" as const,
			unknownKeys: "strict" as const,
			label: catalogMessage("property.next-airing"),
			description: "Release of the first unaired regular episode, when the summary next changes",
			properties: {
				instant: {
					type: "datetime" as const,
					description: "Release instant",
					label: catalogMessage("property.airing-at"),
				},
				date: {
					type: "datetime" as const,
					label: catalogMessage("property.date"),
					description: "Release date of an episode without a release instant",
				},
			},
		},
	},
};

const SummaryRowSchema = {
	id: Schema.String,
	state: EpisodicLifecycleStateSchema,
	release: Schema.NullOr(IsoDateString),
	episodeCount: Schema.NullOr(Schema.Finite),
	nextUpEpisodeId: Schema.NullOr(Schema.String),
};

const property = (entity: Table, name: string) => jsonPath(column(entity, "properties"), name);

export type LibrarySummaryKind = "flat" | "other" | EpisodicKindConfig;

const flatSlugs = new Set<string>(flatMediaSchemaSlugs);

export const librarySummaryKind = (entitySchemaSlug: string): LibrarySummaryKind =>
	[showEpisodicKindConfig, podcastEpisodicKindConfig].find(
		({ parentSchemaSlug }) => parentSchemaSlug === entitySchemaSlug,
	) ?? (flatSlugs.has(entitySchemaSlug) ? "flat" : "other");

/** A library summary as expressions, stored or computed alike. */
type Summary = EpisodicEpisodeCounts & {
	readonly releaseDate: ScalarExpression;
	readonly lifecycleState: ScalarExpression;
	readonly lastActivityAt: ScalarExpression;
	readonly nextUpEpisodeId: ScalarExpression;
	readonly nextRelease: { readonly date: ScalarExpression; readonly instant: ScalarExpression };
};

const noEpisodes = {
	airedEpisodes: literal(null),
	nextUpEpisodeId: literal(null),
	watchedEpisodes: literal(null),
	upcomingEpisodes: literal(null),
	inProgressEpisodes: literal(null),
	nextRelease: { date: literal(null), instant: literal(null) },
};

/**
 * `entity`'s summary computed from the user's history and its episodes. `newCycle` reads whether a
 * new cycle has begun once for every episode; without it each episode reads it.
 */
const computedSummary = (
	kind: LibrarySummaryKind,
	entity: Table,
	alias: string,
	newCycle?: Predicate,
): Summary => {
	const releaseDate = coalesce(
		castDate(property(entity, "publishDate")),
		castDate(concat(castText(property(entity, "publishYear")), literal("-01-01T00:00:00.000Z"))),
	);
	if (kind === "other") {
		return {
			...noEpisodes,
			releaseDate,
			lastActivityAt: literal(null),
			lifecycleState: literal("untracked"),
		};
	}
	if (kind === "flat") {
		const lifecycle = mediaLifecycleExpressions(entity, `${alias}Lifecycle`);
		return {
			...noEpisodes,
			releaseDate,
			lifecycleState: lifecycle.state,
			lastActivityAt: lifecycle.latestSignal.occurredAt,
		};
	}
	const lifecycle = episodicLifecycleExpressions(kind, entity, alias);
	return {
		releaseDate,
		lifecycleState: lifecycle.state,
		lastActivityAt: lifecycle.latestSignal.occurredAt,
		nextRelease: episodicNextRelease(kind, entity, `${alias}NextRelease`),
		nextUpEpisodeId: episodicNextUpId(kind, entity, `${alias}NextUp`, newCycle),
		...episodicEpisodeCounts(kind, entity, alias, lifecycle.aired, newCycle),
	};
};

/**
 * Library summaries computed from the user's history for `entityIds` of one kind. Only the fold runs
 * this; readers use `librarySummary` over the stored projection.
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
	const cycle =
		typeof input.kind === "object" ? episodicNewCycleJoin(entity, "summaryCycle") : null;
	const summary = computedSummary(input.kind, entity, "summary", cycle?.newCycle);
	const count = (value: ScalarExpression) => selectedField(value, SummaryRowSchema.episodeCount);
	return defineRecipe({
		parameters: summaryParameters.schema,
		map: ({ items }) => Result.succeed(items.items),
		queries: {
			items: selectedRows(entity, {
				limit: 100,
				joins: cycle === null ? [] : [cycle.join],
				orderBy: [ascending(column(entity, "id"))],
				where: inArray(column(entity, "id"), summaryParameters.list("entityIds")),
				selection: {
					airedEpisodes: count(summary.airedEpisodes),
					watchedEpisodes: count(summary.watchedEpisodes),
					upcomingEpisodes: count(summary.upcomingEpisodes),
					inProgressEpisodes: count(summary.inProgressEpisodes),
					id: selectedField(column(entity, "id"), SummaryRowSchema.id),
					state: selectedField(summary.lifecycleState, SummaryRowSchema.state),
					releaseDate: selectedField(summary.releaseDate, SummaryRowSchema.release),
					lastActivityAt: selectedField(summary.lastActivityAt, SummaryRowSchema.release),
					nextReleaseDate: selectedField(summary.nextRelease.date, SummaryRowSchema.release),
					nextReleaseAt: selectedField(summary.nextRelease.instant, SummaryRowSchema.release),
					nextUpEpisodeId: selectedField(summary.nextUpEpisodeId, SummaryRowSchema.nextUpEpisodeId),
				},
			}),
		},
	});
};
export type LibrarySummarySourceRow = Recipe.Success<
	ReturnType<typeof librarySummarySourceRecipe>
>[number];

/** The release the summary next changes at, as the fold stores it: its instant, else its date. */
export const librarySummaryNextRelease = (
	row: LibrarySummarySourceRow,
): null | { readonly date: string } | { readonly instant: string } => {
	if (row.nextReleaseAt !== null) {
		return { instant: row.nextReleaseAt };
	}
	return row.nextReleaseDate === null ? null : { date: row.nextReleaseDate };
};

export const librarySummaryProperties = (row: LibrarySummarySourceRow) => {
	const nextRelease = librarySummaryNextRelease(row);
	return {
		...Object.fromEntries(
			Object.entries({
				lifecycleState: row.state,
				releaseDate: row.releaseDate,
				airedEpisodes: row.airedEpisodes,
				lastActivityAt: row.lastActivityAt,
				watchedEpisodes: row.watchedEpisodes,
				nextUpEpisodeId: row.nextUpEpisodeId,
				upcomingEpisodes: row.upcomingEpisodes,
				inProgressEpisodes: row.inProgressEpisodes,
			}).filter(([, value]) => value !== null),
		),
		...(nextRelease === null ? {} : { nextRelease }),
	};
};

const libraryLinkWhere = (membership: Table, entity: Table) =>
	and(
		eq(column(membership, "sourceEntityId"), column(entity, "id")),
		sameSchemaOwner(membership, "relationshipSchemaPluginId", entity),
		eq(column(membership, "relationshipSchemaSlug"), literal("in-media-library")),
	);

export const libraryMembershipJoin = (entity: Table, alias: string) => {
	const membership = table("relationship", alias);
	return { membership, join: join("inner", membership, libraryLinkWhere(membership, entity)) };
};

/** A value read from `entity`'s own `in-media-library` relationship; null outside the library. */
export const libraryMembershipValue = (
	entity: Table,
	read: (membership: Table) => ScalarExpression,
) => {
	const membership = table("relationship", "summaryMembership");
	return first(membership, {
		select: read(membership),
		where: libraryLinkWhere(membership, entity),
		orderBy: [ascending(column(membership, "id"))],
	});
};

/** How a query reaches a title's `in-media-library` link: one it joins, or the title's own. */
export type LibraryLink = (read: (membership: Table) => ScalarExpression) => ScalarExpression;

export const joinedLibraryLink =
	(membership: Table): LibraryLink =>
	(read) =>
		read(membership);

export const ownLibraryLink =
	(entity: Table): LibraryLink =>
	(read) =>
		libraryMembershipValue(entity, read);

/** Builds a summary whose every field is `field` of the summary that `pick` reads that field from. */
const summaryFields = (
	field: (pick: (summary: Summary) => ScalarExpression) => ScalarExpression,
): Summary => ({
	releaseDate: field((summary) => summary.releaseDate),
	airedEpisodes: field((summary) => summary.airedEpisodes),
	lifecycleState: field((summary) => summary.lifecycleState),
	lastActivityAt: field((summary) => summary.lastActivityAt),
	nextUpEpisodeId: field((summary) => summary.nextUpEpisodeId),
	watchedEpisodes: field((summary) => summary.watchedEpisodes),
	upcomingEpisodes: field((summary) => summary.upcomingEpisodes),
	inProgressEpisodes: field((summary) => summary.inProgressEpisodes),
	nextRelease: {
		date: field((summary) => summary.nextRelease.date),
		instant: field((summary) => summary.nextRelease.instant),
	},
});

type SummaryFieldName = keyof typeof librarySummaryPropertiesSchema.fields;

/** A stored summary field as the fold wrote it, such as a date in the text it was stored as. */
export const storedLibrarySummaryValue = (
	link: LibraryLink,
	name: SummaryFieldName,
	...path: readonly string[]
) => link((membership) => jsonPath(column(membership, "projection"), name, ...path));

/** The summary a link stores; every field is null before the title's first fold. */
const storedSummary = (membership: Table): Summary => {
	const read = (name: SummaryFieldName, ...path: readonly string[]) =>
		jsonPath(column(membership, "projection"), name, ...path);
	return {
		releaseDate: castDate(read("releaseDate")),
		lifecycleState: castText(read("lifecycleState")),
		lastActivityAt: castDate(read("lastActivityAt")),
		airedEpisodes: castNumber(read("airedEpisodes")),
		nextUpEpisodeId: castText(read("nextUpEpisodeId")),
		watchedEpisodes: castNumber(read("watchedEpisodes")),
		upcomingEpisodes: castNumber(read("upcomingEpisodes")),
		inProgressEpisodes: castNumber(read("inProgressEpisodes")),
		nextRelease: {
			date: castDate(read("nextRelease", "date")),
			instant: castDate(read("nextRelease", "instant")),
		},
	};
};

/**
 * A title's library summary. Once the title has folded, its link stores one, which holds while the
 * summary is pending or failed and which the fold refreshes when its next release arrives. Until then,
 * and outside the library, `computed` gives the summary the fold would store, from the user's history
 * and the title's episodes; without it, such a summary reads as null, as a query that cannot read the
 * clock needs.
 */
export const librarySummary = (
	link: LibraryLink,
	computed?: { readonly entity: Table; readonly alias: string; readonly kind: LibrarySummaryKind },
): Summary => {
	const stored = (pick: (summary: Summary) => ScalarExpression) =>
		link((membership) => pick(storedSummary(membership)));
	if (computed === undefined) {
		return summaryFields(stored);
	}
	const live = computedSummary(computed.kind, computed.entity, computed.alias);
	const folded = isNotNull(stored((summary) => summary.lifecycleState));
	return summaryFields((pick) => conditional(folded, stored(pick), pick(live)));
};
