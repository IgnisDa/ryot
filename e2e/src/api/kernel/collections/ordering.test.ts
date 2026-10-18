import type { ContractRequest } from "@ryot-app/contract/client";
import { collectionMembersRecipe } from "@ryot-app/ryotql-recipes/collections";
import { DateTime, Effect } from "effect";

import {
	createAuthenticatedClient,
	createCollection,
	executeRyotQLRecipe,
} from "~/fixtures/kernel";
import { assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("collection member ordering", () => {
	it.live("moves, replays, preserves metadata and refuses stale continuation pages", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const collection = yield* createCollection(client, {
				name: "Manual order",
				fields: [{ type: "text", label: "Notes", required: false }],
			});
			const members = yield* Effect.forEach(["Alpha", "Beta", "Gamma", "Delta"], (name) =>
				createCollection(client, { name }),
			);
			for (const member of members) {
				yield* client.call((api) =>
					api.collections.createMembership({
						payload: {
							entityId: member.id,
							collectionId: collection.id,
							properties: { notes: member.name },
						},
					}),
				);
			}
			const firstMember = members[0];
			const lastMember = members[3];
			if (!firstMember || !lastMember) {
				return yield* Effect.die("Missing ordering fixture");
			}
			const read = (after?: string) =>
				executeRyotQLRecipe(
					client,
					collectionMembersRecipe({
						limit: 2,
						collectionId: collection.id,
						membershipPropertiesSchema: null,
						...(after === undefined ? {} : { after }),
					}),
				);
			const first = yield* read();
			expect(first.items.map((member) => member.name)).toEqual(["Delta", "Gamma"]);
			const cursor = first.pageInfo.nextCursor;
			if (cursor === null) {
				return yield* Effect.die("Missing continuation cursor");
			}
			const request: ContractRequest<"collections", "reorderMembership"> = {
				payload: {
					entityId: firstMember.id,
					collectionId: collection.id,
					destination: { kind: "start" },
					idempotencyKey: crypto.randomUUID(),
					expectedRevision: first.orderRevision,
					submittedAt: (yield* DateTime.nowAsDate).toISOString(),
				},
			};
			const moved = yield* client.call((api) => api.collections.reorderMembership(request));
			expect((yield* read()).items.map((member) => member.name)).toEqual(["Alpha", "Delta"]);
			const stalePage = yield* read(cursor);
			expect(stalePage).toMatchObject({
				items: [],
				stale: true,
				orderRevision: moved.orderRevision,
			});
			const nextRequest: ContractRequest<"collections", "reorderMembership"> = {
				payload: {
					...request.payload,
					entityId: lastMember.id,
					destination: { kind: "end" },
					idempotencyKey: crypto.randomUUID(),
					expectedRevision: moved.orderRevision,
				},
			};
			yield* client.call((api) => api.collections.reorderMembership(nextRequest));
			expect(yield* client.call((api) => api.collections.reorderMembership(request))).toEqual(
				moved,
			);
			expect((yield* read()).items.map((member) => member.name)).toEqual(["Alpha", "Gamma"]);
			const conflict = yield* Effect.flip(
				client.call((api) =>
					api.collections.reorderMembership({
						payload: { ...request.payload, idempotencyKey: crypto.randomUUID() },
					}),
				),
			);
			assertTaggedError(conflict, "CollectionConflict");
			expect(conflict.reason.code).toBe("order-stale");
			const identityConflict = yield* Effect.flip(
				client.call((api) =>
					api.collections.reorderMembership({
						payload: { ...request.payload, destination: { kind: "end" } },
					}),
				),
			);
			assertTaggedError(identityConflict, "CollectionConflict");
			expect(identityConflict.reason.code).toBe("command-identity-conflict");
			yield* client.call((api) =>
				api.collections.createMembership({
					payload: {
						entityId: firstMember.id,
						collectionId: collection.id,
						properties: { notes: "Updated" },
					},
				}),
			);
			expect((yield* read()).items.map((member) => member.name)).toEqual(["Alpha", "Gamma"]);
			return undefined;
		}),
	);

	it.live("serializes concurrent moves and rejects another user's collection", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { client: other } = yield* createAuthenticatedClient();
			const collection = yield* createCollection(client, { name: "Concurrent order" });
			const members = yield* Effect.forEach(["One", "Two", "Three"], (name) =>
				createCollection(client, { name }),
			);
			for (const member of members) {
				yield* client.call((api) =>
					api.collections.createMembership({
						payload: { entityId: member.id, collectionId: collection.id },
					}),
				);
			}
			const page = yield* executeRyotQLRecipe(
				client,
				collectionMembersRecipe({ collectionId: collection.id, membershipPropertiesSchema: null }),
			);
			const submittedAt = (yield* DateTime.nowAsDate).toISOString();
			const requests = members
				.slice(0, 2)
				.map((member): ContractRequest<"collections", "reorderMembership"> => ({
					payload: {
						submittedAt,
						entityId: member.id,
						collectionId: collection.id,
						destination: { kind: "start" },
						idempotencyKey: crypto.randomUUID(),
						expectedRevision: page.orderRevision,
					},
				}));
			const outcomes = yield* Effect.forEach(
				requests,
				(request) =>
					Effect.result(client.call((api) => api.collections.reorderMembership(request))),
				{ concurrency: "unbounded" },
			);
			expect(outcomes.filter((outcome) => outcome._tag === "Success")).toHaveLength(1);
			const failed = outcomes.find((outcome) => outcome._tag === "Failure");
			if (failed?._tag !== "Failure") {
				return yield* Effect.die("Expected stale move");
			}
			assertTaggedError(failed.failure, "CollectionConflict");
			expect(failed.failure.reason.code).toBe("order-stale");
			const request = requests[0];
			if (!request) {
				return yield* Effect.die("Missing move request");
			}
			const forbidden = yield* Effect.flip(
				other.call((api) => api.collections.reorderMembership(request)),
			);
			assertTaggedError(forbidden, "CollectionNotFound");
			return undefined;
		}),
	);
});
