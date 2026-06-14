import { EntitySchemaId } from "@ryot/app-backend/schema/brands";
import type { AppSchema } from "@ryot/app-backend/schema/property-schema";

import { requirePresent } from "../test-support/assertions";
import type { Client } from "./auth";
import type { ContractPayload } from "./contract-client";

type CreateRelationshipSchemaBody = ContractPayload<"relationshipSchemas", "create">;

export interface CreateRelationshipSchemaOptions
	extends Omit<CreateRelationshipSchemaBody, "propertiesSchema"> {
	propertiesSchema?: AppSchema;
}

export function requireRelationshipSchemaBySlug<T extends { slug: string }>(
	schemas: readonly T[],
	slug: string,
): T {
	const schema = schemas.find((s) => s.slug === slug);
	return requirePresent(schema, `Relationship schema '${slug}' not found`);
}

export async function createRelationshipSchema(client: Client, body: CreateRelationshipSchemaOptions) {
	return client.run((c) =>
		c.relationshipSchemas.create({
			payload: {
				...body,
				propertiesSchema: body.propertiesSchema ?? { fields: {} },
			},
		}),
	);
}

export async function listRelationshipSchemas(
	client: Client,
	options: {
		slugs?: string[];
		sourceEntitySchemaId?: string | null;
		targetEntitySchemaId?: string | null;
	} = {},
) {
	return client.run((c) =>
		c.relationshipSchemas.list({
			payload: {
				slugs: options.slugs,
				sourceEntitySchemaId:
					options.sourceEntitySchemaId === undefined || options.sourceEntitySchemaId === null
						? options.sourceEntitySchemaId
						: EntitySchemaId.make(options.sourceEntitySchemaId),
				targetEntitySchemaId:
					options.targetEntitySchemaId === undefined || options.targetEntitySchemaId === null
						? options.targetEntitySchemaId
						: EntitySchemaId.make(options.targetEntitySchemaId),
			},
		}),
	);
}
