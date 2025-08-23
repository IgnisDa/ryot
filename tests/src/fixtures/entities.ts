import type { paths } from "@ryot/generated/openapi/app-backend";
import type { Client } from "./auth";
import { createTrackerWithSchema } from "./entity-schemas";

type CreateEntityBody = NonNullable<
	paths["/entities"]["post"]["requestBody"]
>["content"]["application/json"];

export async function createEntity(
	client: Client,
	cookies: string,
	body: CreateEntityBody,
) {
	const { data, response } = await client.POST("/entities", {
		body,
		headers: { Cookie: cookies },
	});

	if (response.status !== 200 || !data?.data?.id) {
		throw new Error("Failed to create entity");
	}

	return data.data;
}

export async function getEntity(
	client: Client,
	cookies: string,
	entityId: string,
) {
	const { data, response } = await client.GET("/entities/{entityId}", {
		headers: { Cookie: cookies },
		params: { path: { entityId } },
	});

	if (response.status !== 200 || !data?.data) {
		throw new Error(`Failed to get entity '${entityId}'`);
	}

	return data.data;
}

export async function createTrackerWithSchemaAndEntity(
	client: Client,
	cookies: string,
) {
	const { trackerId, schemaId } = await createTrackerWithSchema(
		client,
		cookies,
	);
	const entity = await createEntity(client, cookies, {
		image: null,
		name: "Test Entity",
		entitySchemaId: schemaId,
		properties: { title: "Test Title" },
	});
	return { schemaId, trackerId, entityId: entity.id, entity };
}
