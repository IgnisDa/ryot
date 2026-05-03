import type { paths } from "@ryot/generated/openapi/app-backend";

import type { Client } from "./auth";
import type { AppSchema } from "./entity-schemas";

type GeneratedCreateEventSchemaBody = NonNullable<
	paths["/event-schemas"]["post"]["requestBody"]
>["content"]["application/json"];

type CreateEventSchemaBody = Omit<GeneratedCreateEventSchemaBody, "propertiesSchema"> & {
	propertiesSchema: AppSchema;
};

export function requireEventSchemaBySlug<T extends { slug: string }>(
	schemas: T[],
	slug: string,
): T {
	const schema = schemas.find((s) => s.slug === slug);
	if (!schema) {
		throw new Error(`Event schema '${slug}' not found`);
	}
	return schema;
}

export async function createEventSchema(
	client: Client,
	cookies: string,
	body: CreateEventSchemaBody,
) {
	const { data, response } = await client.POST("/event-schemas", {
		body: body as never,
		headers: { Cookie: cookies },
	});

	if (response.status !== 200 || !data?.data?.id) {
		throw new Error(`Failed to create event schema '${body.name}'`);
	}

	return data.data;
}

export async function listEventSchemas(client: Client, cookies: string, entitySchemaId: string) {
	const { data, response } = await client.GET("/event-schemas", {
		headers: { Cookie: cookies },
		params: { query: { entitySchemaId } },
	});

	if (response.status !== 200 || !data?.data) {
		throw new Error(`Failed to list event schemas for '${entitySchemaId}'`);
	}

	return data.data;
}
