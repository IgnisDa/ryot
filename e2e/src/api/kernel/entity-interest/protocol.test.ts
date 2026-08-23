import { MAX_INTEREST_ENTITY_IDS } from "@ryot-app/contract/modules/entity-interest/messages";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	findBuiltinSchemaBySlug,
	openInterestWebSocketScoped,
} from "~/fixtures/kernel";
import { seedPopulatedProviderEntity } from "~/fixtures/plugins/media";
import { assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("entity interest protocol", () => {
	it.live("deduplicates IDs and rejects over-limit updates without changing the revision", () =>
		Effect.gen(function* () {
			const auth = yield* createAuthenticatedClient();
			const { schema } = yield* findBuiltinSchemaBySlug(auth.client, "company");
			const providerId = schema.providers.find(({ name }) => name === "Anilist")?.providerId;
			assertPresent(providerId, "Anilist company provider not found");
			const entity = yield* seedPopulatedProviderEntity({
				providerId,
				properties: {},
				entitySchemaSlug: schema.id,
				name: "Interest Limit Company",
				externalId: `interest-limit-${crypto.randomUUID()}`,
			});
			const socket = yield* openInterestWebSocketScoped(auth);
			expect(socket.ready.maxEntityIds).toBe(MAX_INTEREST_ENTITY_IDS);

			expect(
				yield* Effect.promise(() =>
					socket.replaceInterest(Array.from({ length: 501 }, () => entity.id)),
				),
			).toEqual({ revision: 1, type: "applied" });

			const additionalIds = Array.from(
				{ length: MAX_INTEREST_ENTITY_IDS },
				(_, index) => `interest-limit-${crypto.randomUUID()}-${index}`,
			);
			expect(
				yield* Effect.promise(() => socket.updateInterest({ remove: [], add: additionalIds })),
			).toEqual({
				revision: 2,
				type: "rejected",
				code: "interest-limit-exceeded",
				maxEntityIds: MAX_INTEREST_ENTITY_IDS,
			});

			expect(
				yield* Effect.promise(() =>
					socket.updateInterest({ add: additionalIds, remove: [entity.id] }),
				),
			).toEqual({ revision: 2, type: "applied" });
		}),
	);
});
