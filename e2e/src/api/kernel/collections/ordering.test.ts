import type { ContractRequest } from "@ryot-app/contract/client";
import { collectionArguments, collectionMembersRecipe } from "@ryot-app/ryotql-recipes/collections";
import { Effect } from "effect";

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
				executeRyotQLRecipe(client, collectionMembersRecipe(), collectionArguments(collection.id), {
					pages: { members: { after, limit: 2 } },
				});
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
					expectedRevision: first.orderRevision,
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
					expectedRevision: moved.orderRevision,
				},
			};
			const next = yield* client.call((api) => api.collections.reorderMembership(nextRequest));
			expect(yield* client.call((api) => api.collections.reorderMembership(request))).toEqual(next);
			expect((yield* read()).items.map((member) => member.name)).toEqual(["Alpha", "Gamma"]);
			const conflict = yield* Effect.flip(
				client.call((api) =>
					api.collections.reorderMembership({
						payload: { ...request.payload, destination: { kind: "end" } },
					}),
				),
			);
			assertTaggedError(conflict, "CollectionConflict");
			expect(conflict.reason.code).toBe("order-stale");
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
				collectionMembersRecipe(),
				collectionArguments(collection.id),
			);
			const requests = members
				.slice(0, 2)
				.map((member): ContractRequest<"collections", "reorderMembership"> => ({
					payload: {
						entityId: member.id,
						collectionId: collection.id,
						destination: { kind: "start" },
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
