import type { Client } from "./auth";
import type { ContractPayload } from "./contract-client";

type CreateRelationshipBody = ContractPayload<"relationships", "create">;

export async function createRelationship(client: Client, body: CreateRelationshipBody) {
	return client.run((c) => c.relationships.create({ payload: body }));
}
