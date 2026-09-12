import { describe, expect, layer } from "@effect/vitest";
import { Context, Effect, Layer, MutableRef, Ref } from "effect";

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
	readonly hash: string;
	readonly expiresAtMs: number;
	readonly nextEligibleMs: number;
	readonly blockedUntilMs: number;
	readonly nextAdmissionMs: number;
};

type AdmissionCall = { readonly key: string; readonly operation: string; readonly ttlMs: number };

type EvalResponse = () => Promise<unknown>;

const declaration = {
	requests: 3,
	intervalMs: 1_000,
	hash: "declaration-v1",
	key: "global/provider:one",
} satisfies ProviderHttpAdmissionDeclaration;

class FakeAdmissionRedis extends Context.Service<
	FakeAdmissionRedis,
	{
		readonly states: Effect.Effect<ReadonlyMap<string, AdmissionState>>;
		readonly calls: Effect.Effect<ReadonlyArray<AdmissionCall>>;
		readonly setNow: (nowMs: number) => Effect.Effect<void>;
		readonly respondWith: (respond: EvalResponse) => Effect.Effect<void>;
	}
>()("test/FakeAdmissionRedis") {}

const fakeAdmissionRedisLayer = (respond?: EvalResponse) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const states = yield* Ref.make<ReadonlyMap<string, AdmissionState>>(new Map());
			const calls = yield* Ref.make<ReadonlyArray<AdmissionCall>>([]);
			const now = yield* Ref.make(1_000);
			const response = yield* Ref.make<EvalResponse | undefined>(respond);

			const store = (key: string, state: AdmissionState) =>
				MutableRef.update(states.ref, (all) => new Map(all).set(key, state));

			const simulate = (
				key: string,
				operation: string,
				hash: string,
				value: number,
				ttlMs: number,
				spacingMs: number,
			): ReadonlyArray<string> => {
				const nowMs = MutableRef.get(now.ref);
				MutableRef.update(calls.ref, (all) => [...all, { key, ttlMs, operation }]);
				const current = MutableRef.get(states.ref).get(key);

				if (operation === "reserve") {
					const blockedUntilMs = current?.blockedUntilMs ?? 0;
					const nextEligibleMs = current?.hash === hash ? current.nextEligibleMs : nowMs;
					const nextAdmissionMs = current?.hash === hash ? current.nextAdmissionMs : 0;
					const eligibleAtMs = Math.max(nowMs, nextEligibleMs, nextAdmissionMs, blockedUntilMs);
					store(key, {
						hash,
						blockedUntilMs,
						nextAdmissionMs,
						nextEligibleMs: eligibleAtMs + value,
						expiresAtMs: Math.max(nowMs, blockedUntilMs) + ttlMs,
					});
					return ["reserved", String(eligibleAtMs), hash, String(nowMs)];
				}

				if (!current || current.hash !== hash) {
					return ["stale"];
				}

				if (operation === "confirm") {
					const eligibleAtMs = Math.max(value, current.blockedUntilMs, current.nextAdmissionMs);
					store(key, {
						...current,
						expiresAtMs: Math.max(nowMs, current.blockedUntilMs) + ttlMs,
						nextAdmissionMs: eligibleAtMs > nowMs ? current.nextAdmissionMs : nowMs + spacingMs,
						nextEligibleMs:
							eligibleAtMs > nowMs
								? current.nextEligibleMs
								: Math.max(current.nextEligibleMs, nowMs + spacingMs),
					});
					return eligibleAtMs > nowMs
						? ["later", String(eligibleAtMs), String(nowMs)]
						: ["admitted"];
				}

				if (operation === "block") {
					const blockedUntilMs = Math.max(current.blockedUntilMs, value);
					store(key, {
						...current,
						blockedUntilMs,
						expiresAtMs: Math.max(nowMs, blockedUntilMs) + ttlMs,
					});
					return ["blocked", String(blockedUntilMs), String(nowMs)];
				}

				return ["corrupt"];
			};

			const client = Object.assign(Object.create(null), {
				eval: (
					_script: string,
					_numKeys: number,
					key: string,
					operation: string,
					hash: string,
					valueText: string,
					ttlText: string,
					spacingText: string,
				) => {
					const canned = MutableRef.get(response.ref);
					return canned === undefined
						? Promise.resolve(
								simulate(
									key,
									operation,
									hash,
									Number(valueText),
									Number(ttlText),
									Number(spacingText),
								),
							)
						: canned();
				},
			}) satisfies RedisClient;

			return Layer.merge(
				ProviderHttpAdmissionService.layer,
				Layer.succeed(FakeAdmissionRedis, {
					calls: Ref.get(calls),
					states: Ref.get(states),
					setNow: (nowMs) => Ref.set(now, nowMs),
					respondWith: (next) => Ref.set(response, next),
				}),
			).pipe(Layer.provideMerge(Layer.succeed(RedisService, makeRedisService({ client }))));
		}),
	);

