import { EntityId, EntitySchemaId, EventSchemaId } from "@ryot/app-backend/schema/brands";

import type { Client } from "./auth";
import type { ContractPayload, ContractSuccess } from "./contract-client";
import { createEntity } from "./entities";
import { createEntitySchema } from "./entity-schemas";
import { createTracker } from "./trackers";

export type V2RowValue = V2RowItem[string];
export type V2RowItem = V2RowsResponse["data"]["items"][number];
export type V2FieldValue = Extract<V2RowValue, { kind: string }>;
export type V2IncludeValue = Extract<V2RowValue, { items: readonly V2RowItem[] }>;
export type V2RowsResponse = Extract<V2ExecuteResponse, { type: "rows" }>;
export type V2ExecutePayload = ContractPayload<"queryEngineV2", "execute">;
export type V2ExecuteResponse = ContractSuccess<"queryEngineV2", "execute">;

export async function executeQueryEngineV2(
	client: Client,
	doc: V2ExecutePayload,
): Promise<V2RowsResponse> {
	return client.run((c) => c.queryEngineV2.execute({ payload: doc }));
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
	input: { entityId: string; eventSchemaId: string; properties?: Record<string, unknown> },
) {
	return client.run((c) =>
		c.events.create({
			payload: [
				{
					entityId: EntityId.make(input.entityId),
					properties: input.properties ?? {},
					eventSchemaId: EventSchemaId.make(input.eventSchemaId),
				},
			],
		}),
	);
}

export const systemRef = (
	alias: string,
	name: string,
): V2ExecutePayload["output"]["orderBy"][number]["expr"] => ({
	type: "ref",
	sourceAlias: alias,
	field: { type: "system", name },
});

export const propertyRef = (
	alias: string,
	schema: string,
	...path: [string, ...string[]]
): V2ExecutePayload["output"]["orderBy"][number]["expr"] => ({
	type: "ref",
	sourceAlias: alias,
	field: { type: "property", schema, path },
});

export const schemaMetaRef = (
	alias: string,
	name: "slug" | "name",
): V2ExecutePayload["output"]["orderBy"][number]["expr"] => ({
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
