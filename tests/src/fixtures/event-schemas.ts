import type { Client } from "./auth";

export async function listEventSchemas(
	client: Client,
	cookies: string,
	entitySchemaId: string,
) {
	const { data, response } = await client.GET("/event-schemas", {
		headers: { Cookie: cookies },
		params: { query: { entitySchemaId } },
	});

	if (response.status !== 200 || !data?.data) {
		throw new Error(`Failed to list event schemas for '${entitySchemaId}'`);
	}

	return data.data;
}
