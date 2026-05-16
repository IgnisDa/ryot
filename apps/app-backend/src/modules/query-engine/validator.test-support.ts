import type { EntitySource, Expr, QueryDocument } from "./language";

export type RowsQueryDocument = QueryDocument & {
	output: Extract<QueryDocument["output"], { type: "rows" }>;
};

export const nameRef = (alias: string): Expr => ({
	type: "ref",
	sourceAlias: alias,
	field: { type: "system", name: "name" },
});

export const occurredAtRef = (alias: string): Expr => ({
	type: "ref",
	sourceAlias: alias,
	field: { type: "system", name: "occurredAt" },
});

export const createdAtRef = (alias: string): Expr => ({
	type: "ref",
	sourceAlias: alias,
	field: { type: "system", name: "createdAt" },
});

export const propertyRef = (alias: string, schema: string, path: [string, ...string[]]): Expr => ({
	type: "ref",
	sourceAlias: alias,
	field: { type: "property", schema, path },
});

export const literal = (value: unknown): Expr => ({ type: "literal", value });

export const descendantSource = (
	alias: string,
	anchor: string,
	edgeAlias: string,
	where: Expr | null,
): EntitySource => ({
	where,
	alias,
	type: "entities",
	schemas: [`${alias}s`],
	via: { entityRef: anchor, alias: edgeAlias, direction: "outgoing", schema: edgeAlias },
});

export const makeDoc = (overrides: Partial<RowsQueryDocument> = {}): RowsQueryDocument => ({
	version: 2,
	source: { alias: "e", where: null, type: "entities", schemas: ["books"] },
	output: {
		fields: [],
		type: "rows",
		pagination: { page: 1, limit: 10 },
		orderBy: [{ order: "asc", expr: nameRef("e") }],
	},
	...overrides,
});
