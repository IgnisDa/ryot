import { EntityId, EntitySchemaId, EventSchemaId } from "@ryot/app-backend/schema/brands";

import type { Client } from "./auth";
import type { ContractPayload, ContractSuccess } from "./contract-client";
import { createEntity } from "./entities";
import { createEntitySchema } from "./entity-schemas";
import { pollUntil } from "./polling";
import { createTracker } from "./trackers";

type V2RowValue = V2RowItem[string];
type V2RowItem = V2RowsResponse["data"]["items"][number];
type V2FieldValue = Extract<V2RowValue, { kind: string }>;
type V2RowsResponse = Extract<V2ExecuteResponse, { type: "rows" }>;
type V2ExecuteResponse = ContractSuccess<"queryEngineV2", "execute">;
type V2RowsOutput = Extract<V2ExecutePayload["output"], { type: "rows" }>;
type V2IncludeValue = Extract<V2RowValue, { items: readonly V2RowItem[] }>;
export type V2ExecutePayload = ContractPayload<"queryEngineV2", "execute">;
type V2AggregateResponse = Extract<V2ExecuteResponse, { type: "aggregate" }>;
type V2TimeSeriesResponse = Extract<V2ExecuteResponse, { type: "timeSeries" }>;

export async function executeQueryEngineV2(
	client: Client,
	doc: V2ExecutePayload,
): Promise<V2RowsResponse> {
	const result = await client.run((c) => c.queryEngineV2.execute({ payload: doc }));
	if (result.type !== "rows") {
		throw new Error(`Expected rows response, received ${result.type}`);
	}
	return result;
}

export async function executeAggregateQueryEngineV2(
	client: Client,
	doc: V2ExecutePayload,
): Promise<V2AggregateResponse> {
	const result = await client.run((c) => c.queryEngineV2.execute({ payload: doc }));
	if (result.type !== "aggregate") {
		throw new Error(`Expected aggregate response, received ${result.type}`);
	}
	return result;
}

export async function executeTimeSeriesQueryEngineV2(
	client: Client,
	doc: V2ExecutePayload,
): Promise<V2TimeSeriesResponse> {
	const result = await client.run((c) => c.queryEngineV2.execute({ payload: doc }));
	if (result.type !== "timeSeries") {
		throw new Error(`Expected timeSeries response, received ${result.type}`);
	}
	return result;
}

export async function executeQueryEngineV2Error(client: Client, doc: V2ExecutePayload) {
	return client.runError((c) => c.queryEngineV2.execute({ payload: doc }));
}

export async function createV2TrackerAndSchema(
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

export async function createV2Entity(
	client: Client,
	input: { name: string; entitySchemaId: string; properties?: Record<string, unknown> },
) {
	return createEntity(client, {
		name: input.name,
		properties: input.properties ?? {},
		entitySchemaId: EntitySchemaId.make(input.entitySchemaId),
	});
}

export async function createV2Event(
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
		`query-engine-v2 event ${input.eventSchemaId} on entity ${input.entityId}`,
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
): V2RowsOutput["orderBy"][number]["expr"] => ({
	type: "ref",
	sourceAlias: alias,
	field: { type: "system", name },
});

export const propertyRef = (
	alias: string,
	schema: string,
	...path: [string, ...string[]]
): V2RowsOutput["orderBy"][number]["expr"] => ({
	type: "ref",
	sourceAlias: alias,
	field: { type: "property", schema, path },
});

export const schemaMetaRef = (
	alias: string,
	name: "slug" | "name",
): V2RowsOutput["orderBy"][number]["expr"] => ({
	type: "ref",
	sourceAlias: alias,
	field: { type: "schema", name },
});

export const getV2FieldValue = (item: V2RowItem, key: string): V2RowValue | undefined => item[key];

export const requireV2FieldValue = (item: V2RowItem, key: string): V2FieldValue => {
	const val = getV2FieldValue(item, key);
	if (val === undefined || !("kind" in val)) {
		throw new Error(`Expected field '${key}' in row`);
	}
	return val;
};

export const requireV2IncludeValue = (item: V2RowItem, key: string): V2IncludeValue => {
	const val = getV2FieldValue(item, key);
	if (val === undefined || !("items" in val)) {
		throw new Error(`Expected include '${key}' in row`);
	}
	return val;
};
