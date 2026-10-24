import type { AuthoredBrowseField } from "@ryot-app/contract/modules/filters/browse";
import type { ScalarExpression } from "@ryot-app/contract/modules/ryotql/language";
import { RelationshipSchemaSlug } from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import {
	and,
	ascending,
	average,
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
import { builtinMediaEntitySchemaSlugs, mediaGroupMemberSlugs } from "../shared/media-schema-slugs";
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
		label: "Source",
		choices: [
			{ value: "custom", label: "Custom" },
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

const reviewRating = () => {
	const review = table("event", "browseReview");
	return average(review, castNumber(jsonPath(column(review, "properties"), "rating")), {
		where: and(
			eq(column(review, "entityId"), column(subject, "id")),
			sameSchemaOwner(review, "eventSchemaPluginId", subject),
			eq(column(review, "eventSchemaSlug"), literal("review")),
		),
	});
};

const userRatingField = (expression: ScalarExpression): AuthoredBrowseField => ({
	expression,
	kind: "value",
	type: "number",
	key: "userRating",
	label: "Your rating",
	sort: { ascending: "Lowest rated", descending: "Highest rated" },
});

type Choice = { readonly value: string; readonly label: string };

const statusChoices = (slug: string): readonly [Choice, ...Choice[]] => [
	{ value: "untracked", label: "Not tracked" },
	{ value: "backlog", label: "Planned" },
	{ value: "in_progress", label: "In progress" },
	{ value: "on_hold", label: "On hold" },
	{ value: "dropped", label: "Dropped" },
	...(slug === "show" || slug === "podcast" ? [{ value: "caught_up", label: "Caught up" }] : []),
	{ value: "complete", label: "Completed" },
];

const propertyFields = (propertiesSchema: AppSchema): readonly AuthoredBrowseField[] => {
	const fields = propertiesSchema.fields;
	return [
		...("publishYear" in fields
			? [
					{
						kind: "value",
						type: "number",
						key: "publishYear",
						label: "Publish year",
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
						label: "Provider rating",
						expression: castNumber(property("providerRating")),
						sort: { ascending: "Lowest provider rating", descending: "Highest provider rating" },
					} as const,
				]
			: []),
		...("isNsfw" in fields
			? [
					{
						kind: "value",
						type: "boolean",
						key: "adultContent",
						label: "Adult content",
						expression: castBoolean(property("isNsfw")),
					} as const,
				]
			: []),
	];
};

const titleFields = (slug: string, propertiesSchema: AppSchema): readonly AuthoredBrowseField[] => [
	{
		type: "enum",
		key: "status",
		kind: "value",
		label: "Status",
		choices: statusChoices(slug),
		expression: coalesce(castText(summary((value) => value.lifecycleState)), literal("untracked")),
	},
	{
		kind: "value",
		type: "number",
		key: "timesCompleted",
		label: "Times completed",
		sort: { descending: "Most completions", ascending: "Fewest completions" },
		expression: coalesce(castNumber(summary((value) => value.timesCompleted)), literal(0)),
	},
	userRatingField(castNumber(summary((value) => value.userRating))),
	{
		type: "date",
		kind: "value",
		key: "lastCompletedAt",
		label: "Last completed",
		expression: summary((value) => value.lastCompletedAt),
		sort: { ascending: "Earliest completed", descending: "Recently completed" },
	},
	{
		type: "date",
		kind: "value",
		key: "lastActivityAt",
		label: "Recent activity",
		expression: recentActivity(subject),
		sort: { ascending: "Oldest activity", descending: "Recent activity" },
	},
	{
		type: "date",
		kind: "value",
		key: "releaseDate",
		label: "Release date",
		expression: summary((value) => value.releaseDate),
		sort: { ascending: "Oldest release", descending: "Newest release" },
	},
	{
		type: "date",
		kind: "value",
		key: "addedAt",
		label: "Date added to library",
		sort: { ascending: "Oldest added", descending: "Recently added" },
		expression: libraryMembershipValue(subject, (membership) => column(membership, "createdAt")),
	},
	sourceField(slug),
	...propertyFields(propertiesSchema),
	{
		key: "genres",
		label: "Genres",
		kind: "relationship",
		direction: "outgoing",
		relationship: {
			owner: { kind: "self" },
			slug: RelationshipSchemaSlug.make(`${slug}-to-genre`),
		},
	},
	{
		key: "owned",
		kind: "value",
		label: "Owned",
		type: "boolean",
		expression: coalesce(
			libraryMembershipValue(subject, (membership) =>
				castBoolean(jsonPath(column(membership, "properties"), "owned")),
			),
			literal(false),
		),
	},
	{
		kind: "value",
		type: "boolean",
		key: "monitored",
		label: "Monitored",
		expression: libraryLinkExists(subject, "browseMonitoring", "media-monitoring"),
	},
];

const creatorFields = (slug: "person" | "company"): readonly AuthoredBrowseField[] => [
	sourceField(slug),
	userRatingField(reviewRating()),
	slug === "person"
		? {
				type: "date",
				kind: "value",
				key: "birthDate",
				label: "Birth date",
				expression: castDate(property("birthDate")),
				sort: { ascending: "Oldest", descending: "Youngest" },
			}
		: {
				kind: "value",
				type: "number",
				key: "foundedYear",
				label: "Founded year",
				expression: castNumber(property("foundedYear")),
				sort: { ascending: "Oldest founded", descending: "Newest founded" },
			},
	{
		kind: "sort",
		key: "credits",
		expression: creditCount(subject, slug),
		sort: { descending: "Most credits", ascending: "Fewest credits" },
	},
];

export const groupParts = (entity: Table) =>
	castNumber(jsonPath(column(entity, "properties"), "parts"));

const groupFields = (slug: string): readonly AuthoredBrowseField[] => [
	sourceField(slug),
	userRatingField(reviewRating()),
	{
		key: "parts",
		kind: "value",
		label: "Parts",
		type: "number",
		expression: groupParts(subject),
		sort: { descending: "Most parts", ascending: "Fewest parts" },
	},
];

export const mediaBrowse = (schema: {
	readonly slug: string;
	readonly propertiesSchema: AppSchema;
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
