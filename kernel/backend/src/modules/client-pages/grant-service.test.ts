import { expect, layer } from "@effect/vitest";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref } from "effect";

import { ReusableCapabilityGrantStore } from "#lib/infrastructure/reusable-capability-grants";

import { ClientDocumentGrantService } from "./grant-service";

type ReusableGrant = { token: string; grantId: string; expiresAt: string };

class FakeGrantStore extends Context.Service<
	FakeGrantStore,
	{ readonly reuseKeys: Effect.Effect<ReadonlyArray<string>> }
>()("test/FakeGrantStore") {}

const fakeGrantStoreLayer = Layer.effectContext(
	Effect.gen(function* () {
		const payloads = yield* Ref.make<ReadonlyMap<string, string>>(new Map());
		const reusable = yield* Ref.make<ReadonlyMap<string, ReusableGrant>>(new Map());
		return Context.make(
			ReusableCapabilityGrantStore,
			ReusableCapabilityGrantStore.of({
				resolve: (token) => Effect.map(Ref.get(payloads), (all) => all.get(token) ?? null),
				issue: ({ payload, reuseKey }) =>
					Effect.gen(function* () {
						const grants = yield* Ref.get(reusable);
						const existing = grants.get(reuseKey);
						if (existing) {
							return existing;
						}
						const value = {
							grantId: "id",
							expiresAt: "2026-01-01T00:00:00Z",
							token: String.fromCharCode(97 + grants.size).repeat(43),
						};
						yield* Ref.set(reusable, new Map(grants).set(reuseKey, value));
						yield* Ref.update(payloads, (all) => new Map(all).set(value.token, payload));
						return value;
					}),
			}),
		).pipe(
			Context.add(FakeGrantStore, {
				reuseKeys: Effect.map(Ref.get(reusable), (all) => [...all.keys()]),
			}),
		);
	}),
);

layer(ClientDocumentGrantService.layer.pipe(Layer.provideMerge(fakeGrantStoreLayer)))((test) => {
	test.effect("binds a reusable document capability to user and composition", () =>
		Effect.gen(function* () {
			const service = yield* ClientDocumentGrantService;
			const first = yield* service.issue(UserId.make("user-1"), "hash-1");
			const again = yield* service.issue(UserId.make("user-1"), "hash-1");
			expect(again.src).toBe(first.src);
			const another = yield* service.issue(UserId.make("user-2"), "hash-1");
			expect(yield* (yield* FakeGrantStore).reuseKeys).toHaveLength(2);
			expect(another.src).not.toBe(first.src);
			expect(first.src).toBe(`/api/client-pages/documents/${"a".repeat(43)}`);
			expect(yield* service.resolve("a".repeat(43))).toEqual({
				userId: "user-1",
				compositionHash: "hash-1",
			});
			expect(yield* service.resolve("b".repeat(43))).toEqual({
				userId: "user-2",
				compositionHash: "hash-1",
			});
		}),
	);
});
