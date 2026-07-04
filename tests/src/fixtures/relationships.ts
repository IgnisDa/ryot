import type { Client } from "./auth";
import type { ContractPayload } from "./contract-client";

type CreateRelationshipBody = ContractPayload<"relationships", "create">;

export const createRelationship = (client: Client, body: CreateRelationshipBody) =>
	client.call((c) => c.relationships.create({ payload: body }));
