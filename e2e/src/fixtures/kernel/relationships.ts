import type { ContractPayload, ContractSuccess } from "@ryot-app/contract/client";
import { EntityId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import { requirePresent } from "~/support/assertions";

import type { Client } from "./auth";

type CreateRelationshipBody = ContractPayload<"relationships", "create">;
type CreateRelationshipResult = ContractSuccess<"relationships", "create">;

export const createRelationship = (client: Client, body: CreateRelationshipBody) =>
	Effect.gen(function* () {
		const result: CreateRelationshipResult = yield* client.call((c) =>
			c.relationships.create({ payload: body }),
		);
		const relationship = requirePresent(result.relationship, "Failed to create relationship");
		return { ...relationship, warnings: result.warnings };
	});

export const insertRelationshipRow = (
	client: Client,
	input: {
		sourceEntityId: string;
		targetEntityId: string;
		relationshipSchema: CreateRelationshipBody["relationshipSchema"];
		properties?: Record<string, unknown>;
	},
) =>
	createRelationship(client, {
		properties: input.properties,
		relationshipSchema: input.relationshipSchema,
		sourceEntityId: EntityId.make(input.sourceEntityId),
		targetEntityId: EntityId.make(input.targetEntityId),
	});
