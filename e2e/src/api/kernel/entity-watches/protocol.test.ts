import {
	MAX_FOREGROUND_ENTITY_IDS,
	MAX_INTEREST_ENTITY_IDS,
} from "@ryot-app/contract/modules/entity-watches/messages";
import { Effect } from "effect";

import { createAuthenticatedClient, openInterestWebSocketScoped } from "~/fixtures/kernel";
import { findMediaEntitySchema, seedPopulatedProviderEntity } from "~/fixtures/plugins/media";
import { assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("entity interest protocol", () => {
	it.live("deduplicates IDs and rejects over-limit snapshots without changing the revision", () =>
		Effect.gen(function* () {
			const auth = yield* createAuthenticatedClient();
			const { schema } = yield* findMediaEntitySchema(auth.client, "company");
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

			expect(yield* socket.replaceInterest(Array.from({ length: 501 }, () => entity.id))).toEqual({
				revision: 1,
				type: "applied",
			});

			const additionalIds = Array.from({ length: MAX_INTEREST_ENTITY_IDS }, () =>
				crypto.randomUUID(),
			);
			expect(yield* socket.replaceInterest([entity.id, ...additionalIds])).toEqual({
				revision: 2,
				type: "rejected",
				code: "interest-limit-exceeded",
				maxEntityIds: MAX_INTEREST_ENTITY_IDS,
			});

			expect(
				yield* socket.replaceInterest(
					additionalIds,
					additionalIds.slice(0, MAX_FOREGROUND_ENTITY_IDS),
				),
			).toEqual({ revision: 2, type: "applied" });
		}),
	);
});
