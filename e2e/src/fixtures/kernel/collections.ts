import type { ContractPayload } from "@ryot-app/contract/client";
import { Effect } from "effect";

import { requireObjectRecord, requirePresent } from "~/support/assertions";

import type { Client } from "./auth";

export type CreateCollectionOptions = Partial<ContractPayload<"collections", "create">>;

export const createCollection = (client: Client, options: CreateCollectionOptions = {}) =>
	Effect.gen(function* () {
		const {
			fields,
			description = "A test collection",
			name = `Test Collection ${crypto.randomUUID()}`,
		} = options;

		const collection = yield* client.call((c) =>
			c.collections.create({ payload: { name, description, ...(fields && { fields }) } }),
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
