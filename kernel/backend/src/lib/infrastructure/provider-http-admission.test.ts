import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { assertExitFails } from "#lib/test-utils/assertions";
import { makeRedisService } from "#lib/test-utils/effect";

import {
	ProviderHttpAdmissionCorruptState,
	ProviderHttpAdmissionService,
	ProviderHttpAdmissionUnavailable,
	type ProviderHttpAdmissionDeclaration,
} from "./provider-http-admission";
import { redisKeys, RedisService } from "./redis";

type RedisClient = RedisService["Service"]["client"];

type AdmissionState = {
	hash: string;
	expiresAtMs: number;
	nextEligibleMs: number;
	blockedUntilMs: number;
};

const declaration = {
	requests: 3,
	intervalMs: 1_000,
	hash: "declaration-v1",
	key: "global/provider:one",
} satisfies ProviderHttpAdmissionDeclaration;

const makeLayer = (client: RedisClient) =>
	ProviderHttpAdmissionService.layer.pipe(
		Layer.provide(Layer.succeed(RedisService, makeRedisService({ client }))),
	);

const withAdmission = <A, E>(
	client: RedisClient,
	f: (service: ProviderHttpAdmissionService["Service"]) => Effect.Effect<A, E>,
) =>
	Effect.gen(function* () {
		return yield* f(yield* ProviderHttpAdmissionService);
	}).pipe(Effect.provide(makeLayer(client)));

class SharedAdmissionRedis {
	readonly states = new Map<string, AdmissionState>();
	readonly calls: Array<{ key: string; operation: string; ttlMs: number }> = [];
	nowMs = 1_000;

	readonly client = Object.assign(Object.create(null), {
		eval: (
			_script: string,
			_numKeys: number,
			key: string,
			operation: string,
			hash: string,
			valueText: string,
			ttlText: string,
		) => {
			const value = Number(valueText);
			const ttlMs = Number(ttlText);
			this.calls.push({ key, operation, ttlMs });
			const current = this.states.get(key);

			if (operation === "reserve") {
				const blockedUntilMs = current?.blockedUntilMs ?? 0;
				const nextEligibleMs = current?.hash === hash ? current.nextEligibleMs : this.nowMs;
				const eligibleAtMs = Math.max(this.nowMs, nextEligibleMs, blockedUntilMs);
				this.states.set(key, {
					hash,
					blockedUntilMs,
					nextEligibleMs: eligibleAtMs + value,
					expiresAtMs: Math.max(this.nowMs, blockedUntilMs) + ttlMs,
				});
				return Promise.resolve(["reserved", String(eligibleAtMs), hash, String(this.nowMs)]);
			}

			if (!current || current.hash !== hash) {
				return Promise.resolve(["stale"]);
			}

			if (operation === "confirm") {
				current.expiresAtMs = Math.max(this.nowMs, current.blockedUntilMs) + ttlMs;
				const eligibleAtMs = Math.max(value, current.blockedUntilMs);
				return Promise.resolve(
					eligibleAtMs > this.nowMs
						? ["later", String(eligibleAtMs), String(this.nowMs)]
						: ["admitted"],
				);
			}

			if (operation === "block") {
				current.blockedUntilMs = Math.max(current.blockedUntilMs, value);
				current.expiresAtMs = Math.max(this.nowMs, current.blockedUntilMs) + ttlMs;
				return Promise.resolve(["blocked", String(current.blockedUntilMs), String(this.nowMs)]);
			}

			return Promise.resolve(["corrupt"]);
		},
	}) satisfies RedisClient;
}