describe("ProviderHttpAdmissionService", () => {
	layer(fakeAdmissionRedisLayer())((test) => {
		test.effect(
			"constructs a safe centralized key, rounds spacing up, and applies the minimum TTL",
			() =>
				Effect.gen(function* () {
					const service = yield* ProviderHttpAdmissionService;
					const tokens = yield* Effect.all([
						service.reserve(declaration),
						service.reserve(declaration),
						service.reserve(declaration),
					]);

					expect(tokens).toEqual([
						{ eligibleAtMs: 1_000, observedAtMs: 1_000, declarationHash: declaration.hash },
						{ eligibleAtMs: 1_334, observedAtMs: 1_000, declarationHash: declaration.hash },
						{ eligibleAtMs: 1_668, observedAtMs: 1_000, declarationHash: declaration.hash },
					]);
					expect(yield* (yield* FakeAdmissionRedis).calls).toEqual([
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
				}),
		);
	});

	layer(fakeAdmissionRedisLayer())((test) => {
		test.effect(
			"shares unique slots across service instances and never reclaims abandoned reservations",
			() =>
				Effect.gen(function* () {
					const reserveFour = Effect.gen(function* () {
						const service = yield* ProviderHttpAdmissionService.make;
						return yield* Effect.all(Array.from({ length: 4 }, () => service.reserve(declaration)));
					});

					const tokens = (yield* Effect.all([reserveFour, reserveFour], {
						concurrency: "unbounded",
					})).flat();

					expect(tokens.map((token) => token.eligibleAtMs).sort((a, b) => a - b)).toEqual([
						1_000, 1_334, 1_668, 2_002, 2_336, 2_670, 3_004, 3_338,
					]);
					expect(new Set(tokens.map((token) => token.eligibleAtMs))).toHaveLength(8);
					expect(tokens.every((token) => token.observedAtMs === 1_000)).toBe(true);
				}),
		);
	});

	layer(fakeAdmissionRedisLayer())((test) => {
		test.effect(
			"confirms against the latest block and advances admission spacing and blocks monotonically",
			() =>
				Effect.gen(function* () {
					const redis = yield* FakeAdmissionRedis;
					const service = yield* ProviderHttpAdmissionService;
					const key = redisKeys.providerHttpAdmission(declaration.key);
					const token = yield* service.reserve(declaration);
					const nextEligibleMs = (yield* redis.states).get(key)?.nextEligibleMs;
					const firstBlock = yield* service.block(declaration, 5_000);
					const lowerBlock = yield* service.block(declaration, 4_000);
					const delayed = yield* service.confirm(declaration, token);

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
					expect(delayed).toEqual({ status: "later", eligibleAtMs: 5_000, observedAtMs: 1_000 });
					expect((yield* redis.states).get(key)?.nextEligibleMs).toBe(nextEligibleMs);
					expect((yield* redis.states).get(key)?.expiresAtMs).toBe(65_000);

					yield* redis.setNow(5_000);
					expect(yield* service.confirm(declaration, token)).toEqual({ status: "admitted" });
					expect((yield* redis.states).get(key)?.nextEligibleMs).toBe(5_334);
				}),
		);
	});

	layer(fakeAdmissionRedisLayer())((test) => {
		test.effect("resets spacing on a hash change while preserving a live block", () =>
			Effect.gen(function* () {
				const service = yield* ProviderHttpAdmissionService;
				const oldToken = yield* service.reserve(declaration);
				yield* service.block(declaration, 8_000);
				const changed = { ...declaration, hash: "declaration-v2" };
				const newToken = yield* service.reserve(changed);
				const oldConfirmation = yield* service.confirm(changed, oldToken);
				const oldBlock = yield* service.block(declaration, 9_000);

				expect(newToken).toEqual({
					eligibleAtMs: 8_000,
					observedAtMs: 1_000,
					declarationHash: "declaration-v2",
				});
				expect(oldConfirmation).toEqual({ status: "stale" });
				expect(oldBlock).toEqual({ status: "stale" });
				const states = yield* (yield* FakeAdmissionRedis).states;
				expect(states.get(redisKeys.providerHttpAdmission(declaration.key))).toMatchObject({
					expiresAtMs: 68_000,
					blockedUntilMs: 8_000,
					nextEligibleMs: 8_334,
					hash: "declaration-v2",
				});
			}),
		);
	});

	layer(fakeAdmissionRedisLayer())((test) => {
		test.effect("uses ten intervals when that exceeds the minimum TTL", () =>
			Effect.gen(function* () {
				const service = yield* ProviderHttpAdmissionService;
				yield* service.reserve({ ...declaration, intervalMs: 10_000 });
				const calls = yield* (yield* FakeAdmissionRedis).calls;
				expect(calls[0]?.ttlMs).toBe(100_000);
			}),
		);
	});

	layer(fakeAdmissionRedisLayer(() => Promise.reject(new Error("connection lost"))))((test) => {
		test.effect("returns a typed unavailable failure for operational Redis errors", () =>
			Effect.gen(function* () {
				const service = yield* ProviderHttpAdmissionService;
				const exit = yield* Effect.exit(service.reserve(declaration));
				assertExitFails(
					exit,
					new ProviderHttpAdmissionUnavailable({
						message: "Redis admission command failed: connection lost",
					}),
				);
			}),
		);
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

	layer(fakeAdmissionRedisLayer())((test) => {
		test.effect("strictly validates Lua responses", () =>
			Effect.gen(function* () {
				const redis = yield* FakeAdmissionRedis;
				const service = yield* ProviderHttpAdmissionService;
				for (const { message, response } of invalidResponses) {
					yield* redis.respondWith(() => Promise.resolve(response));
					const exit = yield* Effect.exit(service.reserve(declaration));
					assertExitFails(exit, new ProviderHttpAdmissionCorruptState({ message }));
				}
			}),
		);
	});
});
