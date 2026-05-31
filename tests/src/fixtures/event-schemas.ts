import { EntitySchemaId } from "@ryot/contract/schema/brands";
import type { AppSchema } from "@ryot/contract/schema/property-schema";

import { requirePresent } from "../test-support/assertions";
import type { Client } from "./auth";
import type { ContractPayload } from "./contract-client";

type CreateEventSchemaBody = ContractPayload<"eventSchemas", "create">;

export interface CreateEventSchemaOptions extends Omit<CreateEventSchemaBody, "propertiesSchema"> {
	propertiesSchema?: AppSchema;
}

export function requireEventSchemaBySlug<T extends { slug: string }>(
	schemas: readonly T[],
	slug: string,
): T {
	const schema = schemas.find((s) => s.slug === slug);
	return requirePresent(schema, `Event schema '${slug}' not found`);
}

export async function createEventSchema(client: Client, body: CreateEventSchemaOptions) {
	return client.run((c) =>
		c.eventSchemas.create({
			payload: {
				...body,
				propertiesSchema: body.propertiesSchema ?? {
					fields: { note: { label: "Note", description: "Note", type: "string" as const } },
				},
			},
		}),
	);
}

export async function listEventSchemas(client: Client, entitySchemaId: string) {
	return client.run((c) =>
		c.eventSchemas.list({ urlParams: { entitySchemaId: EntitySchemaId.make(entitySchemaId) } }),
	);
}
