import { requirePresent, requireResponseData } from "../test-support/assertions";
import type { Client } from "./auth";
import type { AppSchema } from "./entity-schemas";

// TODO(Task 22): Replace these tests-only event schema types with the public
// AppContract types once the create/list event schema payloads are fully typed.
type CreateEventSchemaBody = {
	entitySchemaId: string;
	name: string;
	slug: string;
	propertiesSchema: AppSchema;
};

type EventSchemaRecord = CreateEventSchemaBody & {
	id: string;
	createdAt?: string;
	updatedAt?: string;
	isBuiltin?: boolean;
};

// TODO(Task 22): Replace these tests-only event schema assertions with the public
// AppContract types once the event schema response fields are typed.
const toEventSchemaRecord = (value: unknown) => value as EventSchemaRecord;

// TODO(Task 22): Replace these tests-only event schema assertions with the public
// AppContract types once the event schema response fields are typed.
const toEventSchemaRecords = (value: unknown) => value as readonly EventSchemaRecord[];

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
	const typedEventSchema = toEventSchemaRecord(eventSchema);
	requirePresent(typedEventSchema.id, `Failed to create event schema '${body.name}'`);
	return typedEventSchema;
}

export async function listEventSchemas(client: Client, cookies: string, entitySchemaId: string) {
	const { data, response } = await client["event-schemas"].list({
		headers: { Cookie: cookies },
		params: { query: { entitySchemaId } },
	});

	return toEventSchemaRecords(
		requireResponseData(response, data, `Failed to list event schemas for '${entitySchemaId}'`),
	);
}
