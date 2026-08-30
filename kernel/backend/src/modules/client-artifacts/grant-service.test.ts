import { expect, layer } from "@effect/vitest";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref } from "effect";

import { RedisService } from "#lib/infrastructure/redis";
import { ReusableCapabilityGrantStore } from "#lib/infrastructure/reusable-capability-grants";
import { makeRedisService } from "#lib/test-utils/effect";

import { ClientArtifactGrantService } from "./grant-service";

const without = (key: string) => (all: ReadonlyMap<string, string>) => {
	const next = new Map(all);
	next.delete(key);
	return next;
};

class FakeRedisStore extends Context.Service<
	FakeRedisStore,
	{ readonly delete: (key: string) => Effect.Effect<void> }
>()("test/FakeRedisStore") {}

const fakeRedisLayer = Layer.effectContext(
	Effect.gen(function* () {
		const data = yield* Ref.make<ReadonlyMap<string, string>>(new Map());
		const run = Effect.runPromiseWith(yield* Effect.context());
		const redis = makeRedisService({
			get: (key) => Effect.map(Ref.get(data), (all) => all.get(key) ?? null),
			set: (key, value) => Ref.update(data, (all) => new Map(all).set(key, value)),
			releaseLease: (key, value) =>
				Ref.update(data, (all) => (all.get(key) === value ? without(key)(all) : all)),
			client: Object.assign(Object.create(null), {
				ttl: (key: string) => run(Effect.map(Ref.get(data), (all) => (all.has(key) ? 900 : -2))),
				set: (key: string, value: string) =>
					run(
						Ref.modify(data, (all) =>
							all.has(key) ? [null, all] : ["OK", new Map(all).set(key, value)],
						),
					),
			}),
		});
		return Context.make(RedisService, redis).pipe(
			Context.add(FakeRedisStore, { delete: (key) => Ref.update(data, without(key)) }),
		);
	}),
);

const grantServiceLayer = ClientArtifactGrantService.layer.pipe(
	Layer.provide(ReusableCapabilityGrantStore.layer),
	Layer.provideMerge(fakeRedisLayer),
);

layer(grantServiceLayer)((test) => {
	test.effect(
		"reuses grants only for the same user and artifact and rejects expired or malformed tokens",
		() => {
			const user = UserId.make("user-1");
			const other = UserId.make("user-2");
			return Effect.gen(function* () {
				const grants = yield* ClientArtifactGrantService;
				const first = yield* grants.issue(user, "artifact-A");
				expect((yield* grants.issue(user, "artifact-A")).token).toBe(first.token);
				expect((yield* grants.issue(other, "artifact-A")).token).not.toBe(first.token);
				expect((yield* grants.issue(user, "artifact-B")).token).not.toBe(first.token);
				expect(yield* grants.resolve(first.token)).toEqual({
					userId: user,
					artifactHash: "artifact-A",
				});
				expect(yield* grants.resolve("bad")).toBeNull();
				yield* (yield* FakeRedisStore).delete(`ryot:client-artifacts:grant:${first.grantId}`);
				expect(yield* grants.resolve(first.token)).toBeNull();
				expect((yield* grants.issue(user, "artifact-A")).token).not.toBe(first.token);
			});
		},
	);
});
