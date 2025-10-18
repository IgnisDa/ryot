import { getPgClient } from "../setup";
import {
	requireObjectRecord,
	requirePresent,
	requireResponseData,
} from "../test-support/assertions";
import type { Client } from "./auth";
import type { ClientBody, ClientSuccess } from "./backend-client";
import { createTrackerWithSchema } from "./entity-schemas";

type CreateEntityBody = ClientBody<"entities", "create">;
type CreateEntityInput = Omit<CreateEntityBody, "image"> & {
	image?: CreateEntityBody["image"] | { type: "remote"; url: string } | null;
};

type ClearEntityUserStateData = ClientSuccess<"entities", "clearUserState">;

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

function normalizeEntityImage(
	image: CreateEntityInput["image"],
): CreateEntityBody["image"] | undefined {
	if (image === undefined || image === null) {
		return undefined;
	}

	if (typeof image === "string") {
		return image;
	}

	// TODO(Task 22): Remove this tests-only image compatibility bridge once tests
	// pass the AppContract string URL directly.
	return image.url;
}

export async function createEntity(client: Client, cookies: string, body: CreateEntityInput) {
	const { image, ...rest } = body;
	const { data, response } = await client.entities.create({
		body: {
			...rest,
			...(normalizeEntityImage(image) !== undefined && {
				image: normalizeEntityImage(image),
			}),
		},
		headers: { Cookie: cookies },
	});

	const entity = requireResponseData(response, data, "Failed to create entity");
	requirePresent(entity.id, "Failed to create entity");

	// TODO(Task 22): Remove this tests-only entity assertion once the public
	// AppContract exposes typed entity properties.
	return withRecordProperties(entity);
}

export async function getEntity(client: Client, cookies: string, entityId: string) {
	const { data, response } = await client.entities.get({
		headers: { Cookie: cookies },
		params: { path: { entityId } },
	});

	// TODO(Task 22): Remove this tests-only entity assertion once the public
	// AppContract exposes typed entity properties.
	return withRecordProperties(
		requireResponseData(response, data, `Failed to get entity '${entityId}'`),
	);
}

export async function clearEntityUserState(
	client: Client,
	cookies: string,
	entityId: string,
): Promise<ClearEntityUserStateData> {
	const { data, response } = await client.entities.clearUserState({
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
