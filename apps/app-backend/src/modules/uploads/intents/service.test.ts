import { expect, it } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { badRequest } from "@ryot/contract/errors";
import { UserId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import Redis from "ioredis";

import { LocalStorageService } from "#lib/infrastructure/local-storage";
import { RedisService, redisKeys } from "#lib/infrastructure/redis";
import { S3Service } from "#lib/infrastructure/s3";
import { makeRedisService } from "#lib/test-utils/effect";

import { ManagedAssetsService } from "../managed-assets/service";
import { ObjectStorageService } from "../object-storage/service";
import { UploadIntentsService } from "./service";

const mockLocalStorage = Layer.mock(LocalStorageService);
const mockManagedAssets = Layer.mock(ManagedAssetsService);
const mockObjectStorage = Layer.mock(ObjectStorageService);
const mockS3 = Layer.mock(S3Service);

const user: CurrentUserValue = {
	image: null,
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-id"),
	preferences: { allowNsfw: false, language: null, disableIntegrations: false },
};

const makeRedisClient = (): RedisService["Service"]["client"] =>
	Object.assign(Object.create(Redis.prototype), { duplicate: makeRedisClient });

const cleanupIntentId = "intent-id";
const intentLock = redisKeys.uploadIntentLock(cleanupIntentId);
const leaseOwner = "00000000-0000-0000-0000-000000000000" as const;

const makeIntentRecord = (overrides: Record<string, unknown> = {}) =>
	JSON.stringify({
		userId: user.id,
		kind: "temporary",
		provider: "local",
		state: "completed",
		fileName: "photo.png",
		intentId: cleanupIntentId,
		createdAt: 0,
		expiresAt: 900,
		contentType: "image/png",
		objectKey: "temporary/object.png",
		...overrides,
	});

it.effect(
	"selects, creates, and indexes a permanent upload intent without client provider input",
	() => {
		const stored = new Map<string, string>();
		const indexed: Array<{ key: string; score: number; member: string }> = [];
		const selectedKinds: string[] = [];
		const redis = Layer.succeed(
			RedisService,
			makeRedisService({
				client: makeRedisClient(),
				setAndIndex: (key, value, indexKey, score, member) => {
					stored.set(key, value);
					indexed.push({ key: indexKey, score, member });
					return Effect.void;
				},
			}),
		);
		const layer = UploadIntentsService.layer.pipe(
			Layer.provide(
				Layer.mergeAll(
					redis,
					mockManagedAssets({}),
					mockObjectStorage({
						selectStorageProvider: (kind) => {
							selectedKinds.push(kind);
							return Effect.succeed("local" as const);
						},
					}),
					mockS3({ isConfigured: true }),
					mockLocalStorage({
						isConfiguredForKind: () => true,
						createUploadTarget: (intentId) =>
							Effect.succeed({
								method: "PUT" as const,
								expiresAt: 1_700_000_900,
								uploadUrl: `/uploads/local/${intentId}?expires=1700000900&signature=signature`,
							}),
					}),
				),
			),
		);

		return Effect.gen(function* () {
			const service = yield* UploadIntentsService;
			const result = yield* service.createUploadIntent(user, {
				kind: "permanent",
				fileName: "photo.png",
				contentType: "image/png",
			});
			expect(result.uploadUrl).toMatch(new RegExp(`^/uploads/local/${result.intentId}`));
			expect(selectedKinds).toEqual(["permanent"]);
			expect(indexed).toHaveLength(1);
			expect(stored.get(redisKeys.uploadIntent(result.intentId))).toContain('"provider":"local"');
			expect(stored.get(redisKeys.uploadIntent(result.intentId))).toContain(
				'"fileName":"photo.png"',
			);
		}).pipe(Effect.provide(layer));
	},
);

const makeCleanupLayer = (
	redisOverrides: Parameters<typeof makeRedisService>[0],
	objectStorageOverrides: Parameters<typeof mockObjectStorage>[0],
) =>
	UploadIntentsService.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				Layer.succeed(
					RedisService,
					makeRedisService({ client: makeRedisClient(), ...redisOverrides }),
				),
				mockS3({ isConfigured: true }),
				mockLocalStorage({ isConfiguredForKind: () => true }),
				mockManagedAssets({}),
				mockObjectStorage(objectStorageOverrides),
			),
		),
	);

