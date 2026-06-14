import type { EntitySource, Expr } from "@ryot/contract/modules/query-engine/language";
import {
	buildQueryEngineEntityRowsDocument,
	queryEngineEntitySource,
	queryEngineLiteral,
	queryEnginePropertyRef,
	queryEngineSystemRef,
} from "@ryot/query-engine";

import type { RowsQueryDocument } from "./executor/types";

export type { RowsQueryDocument };

export const nameRef = (alias: string): Expr => queryEngineSystemRef(alias, "name");

export const occurredAtRef = (alias: string): Expr => queryEngineSystemRef(alias, "occurredAt");

export const createdAtRef = (alias: string): Expr => queryEngineSystemRef(alias, "createdAt");

export const propertyRef = (alias: string, schema: string, path: [string, ...string[]]): Expr =>
	queryEnginePropertyRef(alias, schema, ...path);

export const literal = (value: unknown): Expr => queryEngineLiteral(value);

export const descendantSource = (
	alias: string,
	anchor: string,
	edgeAlias: string,
	where: Expr | null,
): EntitySource => ({
	...queryEngineEntitySource({
		alias,
		where,
		schemas: [`${alias}s`],
		via: { entityRef: anchor, alias: edgeAlias, direction: "outgoing", schema: edgeAlias },
	}),
});

export const makeDoc = (overrides: Partial<RowsQueryDocument> = {}): RowsQueryDocument => ({
	...buildQueryEngineEntityRowsDocument({
		alias: "e",
		limit: 10,
		schemas: ["books"],
		fields: [],
		orderBy: [{ order: "asc", expr: nameRef("e") }],
	}),
	...overrides,
});
