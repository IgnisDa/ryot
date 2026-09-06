import { expect, it } from "@effect/vitest";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";

import { RedisService } from "#lib/infrastructure/redis";
import { ReusableCapabilityGrantStore } from "#lib/infrastructure/reusable-capability-grants";
import { makeRedisService } from "#lib/test-utils/effect";

import { ClientArtifactGrantService } from "./grant-service";

it.effect(
	"reuses grants only for the same user and artifact and rejects expired or malformed tokens",
	() => {
		const data = new Map<string, string>();
		const redis = makeRedisService({
			get: (key) => Effect.succeed(data.get(key) ?? null),
			set: (key, value) =>
				Effect.sync(() => {
					data.set(key, value);
				}),
			releaseLease: (key, value) =>
				Effect.sync(() => {
					if (data.get(key) === value) {
						data.delete(key);
					}
				}),
			client: Object.assign(Object.create(null), {
				ttl: (key: string) => Promise.resolve(data.has(key) ? 900 : -2),
				set: (key: string, value: string) =>
					Promise.resolve(data.has(key) ? null : (data.set(key, value), "OK")),
			}),
		});
		const layer = ClientArtifactGrantService.layer.pipe(
			Layer.provide(
				ReusableCapabilityGrantStore.layer.pipe(Layer.provide(Layer.succeed(RedisService, redis))),
			),
		);
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
			data.delete(`ryot:client-artifacts:grant:${first.grantId}`);
			expect(yield* grants.resolve(first.token)).toBeNull();
			expect((yield* grants.issue(user, "artifact-A")).token).not.toBe(first.token);
		}).pipe(Effect.provide(layer));
	},
);