describe("ProviderHttpAdmissionService", () => {
	it.effect(
		"constructs a safe centralized key, rounds spacing up, and applies the minimum TTL",
		() => {
			const redis = new SharedAdmissionRedis();

			return Effect.gen(function* () {
				const tokens = yield* withAdmission(redis.client, (service) =>
					Effect.all([
						service.reserve(declaration),
						service.reserve(declaration),
						service.reserve(declaration),
					]),
				);

				expect(tokens).toEqual([
					{ eligibleAtMs: 1_000, observedAtMs: 1_000, declarationHash: declaration.hash },
					{ eligibleAtMs: 1_334, observedAtMs: 1_000, declarationHash: declaration.hash },
					{ eligibleAtMs: 1_668, observedAtMs: 1_000, declarationHash: declaration.hash },
				]);
				expect(redis.calls).toEqual([
					{
						ttlMs: 60_000,
						operation: "reserve",
						key: "ryot:provider-http-admission:global%2Fprovider%3Aone",
					},
					{
						ttlMs: 60_000,
						operation: "reserve",
						key: "ryot:provider-http-admission:global%2Fprovider%3Aone",
					},
					{
						ttlMs: 60_000,
						operation: "reserve",
						key: "ryot:provider-http-admission:global%2Fprovider%3Aone",
					},
				]);
			});
		},
	);

	it.effect(
		"shares unique slots across service instances and never reclaims abandoned reservations",
		() => {
			const redis = new SharedAdmissionRedis();
			const reserveFour = () =>
				withAdmission(redis.client, (service) =>
					Effect.all(Array.from({ length: 4 }, () => service.reserve(declaration))),
				);

			return Effect.gen(function* () {
				const tokens = (yield* Effect.all([reserveFour(), reserveFour()], {
					concurrency: "unbounded",
				})).flat();

				expect(tokens.map((token) => token.eligibleAtMs).sort((a, b) => a - b)).toEqual([
					1_000, 1_334, 1_668, 2_002, 2_336, 2_670, 3_004, 3_338,
				]);
				expect(new Set(tokens.map((token) => token.eligibleAtMs))).toHaveLength(8);
				expect(tokens.every((token) => token.observedAtMs === 1_000)).toBe(true);
			});
		},
	);

	it.effect(
		"confirms against the latest block without consuming a slot and advances blocks monotonically",
		() => {
			const redis = new SharedAdmissionRedis();
			const key = redisKeys.providerHttpAdmission(declaration.key);
			return Effect.gen(function* () {
				const token = yield* withAdmission(redis.client, (service) => service.reserve(declaration));
				const nextEligibleMs = redis.states.get(key)?.nextEligibleMs;
				const firstBlock = yield* withAdmission(redis.client, (service) =>
					service.block(declaration, 5_000),
				);
				const lowerBlock = yield* withAdmission(redis.client, (service) =>
					service.block(declaration, 4_000),
				);
				const delayed = yield* withAdmission(redis.client, (service) =>
					service.confirm(declaration, token),
				);

				expect(firstBlock).toEqual({
					status: "blocked",
					observedAtMs: 1_000,
					blockedUntilMs: 5_000,
				});
				expect(lowerBlock).toEqual({
					status: "blocked",
					observedAtMs: 1_000,
					blockedUntilMs: 5_000,
				});
				expect(delayed).toEqual({
					status: "later",
					eligibleAtMs: 5_000,
					observedAtMs: 1_000,
				});
				expect(redis.states.get(key)?.nextEligibleMs).toBe(nextEligibleMs);
				expect(redis.states.get(key)?.expiresAtMs).toBe(65_000);

				redis.nowMs = 5_000;
				expect(
					yield* withAdmission(redis.client, (service) => service.confirm(declaration, token)),
				).toEqual({ status: "admitted" });
				expect(redis.states.get(key)?.nextEligibleMs).toBe(nextEligibleMs);
			});
		},
	);

	it.effect("resets spacing on a hash change while preserving a live block", () => {
		const redis = new SharedAdmissionRedis();
		return Effect.gen(function* () {
			const oldToken = yield* withAdmission(redis.client, (service) =>
				service.reserve(declaration),
			);
			yield* withAdmission(redis.client, (service) => service.block(declaration, 8_000));
			const changed = { ...declaration, hash: "declaration-v2" };
			const newToken = yield* withAdmission(redis.client, (service) => service.reserve(changed));
			const oldConfirmation = yield* withAdmission(redis.client, (service) =>
				service.confirm(changed, oldToken),
			);
			const oldBlock = yield* withAdmission(redis.client, (service) =>
				service.block(declaration, 9_000),
			);

			expect(newToken).toEqual({
				eligibleAtMs: 8_000,
				observedAtMs: 1_000,
				declarationHash: "declaration-v2",
			});
			expect(oldConfirmation).toEqual({ status: "stale" });
			expect(oldBlock).toEqual({ status: "stale" });
			expect(redis.states.get(redisKeys.providerHttpAdmission(declaration.key))).toMatchObject({
				expiresAtMs: 68_000,
				blockedUntilMs: 8_000,
				nextEligibleMs: 8_334,
				hash: "declaration-v2",
			});
		});
	});

	it.effect("uses ten intervals when that exceeds the minimum TTL", () => {
		const redis = new SharedAdmissionRedis();
		return Effect.gen(function* () {
			yield* withAdmission(redis.client, (service) =>
				service.reserve({ ...declaration, intervalMs: 10_000 }),
			);
			expect(redis.calls[0]?.ttlMs).toBe(100_000);
		});
	});

	it.effect("returns a typed unavailable failure for operational Redis errors", () => {
		const client = Object.assign(Object.create(null), {
			eval: () => Promise.reject(new Error("connection lost")),
		}) satisfies RedisClient;

		return Effect.gen(function* () {
			const exit = yield* Effect.exit(
				withAdmission(client, (service) => service.reserve(declaration)),
			);
			assertExitFails(
				exit,
				new ProviderHttpAdmissionUnavailable({
					message: "Redis admission command failed: connection lost",
				}),
			);
		});
	});

	const invalidResponses = [
		{ response: ["corrupt"], message: "Redis admission state is corrupt" },
		{
			response: ["reserved", "1000", "wrong-hash", "1000"],
			message: "Redis returned a mismatched declaration hash",
		},
		{
			response: ["reserved", "1e3", declaration.hash, "1000"],
			message: "Redis returned an invalid reservation timestamp",
		},
		{
			response: ["reserved", "1000", declaration.hash, "1e3"],
			message: "Redis returned an invalid observation timestamp",
		},
		{
			message: "Redis returned an invalid admission response",
			response: ["reserved", "1000", declaration.hash, "1000", "extra"],
		},
		{ response: { status: "reserved" }, message: "Redis returned an invalid admission response" },
	];

	it.effect("strictly validates Lua responses", () => {
		return Effect.gen(function* () {
			for (const { response, message } of invalidResponses) {
				const client = Object.assign(Object.create(null), {
					eval: () => Promise.resolve(response),
				}) satisfies RedisClient;
				const exit = yield* Effect.exit(
					withAdmission(client, (service) => service.reserve(declaration)),
				);
				assertExitFails(exit, new ProviderHttpAdmissionCorruptState({ message }));
			}
		});
	});
});
