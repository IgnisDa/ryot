import type { RowsQueryDocument } from "./executor/types";
import type { EntitySource, Expr } from "./language";

export type { RowsQueryDocument };

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
	source: { alias: "e", where: null, type: "entities", schemas: ["books"] },
	output: {
		fields: [],
		type: "rows",
		pagination: { page: 1, limit: 10 },
		orderBy: [{ order: "asc", expr: nameRef("e") }],
	},
	...overrides,
});
