import { Effect } from "effect";

import { markEntityPopulated } from "~/fixtures/kernel/entities";

import { seedMediaEntity } from "./media";

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
			providerId: input.providerId,
			entitySchemaSlug: input.entitySchemaSlug,
		});
		yield* markEntityPopulated(seeded.id);

		return seeded;
	});
