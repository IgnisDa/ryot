import { EntityId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import { requireObjectRecord, requirePresent } from "~/support/assertions";

import type { Client } from "./auth";
import type { ContractPayload } from "./contract-client";
import { createPluginSchema } from "./entity-schemas";

type CreateEntityInput = ContractPayload<"entities", "create">;

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

export const createEntity = (client: Client, body: CreateEntityInput) =>
	Effect.gen(function* () {
		const entity = yield* client.call((c) => c.entities.create({ payload: body }));

		requirePresent(entity.id, "Failed to create entity");

		return withRecordProperties(entity);
	});

export const getEntity = (client: Client, entityId: string) =>
	Effect.gen(function* () {
		const entity = yield* client.call((c) =>
			c.entities.get({ path: { entityId: EntityId.make(entityId) } }),
		);

		return withRecordProperties(entity);
	});

export const createPluginSchemaAndEntity = (client: Client) =>
	Effect.gen(function* () {
		const { slug, schemaId } = yield* createPluginSchema(client);
		const entity = yield* createEntity(client, {
			name: "Test Entity",
			entitySchemaSlug: schemaId,
			properties: { title: "Test Title" },
		});
		return { slug, entityId: entity.id };
	});

export const createTrackerWithSchemaAndEntity = createPluginSchemaAndEntity;
