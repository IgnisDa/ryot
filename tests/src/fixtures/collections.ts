import { requirePresent, requireResponseData } from "../test-support/assertions";
import type { Client } from "./auth";
import type { ClientSuccess } from "./backend-client";
import type { AppSchema } from "./entity-schemas";

type CollectionRecord = Omit<ClientSuccess<"collections", "create">, "properties"> & {
	properties: Record<string, unknown>;
};

export interface CreateCollectionOptions {
	name?: string;
	description?: string;
	membershipPropertiesSchema?: AppSchema;
}

export async function createCollection(
	client: Client,
	cookies: string,
	options: CreateCollectionOptions = {},
) {
	const {
		name = `Test Collection ${crypto.randomUUID()}`,
		description = "A test collection",
		membershipPropertiesSchema,
	} = options;

	const { data, response } = await client.collections.create({
		headers: { Cookie: cookies },
		body: { name, description, ...(membershipPropertiesSchema && { membershipPropertiesSchema }) },
	});

	const collection = requireResponseData(response, data, `Failed to create collection '${name}'`);
	requirePresent(collection.id, `Failed to create collection '${name}'`);

	// TODO(Task 22): Remove this tests-only collection assertion once the public
	// AppContract exposes typed collection properties.
	return collection as CollectionRecord;
}
