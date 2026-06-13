import { EntityId } from "@ryot/app-backend/schema/brands";

import { requireObjectRecord, requirePresent } from "../test-support/assertions";
import type { Client } from "./auth";
import type { ContractPayload } from "./contract-client";
import { createTrackerWithSchema } from "./entity-schemas";

type CreateEntityBody = ContractPayload<"entities", "create">;
type CreateEntityInput = Omit<CreateEntityBody, "image"> & {
	image?: CreateEntityBody["image"] | null;
};

function withRecordProperties<T extends { properties: unknown }>(
	entity: T,
): Omit<T, "properties"> & {
	properties: Record<string, unknown>;
} {
	return {
		...entity,
		properties: requireObjectRecord(entity.properties, "Entity properties must be an object"),
	};
}

export async function createEntity(client: Client, body: CreateEntityInput) {
	const { image, ...rest } = body;
	const entity = await client.run((c) =>
		c.entities.create({ payload: { ...rest, ...(image != null && { image }) } }),
	);

	requirePresent(entity.id, "Failed to create entity");

	return withRecordProperties(entity);
}

export async function getEntity(client: Client, entityId: string) {
	const entity = await client.run((c) =>
		c.entities.get({ path: { entityId: EntityId.make(entityId) } }),
	);

	return withRecordProperties(entity);
}

export async function createTrackerWithSchemaAndEntity(client: Client) {
	const { schemaId } = await createTrackerWithSchema(client);
	const entity = await createEntity(client, {
		image: null,
		name: "Test Entity",
		entitySchemaId: schemaId,
		properties: { title: "Test Title" },
	});
	return { entityId: entity.id };
}
