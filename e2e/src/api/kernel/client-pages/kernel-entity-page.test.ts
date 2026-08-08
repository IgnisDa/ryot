import { Effect } from "effect";

import {
	createAuthenticatedClient,
	checkClientPageFreshness,
	createCollection,
} from "~/fixtures/kernel";
import { assertCondition } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("kernel entity page E2E", () => {
	it.live("prepares a kernel-owned collection with the collection detail renderer", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const collection = yield* createCollection(client, {
				name: `Collection ${crypto.randomUUID()}`,
			});
			const prepared = yield* client.call((contract) =>
				contract.clientPages.prepare({
					payload: { target: { kind: "entity", entityId: collection.id } },
				}),
			);
			assertCondition(
				prepared.identity.kind === "kernel-entity-page",
				"Expected kernel entity page preparation identity",
			);
			expect(prepared.identity.rendererName).toBe("Collection detail");
			expect(prepared.identity.entitySchemaSlug).toBe("collection");
			expect(prepared.context.renderer).toEqual({ kind: "kernel", name: "Collection detail" });
			expect(prepared.context.target).toMatchObject({
				kind: "entity",
				entityId: collection.id,
				entitySchemaPluginId: null,
				entitySchemaSlug: "collection",
			});
			expect((yield* checkClientPageFreshness(client, prepared.identity)).current).toBe(true);
		}),
	);

	it.live("reuses the durable kernel entity build", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const collection = yield* createCollection(client);
			const first = yield* client.call((contract) =>
				contract.clientPages.prepare({
					payload: { target: { kind: "entity", entityId: collection.id } },
				}),
			);
			const second = yield* client.call((contract) =>
				contract.clientPages.prepare({
					payload: { target: { kind: "entity", entityId: collection.id } },
				}),
			);
			assertCondition(
				first.identity.kind === "kernel-entity-page" &&
					second.identity.kind === "kernel-entity-page",
				"Expected kernel entity page preparation identities",
			);
			expect(second.identity.artifactKey).toBe(first.identity.artifactKey);
			expect(second.identity.artifactHash).toBe(first.identity.artifactHash);
		}),
	);
});
