import { expect } from "bun:test";

import { requireObjectRecord, requireString } from "../test-support/assertions";
import type { Client } from "./auth";
import { postBackendJson, type ContractPayload, type ContractSuccess } from "./contract-client";

export type QueryEngineRowValue = QueryEngineRowItem[string];
export type QueryEnginePayload = ContractPayload<"queryEngine", "execute">;
type QueryEngineExecuteResponse = ContractSuccess<"queryEngine", "execute">;
export type QueryEngineRowItem = QueryEngineRowsResponse["data"]["items"][number];
export type QueryEngineFieldValue = Extract<QueryEngineRowValue, { kind: string }>;
export type QueryEngineRowsResponse = Extract<QueryEngineExecuteResponse, { type: "rows" }>;
export type QueryEngineRowsOutput = Extract<QueryEnginePayload["output"], { type: "rows" }>;
type QueryEngineAggregateResponse = Extract<QueryEngineExecuteResponse, { type: "aggregate" }>;
type QueryEngineTimeSeriesResponse = Extract<QueryEngineExecuteResponse, { type: "timeSeries" }>;
type QueryEngineIncludeValue = Extract<
	QueryEngineRowValue,
	{ items: readonly QueryEngineRowItem[] }
>;

export async function executeQueryEngine(
	client: Client,
	doc: QueryEnginePayload,
): Promise<QueryEngineRowsResponse> {
	const result = await client.run((c) => c.queryEngine.execute({ payload: doc }));
	if (result.type !== "rows") {
		throw new Error(`Expected rows response, received ${result.type}`);
	}
	return result;
}

export async function executeAggregateQueryEngine(
	client: Client,
	doc: QueryEnginePayload,
): Promise<QueryEngineAggregateResponse> {
	const result = await client.run((c) => c.queryEngine.execute({ payload: doc }));
	if (result.type !== "aggregate") {
		throw new Error(`Expected aggregate response, received ${result.type}`);
	}
	return result;
}

export async function executeTimeSeriesQueryEngine(
	client: Client,
	doc: QueryEnginePayload,
): Promise<QueryEngineTimeSeriesResponse> {
	const result = await client.run((c) => c.queryEngine.execute({ payload: doc }));
	if (result.type !== "timeSeries") {
		throw new Error(`Expected timeSeries response, received ${result.type}`);
	}
	return result;
}

export async function executeQueryEngineError(client: Client, doc: QueryEnginePayload) {
	return client.runError((c) => c.queryEngine.execute({ payload: doc }));
}

export const systemRef = (
	alias: string,
	name: string,
): QueryEngineRowsOutput["orderBy"][number]["expr"] => ({
	type: "ref",
	sourceAlias: alias,
	field: { type: "system", name },
});

export const propertyRef = (
	alias: string,
	schema: string,
	...path: [string, ...string[]]
): QueryEngineRowsOutput["orderBy"][number]["expr"] => ({
	type: "ref",
	sourceAlias: alias,
	field: { type: "property", schema, path },
});

export const schemaMetaRef = (
	alias: string,
	name: "slug" | "name" | "isBuiltin",
): QueryEngineRowsOutput["orderBy"][number]["expr"] => ({
	type: "ref",
	sourceAlias: alias,
	field: { type: "schema", name },
});

export const literalExpr = (value: unknown): QueryEngineRowsOutput["orderBy"][number]["expr"] => ({
	type: "literal",
	value,
});

export const buildEntityRowsQueryDocument = (input: {
	alias: string;
	page?: number;
	limit?: number;
	schemas: [string, ...string[]];
	fields?: QueryEngineRowsOutput["fields"];
	orderBy?: QueryEngineRowsOutput["orderBy"];
	include?: QueryEngineRowsOutput["include"];
	where?: Extract<QueryEnginePayload["source"], { type: "entities" }>["where"];
}): QueryEnginePayload => ({
	source: {
		type: "entities",
		alias: input.alias,
		schemas: input.schemas,
		where: input.where ?? null,
	},
	output: {
		type: "rows",
		fields: input.fields ?? [],
		include: input.include ?? [],
		pagination: { page: input.page ?? 1, limit: input.limit ?? 10 },
		orderBy: input.orderBy ?? [{ order: "asc", expr: systemRef(input.alias, "name") }],
	},
});

