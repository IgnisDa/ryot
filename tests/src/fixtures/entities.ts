import type { paths } from "@ryot/generated/openapi/app-backend";

import { requirePresent, requireResponseData } from "../test-support/assertions";
import type { Client } from "./auth";
import { createTrackerWithSchema } from "./entity-schemas";

type CreateEntityBody = NonNullable<
	paths["/entities"]["post"]["requestBody"]
>["content"]["application/json"];

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
