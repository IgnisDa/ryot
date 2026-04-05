import type { paths } from "@ryot/generated/openapi/app-backend";
import type { Client } from "./auth";

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
