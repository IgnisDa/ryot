import { collectionFieldsToAppSchema } from "@ryot-app/contract/modules/collections/fields";
import type { BrowseField } from "@ryot-app/contract/modules/filters/browse";
import type { Filter } from "@ryot-app/contract/modules/filters/schemas";
import { castNumber, column, count, eq, jsonPath, table } from "@ryot-app/ryotql";
import {
	collectionMembersCountRecipe,
	collectionMembersRecipe,
} from "@ryot-app/ryotql-recipes/collections";
import { DateTime } from "effect";
import { expect, it } from "vitest";

import { savedViewDataSourceAccess, validateRyotQLDocument } from "#modules/ryotql/validator";

const now = DateTime.makeUnsafe("2026-03-10T12:00:00.000Z");
const subject = table("entity", "subject");
const linked = table("relationship", "relationship");

const rating = (property: string): BrowseField => ({
	key: "rating",
	kind: "value",
	type: "number",
	label: "Rating",
	sort: { ascending: "Lowest rated", descending: "Highest rated" },
	expression: castNumber(jsonPath(column(subject, "properties"), property)),
});

const links: BrowseField = {
	key: "links",
	kind: "value",
	type: "number",
	label: "Links",
	sort: { descending: "Most links", ascending: "Fewest links" },
	expression: count(linked, { where: eq(column(linked, "sourceEntityId"), column(subject, "id")) }),
};

const fields = {
	schemas: [
		{ pluginId: null, slug: "collection", browse: { fields: [rating("a"), links] } },
		{ slug: "note", pluginId: null, browse: { fields: [rating("b")] } },
	],
	groups: {
		items: [
			{
				count: 1,
				ownerPluginId: null,
				ownerPluginName: null,
				typeLabel: "Collections",
				entitySchemaSlug: "collection",
			},
		],
	},
	membershipPropertiesSchema: collectionFieldsToAppSchema([
		{ key: "notes", type: "text", label: "Notes", required: false },
		{ key: "score", label: "Score", type: "number", required: false },
	]),
};

const filters: readonly Filter[] = [
	{ operator: "anyOf", field: "member-type", values: ["/collection"] },
	{ values: ["c1"], operator: "anyOf", field: "collections" },
	{ operator: "empty", field: "collections" },
	{ days: 7, field: "date-added", operator: "withinLastDays" },
	{ value: "n", operator: "contains", field: "membership.notes" },
	{ min: 1, max: 5, operator: "between", field: "membership.score" },
	{ field: "rating", operator: "empty" },
	{ value: 2, field: "links", operator: "gte" },
	{
		type: "and",
		filters: [
			{ operator: "noneOf", field: "member-type", values: ["/collection"] },
			{ operator: "notEmpty", field: "membership.score" },
			{ values: ["c1"], operator: "anyOf", field: "collections" },
			{ value: 1, operator: "eq", field: "links" },
		],
	},
];

it("validates collection member and count documents with every filter field", () => {
	for (const filter of filters) {
		const input = { now, filter, fields, searchText: "x", collectionId: "c0" };
		expect(
			validateRyotQLDocument(collectionMembersRecipe(input).document, savedViewDataSourceAccess)
				.error,
			JSON.stringify(filter),
		).toBeNull();
		expect(
			validateRyotQLDocument(
				collectionMembersCountRecipe(input).document,
				savedViewDataSourceAccess,
			).error,
			JSON.stringify(filter),
		).toBeNull();
	}
});

it("validates every collection member sort", () => {
	for (const sort of ["name-asc", "date-added-desc", "rating-desc", "links-asc"]) {
		expect(
			validateRyotQLDocument(
				collectionMembersRecipe({ sort, fields, collectionId: "c0" }).document,
				savedViewDataSourceAccess,
			).error,
			sort,
		).toBeNull();
	}
});