export const buildEventRowsDoc = (input: {
	page?: number;
	limit?: number;
	eventAlias: string;
	entityAlias: string;
	eventSchemas: [string, ...string[]];
	entitySchemas: [string, ...string[]];
	fields: QueryEngineRowsOutput["fields"];
	orderBy: QueryEngineRowsOutput["orderBy"];
	where?: Extract<QueryEnginePayload["source"], { type: "events" }>["where"];
}): QueryEnginePayload => ({
	output: {
		type: "rows",
		fields: input.fields,
		orderBy: input.orderBy,
		pagination: { page: input.page ?? 1, limit: input.limit ?? 10 },
	},
	source: {
		type: "events",
		alias: input.eventAlias,
		where: input.where ?? null,
		schemas: input.eventSchemas,
		entity: { alias: input.entityAlias, schemas: input.entitySchemas },
	},
});

export const buildRowsDoc = (
	overrides: Partial<QueryEnginePayload> & {
		alias: string;
		page?: number;
		limit?: number;
		schemas: [string, ...string[]];
		fields?: QueryEngineRowsOutput["fields"];
		orderByExpr?: QueryEngineRowsOutput["orderBy"][number]["expr"];
	},
): QueryEnginePayload => {
	const { alias, schemas, fields = [], orderByExpr, page = 1, limit = 10, ...rest } = overrides;
	return {
		source: { type: "entities", alias, schemas, where: null },
		output: {
			fields,
			type: "rows",
			pagination: { page, limit },
			orderBy: [{ order: "asc", expr: orderByExpr ?? systemRef(alias, "name") }],
		},
		...rest,
	};
};

export const expectMalformedQueryBadRequest = async (body: unknown, cookies: string) => {
	const response = await postBackendJson("/query-engine/execute", body, cookies);
	const error = requireObjectRecord(await response.json(), "Expected BadRequest response");

	expect(response.status).toBe(400);
	expect(requireString(error._tag, "Expected error tag")).toBe("BadRequest");
};

export const getQueryEngineFieldValue = (
	item: QueryEngineRowItem,
	key: string,
): QueryEngineRowValue | undefined => item[key];

export const getQueryEngineFieldOrThrow = (item: QueryEngineRowItem | undefined, key: string) => {
	if (item === undefined) {
		throw new Error("Expected query engine row");
	}
	const value = getQueryEngineFieldValue(item, key);
	if (value === undefined || !("kind" in value)) {
		throw new Error(`Expected field '${key}' in row`);
	}
	return { ...value, key };
};

export const requireQueryEngineFieldValue = (
	item: QueryEngineRowItem,
	key: string,
): QueryEngineFieldValue => {
	const val = getQueryEngineFieldValue(item, key);
	if (val === undefined || !("kind" in val)) {
		throw new Error(`Expected field '${key}' in row`);
	}
	return val;
};

export const requireQueryEngineTextField = (item: QueryEngineRowItem, key: string) =>
	requireString(requireQueryEngineFieldValue(item, key).value, `Expected '${key}' to be text`);

export const getQueryEngineTextFieldOrNull = (item: QueryEngineRowItem, key: string) => {
	const field = requireQueryEngineFieldValue(item, key);
	return field.kind === "null" ? null : requireString(field.value, `Expected '${key}' to be text`);
};

export const getQueryEngineTextFieldOrUndefined = (item: QueryEngineRowItem, key: string) =>
	getQueryEngineTextFieldOrNull(item, key) ?? undefined;

export const requireQueryEngineObjectField = (item: QueryEngineRowItem, key: string) =>
	requireObjectRecord(
		requireQueryEngineFieldValue(item, key).value,
		`Expected '${key}' to be an object`,
	);

export const requireQueryEngineIncludeValue = (
	item: QueryEngineRowItem,
	key: string,
): QueryEngineIncludeValue => {
	const val = getQueryEngineFieldValue(item, key);
	if (val === undefined || !("items" in val)) {
		throw new Error(`Expected include '${key}' in row`);
	}
	return val;
};
