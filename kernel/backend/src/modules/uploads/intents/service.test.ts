import { expect, layer } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import { badRequest } from "@ryot-app/contract/errors";
import type { ManagedAssetLocator } from "@ryot-app/contract/modules/uploads/schemas";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref } from "effect";
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
	preferences: { language: null, disableIntegrations: false },
	accountGeneration: { userId: UserId.make("user-id"), token: "test-account-generation" },
};

const makeRedisClient = (): RedisService["Service"]["client"] =>
	Object.assign(Object.create(Redis.prototype), { duplicate: makeRedisClient });

const cleanupIntentId = "intent-id";
const intentLock = redisKeys.uploadIntentLock(cleanupIntentId);
const leaseOwner = "00000000-0000-0000-0000-000000000000" as const;

const makeIntentRecord = (overrides: Record<string, unknown> = {}) =>
	JSON.stringify({
		createdAt: 0,
		expiresAt: 900,
		userId: user.id,
		kind: "temporary",
		provider: "local",
		state: "completed",
		fileName: "photo.png",
		contentType: "image/png",
		intentId: cleanupIntentId,
		objectKey: "temporary/object.png",
		...overrides,
	});

class FakeUploadStore extends Context.Service<
	FakeUploadStore,
	{
		readonly leased: Effect.Effect<ReadonlyArray<string>>;
		readonly released: Effect.Effect<ReadonlyArray<string>>;
		readonly deletedKeys: Effect.Effect<ReadonlyArray<string>>;
		readonly selectedKinds: Effect.Effect<ReadonlyArray<string>>;
		readonly removedMembers: Effect.Effect<ReadonlyArray<string>>;
		readonly storedValues: Effect.Effect<ReadonlyMap<string, string>>;
		readonly deletedObjects: Effect.Effect<ReadonlyArray<ManagedAssetLocator>>;
		readonly reindexed: Effect.Effect<ReadonlyArray<{ score: number; member: string }>>;
		readonly indexed: Effect.Effect<ReadonlyArray<{ key: string; score: number; member: string }>>;
	}
>()("test/FakeUploadStore") {}

const append = <A>(ref: Ref.Ref<ReadonlyArray<A>>, ...values: ReadonlyArray<A>) =>
	Ref.update(ref, (all) => [...all, ...values]);

const makeUploadIntentsLayer = (options: {
	readonly intentRecord?: string;
	readonly deletesKeys?: boolean;
	readonly objectDeletionFails?: boolean;
}) =>
	UploadIntentsService.layer.pipe(
		Layer.provideMerge(
			Layer.unwrap(
				Effect.gen(function* () {
					const leased = yield* Ref.make<ReadonlyArray<string>>([]);
					const released = yield* Ref.make<ReadonlyArray<string>>([]);
					const deletedKeys = yield* Ref.make<ReadonlyArray<string>>([]);
					const selectedKinds = yield* Ref.make<ReadonlyArray<string>>([]);
					const removedMembers = yield* Ref.make<ReadonlyArray<string>>([]);
					const stored = yield* Ref.make<ReadonlyMap<string, string>>(new Map());
					const deletedObjects = yield* Ref.make<ReadonlyArray<ManagedAssetLocator>>([]);
					const reindexed = yield* Ref.make<ReadonlyArray<{ score: number; member: string }>>([]);
					const indexed = yield* Ref.make<
						ReadonlyArray<{ key: string; score: number; member: string }>
					>([]);
					const { intentRecord } = options;
					return Layer.mergeAll(
						Layer.succeed(FakeUploadStore, {
							leased: Ref.get(leased),
							indexed: Ref.get(indexed),
							released: Ref.get(released),
							reindexed: Ref.get(reindexed),
							storedValues: Ref.get(stored),
							deletedKeys: Ref.get(deletedKeys),
							selectedKinds: Ref.get(selectedKinds),
							removedMembers: Ref.get(removedMembers),
							deletedObjects: Ref.get(deletedObjects),
						}),
						Layer.succeed(
							RedisService,
							makeRedisService({
								client: makeRedisClient(),
								releaseLease: (key) => append(released, key),
								zrem: (_key, ...members) => append(removedMembers, ...members),
								zadd: (_key, score, member) => append(reindexed, { score, member }),
								acquireLease: (key) => append(leased, key).pipe(Effect.as(leaseOwner)),
								del: (...keys) =>
									options.deletesKeys
										? append(deletedKeys, ...keys).pipe(Effect.as(keys.length))
										: Effect.die("unexpected delete"),
								setAndIndex: (key, value, indexKey, score, member) =>
									Ref.update(stored, (all) => new Map(all).set(key, value)).pipe(
										Effect.andThen(append(indexed, { score, member, key: indexKey })),
									),
								...(intentRecord === undefined
									? {}
									: {
											get: () => Effect.succeed(intentRecord),
											zrangeByScore: () => Effect.succeed([cleanupIntentId]),
										}),
							}),
						),
						mockManagedAssets({}),
						mockObjectStorage({
							selectStorageProvider: (kind) =>
								append(selectedKinds, kind).pipe(Effect.as("local" as const)),
							deleteObject: (locator) =>
								append(deletedObjects, locator).pipe(
									Effect.andThen(
										options.objectDeletionFails
											? Effect.fail(badRequest("object deletion failed"))
											: Effect.void,
									),
								),
						}),
						mockS3({ isConfigured: true }),
						mockLocalStorage({
							createUploadTarget: (intentId) =>
								Effect.succeed({
									method: "PUT" as const,
									expiresAt: 1_700_000_900,
									uploadUrl: `/uploads/local/${intentId}?expires=1700000900&signature=signature`,
								}),
						}),
					);
				}),
			),
		),
	);

