import { Effect } from "effect";

import {
	createAuthenticatedClient,
	findBuiltinSchemaBySlug,
	openInterestStreamScoped,
	postBackendJson,
	seedMediaEntity,
} from "~/fixtures";
import { assertPresent } from "~/support/assertions";
import { getBackendUrl } from "~/support/backend";
import { describe, expect, it } from "~/support/effect-test";

describe("interest authorization", () => {
	it.live("ignores interest declared in another user's private entity", () =>
		Effect.gen(function* () {
			const authA = yield* createAuthenticatedClient();
			const authB = yield* createAuthenticatedClient();

			const { schema } = yield* findBuiltinSchemaBySlug(authA.client, "company");
			const providerId = schema.providers.find(
				(provider) => provider.name === "Anilist",
			)?.providerId;
			assertPresent(providerId, "Anilist company provider not found");

			const privateEntity = yield* seedMediaEntity({
				properties: {},
				providerId,
				client: authA.client,
				userId: authA.userId,
				entitySchemaSlug: schema.id,
				name: "A's Private Studio",
				externalId: `private-${crypto.randomUUID()}`,
			});

			const streamB = yield* openInterestStreamScoped(authB);
			yield* Effect.promise(() => streamB.declareInterest([privateEntity.id]));
			yield* Effect.promise(() =>
				streamB.expectNoEntityUpdated(privateEntity.id, { windowMs: 4000 }),
			);

			const entity = yield* authA.client.call((contract) =>
				contract.entities.get({ params: { entityId: privateEntity.id } }),
			);
			expect(entity.populatedAt).toBeNull();
		}),
	);

	it.live("rejects an unauthenticated stream connection", () =>
		Effect.gen(function* () {
			const response = yield* Effect.promise(() =>
				fetch(`${getBackendUrl()}/entity-interest/stream?streamId=${crypto.randomUUID()}`),
			);
			expect(response.status).toBe(401);
		}),
	);

	it.live("rejects an unauthenticated interest declaration", () =>
		Effect.gen(function* () {
			const response = yield* Effect.promise(() =>
				postBackendJson("/entity-interest", {
					entityIds: [],
					streamId: crypto.randomUUID(),
				}),
			);
			expect(response.status).toBe(401);
		}),
	);

	it.live("rejects declaring interest on another user's stream", () =>
		Effect.gen(function* () {
			const authA = yield* createAuthenticatedClient();
			const authB = yield* createAuthenticatedClient();

			const streamA = yield* openInterestStreamScoped(authA);
			const response = yield* Effect.promise(() =>
				postBackendJson(
					"/entity-interest",
					{ streamId: streamA.streamId, entityIds: [] },
					authB.cookies,
				),
			);
			expect(response.status).toBe(404);
		}),
	);
});
