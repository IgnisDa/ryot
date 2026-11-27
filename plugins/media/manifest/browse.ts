import type { AuthoredBrowseField } from "@ryot-app/contract/modules/filters/browse";
import type {
	AuthoredAppSchema,
	ManifestText,
} from "@ryot-app/contract/modules/plugins/manifest-text";
import type { ScalarExpression } from "@ryot-app/contract/modules/ryotql/authored";
import { RelationshipSchemaSlug } from "@ryot-app/contract/schema/brands";
import {
	and,
	ascending,
	castBoolean,
	castDate,
	castNumber,
	castText,
	coalesce,
	column,
	conditional,
	countDistinct,
	eq,
	first,
	inArray,
	isNull,
	jsonPath,
	literal,
	table,
} from "@ryot-app/ryotql";

import { libraryLinkExists, type Table } from "../shared/entity-selections";
import { libraryMembershipValue, librarySummary } from "../shared/library-summary";
import { sameSchemaOwner } from "../shared/lifecycle-expressions";
import { mediaHasCopies } from "../shared/media-copy-recipes";
import { builtinMediaEntitySchemaSlugs, mediaGroupMemberSlugs } from "../shared/media-schema-slugs";
import { catalogMessage } from "../shared/messages.generated";
import { averageUserRating } from "../shared/user-rating";
import { mediaProviders } from "./providers";

const subject = table("entity", "subject");

const property = (name: string) => jsonPath(column(subject, "properties"), name);

const summary = (read: (value: ReturnType<typeof librarySummary>) => ScalarExpression) =>
	libraryMembershipValue(subject, (membership) => read(librarySummary(membership)));

export const creditCount = (entity: Table, slug: "person" | "company") => {
	const credit = table("relationship", "browseCredit");
	return countDistinct(credit, column(credit, "targetEntityId"), {
		where: and(
			sameSchemaOwner(credit, "relationshipSchemaPluginId", entity),
			eq(column(credit, "sourceEntityId"), column(entity, "id")),
			inArray(
				column(credit, "relationshipSchemaSlug"),
				[...builtinMediaEntitySchemaSlugs, ...Object.keys(mediaGroupMemberSlugs)].map((mediaSlug) =>
					literal(`${slug}-to-${mediaSlug}`),
				),
			),
		),
	});
};

export const recentActivity = (entity: Table) =>
	libraryMembershipValue(entity, (membership) => librarySummary(membership).lastActivityAt);

const sourceField = (slug: string): AuthoredBrowseField => {
	const provider = table("sandboxProvider", "browseProvider");
	return {
		type: "enum",
		key: "source",
		kind: "value",
		label: catalogMessage("property.source"),
		choices: [
			{ value: "custom", label: catalogMessage("browse.source.custom") },
			...mediaProviders
				.filter(({ rootEntitySchemaSlug }) => rootEntitySchemaSlug === slug)
				.map(({ name, slug: value }) => ({ value, label: name })),
		],
		expression: conditional(
			isNull(column(subject, "providerId")),
			literal("custom"),
			first(provider, {
				select: column(provider, "slug"),
				orderBy: [ascending(column(provider, "id"))],
				where: eq(column(provider, "id"), column(subject, "providerId")),
			}),
		),
	};
};

const subjectUserRating = () =>
	averageUserRating("browseReview", column(subject, "id"), column(subject, "entitySchemaPluginId"));

const userRatingField = (expression: ScalarExpression): AuthoredBrowseField => ({
	expression,
	kind: "value",
	type: "rating",
	key: "userRating",
	label: catalogMessage("browse.field.user-rating"),
	sort: {
		defaultDirection: "desc",
		label: catalogMessage("browse.field.user-rating"),
		ascending: catalogMessage("browse.sort.lowest-first"),
		descending: catalogMessage("browse.sort.highest-first"),
	},
});

type Choice = { readonly value: string; readonly label: ManifestText };

