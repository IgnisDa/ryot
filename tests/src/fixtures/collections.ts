import { requireObjectRecord, requirePresent } from "../test-support/assertions";
import type { Client } from "./auth";
import type { AppSchema } from "./entity-schemas";

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

	const collection = await client.run(
		(c) =>
			c.collections.create({
				payload: {
					name,
					description,
					...(membershipPropertiesSchema && { membershipPropertiesSchema }),
				},
			}),
		{ Cookie: cookies },
	);

	requirePresent(collection.id, `Failed to create collection '${name}'`);

	// TODO(Task 22): Remove this tests-only collection assertion once the public
	// AppContract exposes typed collection properties.
	return {
		...collection,
		properties: requireObjectRecord(
			collection.properties,
			"Collection properties must be an object",
		),
	};
}
