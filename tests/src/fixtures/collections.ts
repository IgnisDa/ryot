import { Effect } from "effect";

import { requireObjectRecord, requirePresent } from "~/support/assertions";

import type { Client } from "./auth";
import type { AppSchema } from "./entity-schemas";

export interface CreateCollectionOptions {
	name?: string;
	description?: string;
	membershipPropertiesSchema?: AppSchema;
}

export const createCollection = (client: Client, options: CreateCollectionOptions = {}) =>
	Effect.gen(function* () {
		const {
			name = `Test Collection ${crypto.randomUUID()}`,
			description = "A test collection",
			membershipPropertiesSchema,
		} = options;

		const collection = yield* client.call((c) =>
			c.collections.create({
				payload: {
					name,
					description,
					...(membershipPropertiesSchema && { membershipPropertiesSchema }),
				},
			}),
		);

		requirePresent(collection.id, `Failed to create collection '${name}'`);

		return {
			...collection,
			properties: requireObjectRecord(
				collection.properties,
				"Collection properties must be an object",
			),
		};
	});
