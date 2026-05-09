import { requirePresent } from "../test-support/assertions";
import type { Client } from "./auth";
import type { ContractPayload } from "./contract-client";

type CreateEventSchemaBody = ContractPayload<"eventSchemas", "create">;

export function requireEventSchemaBySlug<T extends { slug: string }>(
	schemas: readonly T[],
	slug: string,
): T {
	const schema = schemas.find((s) => s.slug === slug);
	return requirePresent(schema, `Event schema '${slug}' not found`);
}

export async function createEventSchema(client: Client, body: CreateEventSchemaBody) {
	return client.run((c) => c.eventSchemas.create({ payload: body }));
}

export async function listEventSchemas(client: Client, entitySchemaId: string) {
	return client.run((c) => c.eventSchemas.list({ urlParams: { entitySchemaId } }));
}