layer(makeUploadIntentsLayer({}))((test) => {
	test.effect(
		"selects, creates, and indexes a permanent upload intent without client provider input",
		() =>
			Effect.gen(function* () {
				const service = yield* UploadIntentsService;
				const fake = yield* FakeUploadStore;
				const result = yield* service.createUploadIntent(user, {
					kind: "permanent",
					fileName: "photo.png",
					contentType: "image/png",
				});
				const stored = yield* fake.storedValues;
				expect(result.uploadUrl).toMatch(new RegExp(`^/uploads/local/${result.intentId}`));
				expect(yield* fake.selectedKinds).toEqual(["permanent"]);
				expect(yield* fake.indexed).toHaveLength(1);
				expect(stored.get(redisKeys.uploadIntent(result.intentId))).toContain('"provider":"local"');
				expect(stored.get(redisKeys.uploadIntent(result.intentId))).toContain(
					'"fileName":"photo.png"',
				);
			}),
	);
});

layer(
	makeUploadIntentsLayer({
		deletesKeys: true,
		intentRecord: makeIntentRecord({ completion: { expiresAt: 900, token: "upload-token" } }),
	}),
)((test) => {
	test.effect("cleans up an expired upload intent holding only the intent lock", () =>
		Effect.gen(function* () {
			const service = yield* UploadIntentsService;
			const fake = yield* FakeUploadStore;
			yield* TestClock.adjust("1000 seconds");
			yield* service.cleanupPendingIntents(100);
			expect(yield* fake.leased).toEqual([intentLock]);
			expect(yield* fake.released).toEqual([intentLock]);
			expect(yield* fake.removedMembers).toEqual([cleanupIntentId]);
			expect(yield* fake.deletedObjects).toEqual([{ type: "local", key: "temporary/object.png" }]);
			expect(yield* fake.deletedKeys).toEqual([
				redisKeys.uploadToken("upload-token"),
				redisKeys.uploadIntent(cleanupIntentId),
			]);
		}),
	);
});

layer(
	makeUploadIntentsLayer({
		intentRecord: makeIntentRecord({
			claimedAt: 1_000,
			state: "claimed",
			expiresAt: 87_300,
			claimId: "claim-id",
			completion: { expiresAt: 900, token: "upload-token" },
		}),
	}),
)((test) => {
	test.effect("reindexes an intent whose expiry was renewed after selection", () =>
		Effect.gen(function* () {
			const service = yield* UploadIntentsService;
			const fake = yield* FakeUploadStore;
			yield* TestClock.adjust("1000 seconds");
			yield* service.cleanupPendingIntents(100);
			expect(yield* fake.removedMembers).toEqual([]);
			expect(yield* fake.deletedObjects).toEqual([]);
			expect(yield* fake.reindexed).toEqual([{ score: 87_300, member: cleanupIntentId }]);
		}),
	);
});

layer(makeUploadIntentsLayer({ objectDeletionFails: true, intentRecord: makeIntentRecord() }))(
	(test) => {
		test.effect("leaves a failed deletion indexed for the next cleanup run", () =>
			Effect.gen(function* () {
				const service = yield* UploadIntentsService;
				const fake = yield* FakeUploadStore;
				yield* TestClock.adjust("1000 seconds");
				yield* service.cleanupPendingIntents(100);
				expect(yield* fake.released).toEqual([intentLock]);
				expect(yield* fake.removedMembers).toEqual([]);
				expect((yield* fake.deletedObjects).map(({ key }) => key)).toEqual([
					"temporary/object.png",
				]);
			}),
		);
	},
);
