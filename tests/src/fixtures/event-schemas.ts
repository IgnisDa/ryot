import type { paths } from "@ryot/generated/openapi/app-backend";

import { requirePresent, requireResponseData } from "../test-support/assertions";
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
	return requirePresent(schema, `Event schema '${slug}' not found`);
}

export async function createEventSchema(
	client: Client,
	cookies: string,
	body: CreateEventSchemaBody,
) {
	const { data, response } = await client.POST("/event-schemas", {
		body,
		headers: { Cookie: cookies },
	});

	const eventSchema = requireResponseData(
		response,
		data,
		`Failed to create event schema '${body.name}'`,
	);
	requirePresent(eventSchema.id, `Failed to create event schema '${body.name}'`);
	return eventSchema;
}

export async function listEventSchemas(client: Client, cookies: string, entitySchemaId: string) {
	const { data, response } = await client.GET("/event-schemas", {
		headers: { Cookie: cookies },
		params: { query: { entitySchemaId } },
	});

	return requireResponseData(
		response,
		data,
		`Failed to list event schemas for '${entitySchemaId}'`,
	);
}