const statusChoices = (slug: string): readonly [Choice, ...Choice[]] => [
	{ value: "untracked", label: catalogMessage("browse.status.untracked") },
	{ value: "backlog", label: catalogMessage("browse.status.backlog") },
	{ value: "in_progress", label: catalogMessage("browse.status.in-progress") },
	{ value: "on_hold", label: catalogMessage("browse.status.on-hold") },
	{ value: "dropped", label: catalogMessage("event-schema.dropped.name") },
	...(slug === "show" || slug === "podcast"
		? [{ value: "caught_up", label: catalogMessage("browse.status.caught-up") }]
		: []),
	{ value: "complete", label: catalogMessage("browse.status.complete") },
];

const propertyFields = (propertiesSchema: AuthoredAppSchema): readonly AuthoredBrowseField[] => {
	const fields = propertiesSchema.fields;
	return [
		...("publishYear" in fields
			? [
					{
						kind: "value",
						type: "number",
						key: "publishYear",
						label: catalogMessage("property.publish-year"),
						expression: castNumber(property("publishYear")),
					} as const,
				]
			: []),
		...("providerRating" in fields
			? [
					{
						kind: "value",
						type: "number",
						key: "providerRating",
						label: catalogMessage("property.provider-rating"),
						expression: castNumber(property("providerRating")),
						sort: {
							defaultDirection: "desc",
							label: catalogMessage("property.provider-rating"),
							ascending: catalogMessage("browse.sort.lowest-first"),
							descending: catalogMessage("browse.sort.highest-first"),
						},
					} as const,
				]
			: []),
		...("isNsfw" in fields
			? [
					{
						kind: "value",
						type: "boolean",
						key: "adultContent",
						expression: castBoolean(property("isNsfw")),
						label: catalogMessage("property.adult-content"),
					} as const,
				]
			: []),
	];
};

const titleFields = (
	slug: string,
	propertiesSchema: AuthoredAppSchema,
): readonly AuthoredBrowseField[] => [
	{
		type: "enum",
		key: "status",
		kind: "value",
		choices: statusChoices(slug),
		label: catalogMessage("property.status"),
		expression: coalesce(castText(summary((value) => value.lifecycleState)), literal("untracked")),
	},
	{
		kind: "value",
		type: "number",
		key: "timesCompleted",
		label: catalogMessage("browse.field.times-completed"),
		expression: coalesce(castNumber(summary((value) => value.timesCompleted)), literal(0)),
		sort: {
			defaultDirection: "desc",
			descending: catalogMessage("browse.sort.most-first"),
			label: catalogMessage("browse.field.times-completed"),
			ascending: catalogMessage("browse.sort.fewest-first"),
		},
	},
	userRatingField(castNumber(summary((value) => value.userRating))),
	{
		type: "date",
		kind: "value",
		key: "lastCompletedAt",
		label: catalogMessage("browse.field.last-completed"),
		expression: summary((value) => value.lastCompletedAt),
		sort: {
			defaultDirection: "desc",
			label: catalogMessage("browse.field.last-completed"),
			ascending: catalogMessage("browse.sort.oldest-first"),
			descending: catalogMessage("browse.sort.newest-first"),
		},
	},
	{
		type: "date",
		kind: "value",
		key: "lastActivityAt",
		expression: recentActivity(subject),
		label: catalogMessage("property.recent-activity"),
		sort: {
			defaultDirection: "desc",
			label: catalogMessage("browse.field.activity"),
			ascending: catalogMessage("browse.sort.oldest-first"),
			descending: catalogMessage("browse.sort.newest-first"),
		},
	},
	{
		type: "date",
		kind: "value",
		key: "releaseDate",
		label: catalogMessage("property.release-date"),
		expression: summary((value) => value.releaseDate),
		sort: {
			defaultDirection: "desc",
			label: catalogMessage("property.release-date"),
			ascending: catalogMessage("browse.sort.oldest-first"),
			descending: catalogMessage("browse.sort.newest-first"),
		},
	},
	{
		type: "date",
		kind: "value",
		key: "addedAt",
		label: catalogMessage("browse.field.added-at"),
		expression: libraryMembershipValue(subject, (membership) => column(membership, "createdAt")),
		sort: {
			defaultDirection: "desc",
			label: catalogMessage("browse.field.added-at"),
			ascending: catalogMessage("browse.sort.oldest-first"),
			descending: catalogMessage("browse.sort.newest-first"),
		},
	},
	sourceField(slug),
	...propertyFields(propertiesSchema),
	{
		key: "genres",
		kind: "relationship",
		direction: "outgoing",
		label: catalogMessage("browse.field.genres"),
		relationship: {
			owner: { kind: "self" },
			slug: RelationshipSchemaSlug.make(`${slug}-to-genre`),
		},
	},
	{
		key: "owned",
		kind: "value",
		type: "boolean",
		expression: mediaHasCopies(subject),
		label: catalogMessage("property.owned"),
	},
	{
		kind: "value",
		type: "boolean",
		key: "monitored",
		label: catalogMessage("browse.field.monitored"),
		expression: libraryLinkExists(subject, "browseMonitoring", "media-monitoring"),
	},
];