it.effect("cleans up an expired upload intent holding only the intent lock", () => {
	const leased: string[] = [];
	const released: string[] = [];
	const deletedKeys: string[] = [];
	const removedMembers: string[] = [];
	const deletedObjects: Array<{ key: string; type: string }> = [];
	const record = makeIntentRecord({
		completion: { token: "upload-token", expiresAt: 900 },
	});
	const layer = makeCleanupLayer(
		{
			get: () => Effect.succeed(record),
			zrangeByScore: () => Effect.succeed([cleanupIntentId]),
			releaseLease: (key) => {
				released.push(key);
				return Effect.void;
			},
			acquireLease: (key) => {
				leased.push(key);
				return Effect.succeed(leaseOwner);
			},
			del: (...keys) => {
				deletedKeys.push(...keys);
				return Effect.succeed(keys.length);
			},
			zrem: (_key, ...members) => {
				removedMembers.push(...members);
				return Effect.void;
			},
		},
		{
			deleteObject: (locator) => {
				deletedObjects.push(locator);
				return Effect.void;
			},
		},
	);

	return Effect.gen(function* () {
		const service = yield* UploadIntentsService;
		yield* TestClock.adjust("1000 seconds");
		yield* service.cleanupPendingIntents(100);
		expect(leased).toEqual([intentLock]);
		expect(released).toEqual([intentLock]);
		expect(removedMembers).toEqual([cleanupIntentId]);
		expect(deletedObjects).toEqual([{ type: "local", key: "temporary/object.png" }]);
		expect(deletedKeys).toEqual([
			redisKeys.uploadToken("upload-token"),
			redisKeys.uploadIntent(cleanupIntentId),
		]);
	}).pipe(Effect.provide(layer));
});

it.effect("reindexes an intent whose expiry was renewed after selection", () => {
	const removedMembers: string[] = [];
	const deletedObjects: Array<{ key: string; type: string }> = [];
	const indexed: Array<{ score: number; member: string }> = [];
	const record = makeIntentRecord({
		claimedAt: 1_000,
		state: "claimed",
		expiresAt: 87_300,
		claimId: "claim-id",
		completion: { token: "upload-token", expiresAt: 900 },
	});
	const layer = makeCleanupLayer(
		{
			releaseLease: () => Effect.void,
			get: () => Effect.succeed(record),
			acquireLease: () => Effect.succeed(leaseOwner),
			zrangeByScore: () => Effect.succeed([cleanupIntentId]),
			zadd: (_key, score, member) => {
				indexed.push({ score, member });
				return Effect.void;
			},
			zrem: (_key, ...members) => {
				removedMembers.push(...members);
				return Effect.void;
			},
		},
		{
			deleteObject: (locator) => {
				deletedObjects.push(locator);
				return Effect.void;
			},
		},
	);

	return Effect.gen(function* () {
		const service = yield* UploadIntentsService;
		yield* TestClock.adjust("1000 seconds");
		yield* service.cleanupPendingIntents(100);
		expect(removedMembers).toEqual([]);
		expect(deletedObjects).toEqual([]);
		expect(indexed).toEqual([{ score: 87_300, member: cleanupIntentId }]);
	}).pipe(Effect.provide(layer));
});

it.effect("leaves a failed deletion indexed for the next cleanup run", () => {
	const released: string[] = [];
	const removedMembers: string[] = [];
	const attemptedKeys: string[] = [];
	const layer = makeCleanupLayer(
		{
			del: () => Effect.die("unexpected delete"),
			get: () => Effect.succeed(makeIntentRecord()),
			acquireLease: () => Effect.succeed(leaseOwner),
			zrangeByScore: () => Effect.succeed([cleanupIntentId]),
			releaseLease: (key) => {
				released.push(key);
				return Effect.void;
			},
			zrem: (_key, ...members) => {
				removedMembers.push(...members);
				return Effect.void;
			},
		},
		{
			deleteObject: (locator) => {
				attemptedKeys.push(locator.key);
				return Effect.fail(badRequest("object deletion failed"));
			},
		},
	);

	return Effect.gen(function* () {
		const service = yield* UploadIntentsService;
		yield* TestClock.adjust("1000 seconds");
		yield* service.cleanupPendingIntents(100);
		expect(released).toEqual([intentLock]);
		expect(removedMembers).toEqual([]);
		expect(attemptedKeys).toEqual(["temporary/object.png"]);
	}).pipe(Effect.provide(layer));
});
