import { EntityId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import { adminHeaders } from "~/fixtures/kernel/admin";
import { getApiClient } from "~/fixtures/kernel/contract-client";

import { seedMediaEntity } from "./media";

const markEntityPopulated = (entityId: string) =>
	getApiClient().call(
		(c) =>
			c.testSupport.setEntityPopulatedAt({
				params: { entityId: EntityId.make(entityId) },
				payload: { populatedAt: new Date().toISOString() },
			}),
		adminHeaders,
	);

export const seedPopulatedProviderEntity = (input: {
	name: string;
	externalId: string;
	entitySchemaSlug: string;
	providerId: string;
	properties: Record<string, unknown>;
}) =>
	Effect.gen(function* () {
		const seeded = yield* seedMediaEntity({
			userId: null,
			name: input.name,
			externalId: input.externalId,
			properties: input.properties,
			entitySchemaSlug: input.entitySchemaSlug,
			providerId: input.providerId,
		});
		yield* markEntityPopulated(seeded.id);

		return seeded;
	});
