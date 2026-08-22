import type { ContractPayload } from "@ryot/contract/client";
import { EntityId, RelationshipSchemaSlug } from "@ryot/contract/schema/brands";

import type { Client } from "./auth";

type CreateRelationshipBody = ContractPayload<"relationships", "create">;

export const createRelationship = (client: Client, body: CreateRelationshipBody) =>
	client.call((c) => c.relationships.create({ payload: body }));

export const insertRelationshipRow = (
	client: Client,
	input: {
		sourceEntityId: string;
		targetEntityId: string;
		relationshipSchemaSlug: string;
		properties?: Record<string, unknown>;
	},
) =>
	createRelationship(client, {
		properties: input.properties,
		sourceEntityId: EntityId.make(input.sourceEntityId),
		targetEntityId: EntityId.make(input.targetEntityId),
		relationshipSchemaSlug: RelationshipSchemaSlug.make(input.relationshipSchemaSlug),
	});
