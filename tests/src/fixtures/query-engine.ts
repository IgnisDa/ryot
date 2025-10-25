import { EntityId, EntitySchemaId, EventSchemaId } from "@ryot/app-backend/schema/brands";

import type { Client } from "./auth";
import type { ContractPayload, ContractSuccess } from "./contract-client";
import { createEntity } from "./entities";
import { createEntitySchema } from "./entity-schemas";
import { pollUntil } from "./polling";
import { createTracker } from "./trackers";

type QueryEngineRowValue = QueryEngineRowItem[string];
type QueryEngineRowItem = QueryEngineRowsResponse["data"]["items"][number];
type QueryEngineFieldValue = Extract<QueryEngineRowValue, { kind: string }>;
type QueryEngineRowsResponse = Extract<QueryEngineExecuteResponse, { type: "rows" }>;
type QueryEngineExecuteResponse = ContractSuccess<"queryEngine", "execute">;
type QueryEngineRowsOutput = Extract<QueryEnginePayload["output"], { type: "rows" }>;
type QueryEngineIncludeValue = Extract<
	QueryEngineRowValue,
	{ items: readonly QueryEngineRowItem[] }
>;
export type QueryEnginePayload = ContractPayload<"queryEngine", "execute">;
type QueryEngineAggregateResponse = Extract<QueryEngineExecuteResponse, { type: "aggregate" }>;
type QueryEngineTimeSeriesResponse = Extract<QueryEngineExecuteResponse, { type: "timeSeries" }>;
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

export async function createQueryEngineTrackerAndSchema(
	client: Client,
	options: {
		schemaName: string;
		schemaSlug?: string;
		propertiesSchema?: Parameters<typeof createEntitySchema>[1]["propertiesSchema"];
	},
) {
	const { trackerId } = await createTracker(client);
	const { schemaId, slug } = await createEntitySchema(client, {
		trackerId,
		name: options.schemaName,
		...(options.schemaSlug ? { slug: options.schemaSlug } : {}),
		...(options.propertiesSchema ? { propertiesSchema: options.propertiesSchema } : {}),
	});
	return { trackerId, schemaId, slug };
}

export async function createQueryEngineEntity(
	client: Client,
	input: { name: string; entitySchemaId: string; properties?: Record<string, unknown> },
) {
	return createEntity(client, {
		name: input.name,
		properties: input.properties ?? {},
		entitySchemaId: EntitySchemaId.make(input.entitySchemaId),
	});
}

export async function createQueryEngineEvent(
	client: Client,
	input: {
		entityId: string;
		occurredAt?: string;
		eventSchemaId: string;
		properties?: Record<string, unknown>;
	},
) {
	const result = await client.run((c) =>
		c.events.create({
			payload: [
				{
					entityId: EntityId.make(input.entityId),
					properties: input.properties ?? {},
					...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
					eventSchemaId: EventSchemaId.make(input.eventSchemaId),
				},
			],
		}),
	);

	await pollUntil(
		`query-engine event ${input.eventSchemaId} on entity ${input.entityId}`,
		async () => {
			const events = await client.run((c) =>
				c.events.list({ urlParams: { entityId: EntityId.make(input.entityId) } }),
			);
			return (
				events.find(
					(event) =>
						event.eventSchemaId === input.eventSchemaId &&
						(input.occurredAt === undefined || event.occurredAt === input.occurredAt),
				) ?? null
			);
		},
		{ timeoutMs: 15000, intervalMs: 250 },
	);

	return result;
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
	include?: QueryEngineRowsOutput["include"];
	fields?: QueryEngineRowsOutput["fields"];
	orderBy?: QueryEngineRowsOutput["orderBy"];
	schemas: [string, ...string[]];
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
