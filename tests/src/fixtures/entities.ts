import type { paths } from "@ryot/generated/openapi/app-backend";

import { getPgClient } from "../setup";
import { requirePresent, requireResponseData } from "../test-support/assertions";
import type { Client } from "./auth";
import { createTrackerWithSchema } from "./entity-schemas";

type CreateEntityBody = NonNullable<
	paths["/entities"]["post"]["requestBody"]
>["content"]["application/json"];

type ClearEntityUserStateData = NonNullable<
	paths["/entities/{entityId}/user-state"]["delete"]["responses"][200]["content"]["application/json"]
>["data"];

export async function createEntity(client: Client, cookies: string, body: CreateEntityBody) {
	const { data, response } = await client.POST("/entities", {
		body,
		headers: { Cookie: cookies },
	});

	const entity = requireResponseData(response, data, "Failed to create entity");
	requirePresent(entity.id, "Failed to create entity");
	return entity;
}

export async function getEntity(client: Client, cookies: string, entityId: string) {
	const { data, response } = await client.GET("/entities/{entityId}", {
		headers: { Cookie: cookies },
		params: { path: { entityId } },
	});

	return requireResponseData(response, data, `Failed to get entity '${entityId}'`);
}

export async function clearEntityUserState(
	client: Client,
	cookies: string,
	entityId: string,
): Promise<ClearEntityUserStateData> {
	const { data, response } = await client.DELETE("/entities/{entityId}/user-state", {
		headers: { Cookie: cookies },
		params: { path: { entityId } },
	});

	return requireResponseData(response, data, `Failed to clear user state for entity '${entityId}'`);
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
