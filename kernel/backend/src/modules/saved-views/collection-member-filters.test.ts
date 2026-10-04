import { collectionFieldsToAppSchema } from "@ryot-app/contract/modules/collections/fields";
import type { Filter } from "@ryot-app/contract/modules/saved-views/filters";
import {
	collectionMemberFilterFields,
	collectionMembersCountRecipe,
	collectionMembersRecipe,
} from "@ryot-app/ryotql-recipes/collections";
import { DateTime } from "effect";
import { expect, it } from "vitest";

import { savedViewDataSourceAccess, validateRyotQLDocument } from "#modules/ryotql/validator";

const now = DateTime.makeUnsafe("2026-03-10T12:00:00.000Z");
const membershipPropertiesSchema = collectionFieldsToAppSchema([
	{ key: "notes", type: "text", label: "Notes", required: false },
	{ key: "score", label: "Score", type: "number", required: false },
]);
const filterFields = collectionMemberFilterFields({
	membershipPropertiesSchema,
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
});

const filters: readonly Filter[] = [
	{ field: "type", operator: "anyOf", values: ["/collection"] },
	{ values: ["c1"], operator: "anyOf", field: "collections" },
	{ operator: "empty", field: "collections" },
	{ value: "n", operator: "contains", field: "membership.notes" },
	{ min: 1, max: 5, operator: "between", field: "membership.score" },
	{
		type: "and",
		filters: [
			{ field: "type", operator: "noneOf", values: ["/collection"] },
			{ operator: "notEmpty", field: "membership.score" },
		],
	},
];

it("validates collection member and count documents with every filter field", () => {
	for (const filter of filters) {
		const input = { now, filter, filterFields, searchText: "x", collectionId: "c0" };
		expect(
			validateRyotQLDocument(
				collectionMembersRecipe({ ...input, membershipPropertiesSchema }).document,
				savedViewDataSourceAccess,
			),
			JSON.stringify(filter),
		).toBeNull();
		expect(
			validateRyotQLDocument(
				collectionMembersCountRecipe(input).document,
				savedViewDataSourceAccess,
			),
			JSON.stringify(filter),
		).toBeNull();
	}
});