const creatorFields = (slug: "person" | "company"): readonly AuthoredBrowseField[] => [
	sourceField(slug),
	userRatingField(subjectUserRating()),
	slug === "person"
		? {
				type: "date",
				kind: "value",
				key: "birthDate",
				expression: castDate(property("birthDate")),
				label: catalogMessage("property.birth-date"),
				sort: {
					defaultDirection: "desc",
					label: catalogMessage("property.birth-date"),
					ascending: catalogMessage("browse.sort.oldest-first"),
					descending: catalogMessage("browse.sort.newest-first"),
				},
			}
		: {
				kind: "value",
				type: "number",
				key: "foundedYear",
				label: catalogMessage("property.founded-year"),
				expression: castNumber(property("foundedYear")),
				sort: {
					defaultDirection: "desc",
					label: catalogMessage("property.founded-year"),
					ascending: catalogMessage("browse.sort.oldest-first"),
					descending: catalogMessage("browse.sort.newest-first"),
				},
			},
	{
		kind: "sort",
		key: "credits",
		expression: creditCount(subject, slug),
		sort: {
			defaultDirection: "desc",
			label: catalogMessage("browse.field.credits"),
			descending: catalogMessage("browse.sort.most-first"),
			ascending: catalogMessage("browse.sort.fewest-first"),
		},
	},
];

export const groupParts = (entity: Table) =>
	castNumber(jsonPath(column(entity, "properties"), "parts"));

const groupFields = (slug: string): readonly AuthoredBrowseField[] => [
	sourceField(slug),
	userRatingField(subjectUserRating()),
	{
		key: "parts",
		kind: "value",
		type: "number",
		expression: groupParts(subject),
		label: catalogMessage("property.parts"),
		sort: {
			defaultDirection: "desc",
			label: catalogMessage("property.parts"),
			descending: catalogMessage("browse.sort.most-first"),
			ascending: catalogMessage("browse.sort.fewest-first"),
		},
	},
];

export const mediaBrowse = (schema: {
	readonly slug: string;
	readonly propertiesSchema: AuthoredAppSchema;
}) => {
	if (schema.slug === "person" || schema.slug === "company") {
		return { fields: creatorFields(schema.slug) };
	}
	if (Object.hasOwn(mediaGroupMemberSlugs, schema.slug)) {
		return { fields: groupFields(schema.slug) };
	}
	if (builtinMediaEntitySchemaSlugs.some((slug) => slug === schema.slug)) {
		return { fields: titleFields(schema.slug, schema.propertiesSchema) };
	}
	return undefined;
};
