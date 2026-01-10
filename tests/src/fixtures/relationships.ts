import type { ContractPayload } from "@ryot/contract/client";

import type { Client } from "./auth";

type CreateRelationshipBody = ContractPayload<"relationships", "create">;

export const createRelationship = (client: Client, body: CreateRelationshipBody) =>
	client.call((c) => c.relationships.create({ payload: body }));
