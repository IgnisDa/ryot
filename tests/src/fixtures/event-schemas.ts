import type { Client } from "./auth";

export async function createEventSchema(
	client: Client,
	cookies: string,
	body: {
		name: string;
		slug: string;
		entitySchemaId: string;
		propertiesSchema: { fields: Record<string, unknown>; rules?: unknown[] };
	},
) {
	const { data, response } = await client.POST("/event-schemas", {
		body: body as never,
		headers: { Cookie: cookies },
	});

	if (response.status !== 200 || !data?.data?.id) {
		throw new Error(`Failed to create event schema '${body.slug}'`);
	}

	return data.data;
}

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
