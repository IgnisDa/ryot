import { EntitySchemaId } from "@ryot/contract/schema/brands";
import type { AppSchema } from "@ryot/contract/schema/property-schema";

import { requirePresent } from "~/support/assertions";

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

export const createEventSchema = (client: Client, body: CreateEventSchemaOptions) =>
	client.call((c) =>
		c.eventSchemas.create({
			payload: {
				...body,
				propertiesSchema: body.propertiesSchema ?? {
					fields: { note: { label: "Note", description: "Note", type: "string" as const } },
				},
			},
		}),
	);

export const listEventSchemas = (client: Client, entitySchemaId: string) =>
	client.call((c) =>
		c.eventSchemas.list({ urlParams: { entitySchemaId: EntitySchemaId.make(entitySchemaId) } }),
	);
