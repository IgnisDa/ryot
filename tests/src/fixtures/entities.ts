import { getPgClient } from "../setup";
import { requireObjectRecord, requirePresent } from "../test-support/assertions";
import type { Client } from "./auth";
import type { ContractPayload, ContractSuccess } from "./contract-client";
import { createTrackerWithSchema } from "./entity-schemas";

type CreateEntityBody = ContractPayload<"entities", "create">;
type CreateEntityInput = Omit<CreateEntityBody, "image"> & {
	image?: CreateEntityBody["image"] | null;
};

type ClearEntityUserStateData = ContractSuccess<"entities", "clearUserState">;

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

export async function createEntity(client: Client, cookies: string, body: CreateEntityInput) {
	const { image, ...rest } = body;
	const entity = await client.run(
		(c) => c.entities.create({ payload: { ...rest, ...(image != null && { image }) } }),
		{ Cookie: cookies },
	);

	requirePresent(entity.id, "Failed to create entity");

	return withRecordProperties(entity);
}

export async function getEntity(client: Client, cookies: string, entityId: string) {
	const entity = await client.run((c) => c.entities.get({ path: { entityId } }), {
		Cookie: cookies,
	});

	return withRecordProperties(entity);
}

export async function clearEntityUserState(
	client: Client,
	cookies: string,
	entityId: string,
): Promise<ClearEntityUserStateData> {
	return client.run((c) => c.entities.clearUserState({ path: { entityId } }), { Cookie: cookies });
}

export async function queryUserEntityStateCounts(input: { userId: string; entityId: string }) {
	const pg = getPgClient();
	const [events, relationships] = await Promise.all([
		pg.query<{ count: string }>(
			`select count(*)::text as count
			 from event
			 where user_id = $1
			   and (entity_id = $2 or session_entity_id = $2)`,
			[input.userId, input.entityId],
		),
		pg.query<{ count: string }>(
			`select count(*)::text as count
			 from relationship
			 where user_id = $1
			   and (source_entity_id = $2 or target_entity_id = $2)`,
			[input.userId, input.entityId],
		),
	]);

	return {
		eventCount: Number(requirePresent(events.rows[0], "Missing event count").count),
		relationshipCount: Number(
			requirePresent(relationships.rows[0], "Missing relationship count").count,
		),
	};
}

export async function createTrackerWithSchemaAndEntity(client: Client, cookies: string) {
	const { schemaId } = await createTrackerWithSchema(client, cookies);
	const entity = await createEntity(client, cookies, {
		image: null,
		name: "Test Entity",
		entitySchemaId: schemaId,
		properties: { title: "Test Title" },
	});
	return { entityId: entity.id };
}
