import { expect, it } from "bun:test";

import { entityBrowserFields } from "@ryot-app/contract/modules/saved-views/entity-browser-fields";
import { castNumber, column, count, jsonPath, table } from "@ryot-app/ryotql";
import { Result } from "effect";

import { kernelPublicationPage, publicationBrowse } from "./publication-browse";
import { bindRecipe, rowsResponse } from "./test-utils";

const subject = table("entity", "subject");
const schema = {
	slug: "record",
	pluginId: null,
	browse: {
		fields: [
			{
				key: "score",
				kind: "value",
				label: "Score",
				type: "number",
				expression: castNumber(jsonPath(column(subject, "properties"), "score")),
			},
		],
	},
} as const;
const source = '{"kind":"collection","collectionId":"collection"}';

it("declares exactly four source-bound queries and disables detail queries without a selected entity", () => {
	const page = kernelPublicationPage({ schemas: [schema] });
	const bound = bindRecipe(page, { source });
	expect(Object.keys(bound.document.queries).sort()).toEqual(["count", "item", "items", "linked"]);
	expect(bound.document.queries["items"]?.from).toEqual({
		alias: "selection",
		table: "sourceEntity:testing",
	});
	expect(bound.document.queries["items"]?.joins).toEqual([
		{
			type: "inner",
			table: { table: "entity", alias: "subject" },
			on: {
				operator: "eq",
				type: "comparison",
				right: column(subject, "id"),
				left: column(table("entity", "selection"), "entityId"),
			},
		},
	]);
	expect(bound.document.queries["item"]?.where).toEqual({
		type: "and",
		predicates: [
			{ type: "not", predicate: { type: "and", predicates: [] } },
			{ type: "and", predicates: [] },
		],
	});
	expect(bound.document.queries["linked"]?.where).toEqual(bound.document.queries["item"]?.where);
	const items = bound.document.queries["items"];
	if (items?.output.type !== "rows") {
		throw new Error("Expected items rows");
	}
	expect(items.output.orderBy).toEqual([
		{ direction: "asc", expr: column(table("entity", "selection"), "rank") },
		{ direction: "asc", expr: column(subject, "id") },
	]);
});

it("constrains the selected item and both linked endpoints to the bound source", () => {
	const bound = bindRecipe(kernelPublicationPage({ schemas: [schema] }), {
		source,
		entityId: "selected",
	});
	const linked = JSON.stringify(bound.document.queries["linked"]?.where);
	expect(linked).toContain('"alias":"selectedItem","table":"sourceEntity:testing"');
	expect(linked).toContain('"field":"sourceEntityId"');
	expect(linked).toContain('"field":"targetEntityId"');
	expect(linked).toContain('"value":"selected"');
	expect(linked).toContain('"field":"id","tableAlias":"subject"');
	expect(JSON.stringify(bound.document.queries["item"]?.where)).toContain('"value":"selected"');
});

it("excludes identity, unbound aliases, and correlated reads from browse and presentation fields", () => {
	const unsafe = [
		column(subject, "userId"),
		column(table("entity", "other"), "name"),
		count(subject),
	];
	const browse = publicationBrowse([
		{
			...schema,
			browse: {
				fields: unsafe.map((expression, index) => ({
					expression,
					type: "text",
					kind: "value",
					key: `${index}`,
					label: "Unsafe",
				})),
			},
		},
	]);
	expect(browse[0]?.browse?.fields).toEqual([]);
	const page = kernelPublicationPage({ schemas: [schema] });
	expect(JSON.stringify(page.document)).not.toContain("userId");
	expect(JSON.stringify(page.document)).not.toContain("publicationRank");
});

it("reuses entity-browser presentation decoding and formats the selected schema's detail values", () => {
	const page = kernelPublicationPage({ schemas: [schema] });
	const row = {
		name: "Record",
		__entityPresentation: null,
		__publicationDetail0_score: 12,
		[entityBrowserFields.owner]: null,
		[entityBrowserFields.id]: "entity",
		[entityBrowserFields.name]: "Record",
		[entityBrowserFields.schema]: "record",
		[entityBrowserFields.population]: { state: "succeeded", availability: "complete" },
		[entityBrowserFields.translation]: { state: "succeeded", availability: "complete" },
	};
	const item = Result.getOrThrow(
		page.decodeItem(rowsResponse("item", [row], { limit: 1, hasMore: false, nextCursor: null })),
	);
	expect(item?.entityId).toBe("entity");
	expect(item?.presentation).toBeNull();
	expect(item?.details).toEqual([
		{ key: "score", label: "Score", value: { value: 12, displayKind: "number" } },
	]);
	expect(
		Result.getOrThrow(
			page.decodeItem(rowsResponse("item", [], { limit: 1, hasMore: false, nextCursor: null })),
		),
	).toBeUndefined();
});

it("requires scalar type metadata for sort-only fields and keeps them out of filter controls", () => {
	const sort = {
		kind: "sort",
		key: "score-order",
		expression: castNumber(jsonPath(column(subject, "properties"), "score")),
		sort: {
			label: "Score",
			ascending: "Low first",
			descending: "High first",
			defaultDirection: "desc",
		},
	} as const;
	expect(() =>
		kernelPublicationPage({ schemas: [{ ...schema, browse: { fields: [sort] } }] }),
	).toThrow("Missing publication sort type");
	const page = kernelPublicationPage({
		schemas: [{ ...schema, browse: { fields: [sort] }, sortTypes: { "score-order": "number" } }],
	});
	expect(page.document.controls?.filter).toMatchObject({ fields: [{ key: "name" }] });
	expect(page.document.controls?.sort).toMatchObject({
		fields: [{ type: "number", key: "browse0_score-order" }, { key: "name" }],
	});
	expect(
		Result.getOrThrow(
			page.decodeCount({ data: { count: { type: "aggregate", items: [{ count: 4 }] } } }),
		),
	).toBe(4);
});
