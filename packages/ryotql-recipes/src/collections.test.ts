import { describe, expect, it } from "bun:test";

import { Result } from "effect";

import {
	collectionArguments,
	collectionControlFields,
	collectionMemberIdsRecipe,
	collectionMembersCountRecipe,
	collectionMembersRecipe,
	collectionPickerRecipe,
} from "./collections";
import { bindRecipe, rowsResponse } from "./test-utils";

const pageInfo = { limit: 20, hasMore: true, nextCursor: "next" };
const member = {
	name: "One",
	properties: {},
	entityId: "one",
	orderRevision: 4,
	ownerPluginId: null,
	ownerPluginName: null,
	"member-type": "/item",
	entitySchemaSlug: "item",
	addedAt: "2026-01-01T00:00:00Z",
	populationStatus: { state: "succeeded", availability: "complete" },
	translationStatus: { state: "succeeded", availability: "complete" },
};

describe("collection request binding", () => {
	it("shares the canonical members projection across selected page/count/id recipes", () => {
		const page = collectionMembersRecipe();
		const count = collectionMembersCountRecipe();
		const ids = collectionMemberIdsRecipe();
		expect(page.query).toBe("members");
		expect(count.query).toBe("count");
		expect(ids.query).toBe("memberIds");
		expect(count.document).toEqual(page.document);
		expect(ids.document).toEqual(page.document);
		expect(page.document.queries["members"]?.from).toEqual({
			parameter: "source",
			type: "sourceEntity",
			alias: "collectionSource",
		});
		expect(page.document.controls?.filter).toMatchObject({ kind: "outputs", query: "members" });
	});
	it("keeps collection, search and cursor values outside the authored document", () => {
		const recipe = collectionMembersRecipe();
		const bound = bindRecipe(recipe, {
			...collectionArguments("collection-one"),
			limit: 7,
			after: "cursor",
			searchText: "needle",
		});
		expect(JSON.stringify(recipe.document)).not.toContain("collection-one");
		expect(JSON.stringify(recipe.document)).not.toContain("needle");
		expect(JSON.stringify(bound.document)).toContain("collection-one");
		expect(bound.document.queries["members"]?.output).toMatchObject({
			pagination: { limit: 7, after: "cursor" },
		});
	});
	it("decodes only the selected result, retaining order revision and shared paging", () => {
		const recipe = collectionMembersRecipe();
		expect(
			Result.getOrThrow(recipe.decode(rowsResponse("members", [member], pageInfo))),
		).toMatchObject({ pageInfo, orderRevision: 4, items: [{ name: "One", entityId: "one" }] });
		expect(
			Result.getOrThrow(
				collectionMembersCountRecipe().decode({
					data: { count: { type: "aggregate", items: [{ total: 3 }] } },
				}),
			),
		).toBe(3);
		expect(
			Result.getOrThrow(
				collectionMemberIdsRecipe().decode(
					rowsResponse("memberIds", [{ entityId: "one" }], pageInfo),
				),
			),
		).toEqual({ pageInfo, items: ["one"] });
	});
	it("retains the current revision on an empty stale continuation page", () => {
		const recipe = collectionMembersRecipe();
		const result = Result.getOrThrow(
			recipe.decode(
				rowsResponse("members", [], {
					limit: 20,
					stale: true,
					hasMore: false,
					nextCursor: null,
					sourceRevisions: { "sourceEntity:selection": 5 },
				}),
			),
		);
		expect(result).toMatchObject({ items: [], stale: true, orderRevision: 5 });
	});

	it("declares namespaced membership output controls and omits secrets", () => {
		expect(
			collectionControlFields({
				fields: {
					score: { type: "number", label: "Score", description: "Membership score" },
					hidden: { secret: true, type: "string", label: "Hidden", description: "Secret" },
				},
			}),
		).toEqual([
			{
				kind: "value",
				label: "Score",
				type: "number",
				key: "membership.score",
				field: "membership.score",
			},
		]);
	});
	it("binds picker search and membership identity separately", () => {
		const first = bindRecipe(collectionPickerRecipe, {
			entityId: "one",
			after: "cursor",
			search: "needle",
		});
		const second = bindRecipe(collectionPickerRecipe, { search: "other" });
		expect(first.document).not.toEqual(second.document);
		expect(JSON.stringify(collectionPickerRecipe.document)).not.toContain("needle");
	});
});
