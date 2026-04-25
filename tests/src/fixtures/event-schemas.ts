import { requirePresent, requireResponseData } from "../test-support/assertions";
import type { Client } from "./auth";
import type { ClientBody } from "./backend-client";

type CreateEventSchemaBody = ClientBody<"event-schemas", "create">;

export function requireEventSchemaBySlug<T extends { slug: string }>(
	schemas: readonly T[],
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
	const { data, response } = await client["event-schemas"].create({
		body,
		headers: { Cookie: cookies },
	});

	const eventSchema = requireResponseData(
		response,
		data,
		`Failed to create event schema '${body.name}'`,
	);
	return eventSchema;
}

export async function listEventSchemas(client: Client, cookies: string, entitySchemaId: string) {
	const { data, response } = await client["event-schemas"].list({
		headers: { Cookie: cookies },
		params: { query: { entitySchemaId } },
	});

	return requireResponseData(
		response,
		data,
		`Failed to list event schemas for '${entitySchemaId}'`,
	);
}
