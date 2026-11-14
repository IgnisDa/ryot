import { expect, it } from "bun:test";

import type { NamedQuery, RyotQLDocument } from "@ryot-app/contract/modules/ryotql/authored";
import { Result } from "effect";

import { type ControlSchema, resolveControl } from "./controls";

const schema: ControlSchema = {
	slug: "root",
	pluginId: null,
	packageId: null,
	pluginScope: null,
	isEffective: true,
	browse: {
		fields: [
			{
				key: "label",
				type: "text",
				kind: "value",
				label: "Label",
				expression: { field: "name", type: "column", tableAlias: "subject" },
			},
		],
	},
};
const query: NamedQuery = {
	from: { table: "entity", alias: "subject" },
	output: {
		orderBy: [],
		type: "rows",
		pagination: { limit: 10, maxLimit: 100 },
		fields: [
			{ key: "addedAt", expr: { type: "column", field: "createdAt", tableAlias: "membership" } },
			{
				key: "membership.score",
				expr: {
					path: ["score"],
					type: "jsonPath",
					expr: { type: "column", field: "properties", tableAlias: "membership" },
				},
			},
		],
	},
	joins: [
		{
			type: "inner",
			table: { alias: "membership", table: "relationship" },
			on: {
				type: "and",
				predicates: [
					{
						operator: "eq",
						type: "comparison",
						right: { type: "parameter", name: "collectionId" },
						left: { type: "column", field: "targetEntityId", tableAlias: "membership" },
					},
					{
						operator: "eq",
						type: "comparison",
						right: { type: "literal", value: "member-of" },
						left: { type: "column", tableAlias: "membership", field: "relationshipSchemaSlug" },
					},
					{
						type: "isNull",
						expr: { type: "column", tableAlias: "membership", field: "relationshipSchemaPluginId" },
					},
				],
			},
		},
	],
};
const document: RyotQLDocument = {
	queries: { members: query },
	parameters: {
		fields: {
			collectionId: {
				type: "string",
				label: "Collection",
				validation: { required: true },
				description: "Owned collection",
				reference: { kind: "entity-id" },
			},
		},
	},
};
const browse = {
	kind: "browse",
	alias: "subject",
	schemas: [{ slug: "root", owner: { kind: "kernel" } }],
} as const;
const addedAt = {
	type: "date",
	kind: "value",
	field: "addedAt",
	key: "date-added",
	label: "Date added",
} as const;

it("combines browse and membership projections with platform controls once", () => {
	const resolved = Result.getOrThrow(
		resolveControl(
			{
				kind: "composite",
				targets: [browse, { kind: "outputs", query: "members", fields: [addedAt] }],
			},
			query,
			[schema],
			document,
		),
	);
	expect(resolved.filters.map(({ spec }) => spec.key)).toEqual([
		"collections",
		"label",
		"date-added",
	]);
	expect(resolved.sorts.map(({ key }) => key)).toEqual(["name", "date-added"]);
});

it("rejects a caller projection trying to replace the platform Collections field", () => {
	const target = {
		kind: "composite",
		targets: [
			browse,
			{ kind: "outputs", query: "members", fields: [{ ...addedAt, key: "collections" }] },
		],
	} as const;
	expect(Result.isFailure(resolveControl(target, query, [schema], document))).toBe(true);
});

it("uses the source collection's persisted schema and refuses an unrelated raw collection ID", () => {
	const target = {
		kind: "outputs",
		query: "members",
		fields: [
			{
				kind: "value",
				type: "number",
				label: "Caller label",
				key: "membership.score",
				field: "membership.score",
			},
		],
	} as const;
	const memberships = [
		{
			collectionId: "owned",
			propertiesSchema: {
				fields: {
					score: { type: "number", label: "Stored score", description: "Persisted property" },
				},
			},
		},
	] as const;
	const resolved = Result.getOrThrow(
		resolveControl(target, query, [], document, {
			memberships,
			arguments: { collectionId: "owned" },
		}),
	);
	expect(resolved.filters[0]?.spec.label).toBe("Stored score");
	expect(
		Result.isFailure(
			resolveControl(target, query, [], document, {
				memberships,
				arguments: { collectionId: "other" },
			}),
		),
	).toBe(true);
});
