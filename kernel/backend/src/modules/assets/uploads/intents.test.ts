import { expect, layer } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import { badRequest } from "@ryot-app/contract/errors";
import {
	type ManagedAssetLocator,
	UploadBadRequest,
} from "@ryot-app/contract/modules/assets/schemas";
import { UserId } from "@ryot-app/contract/schema/brands";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import {
	ByteSize,
	Clock,
	Context,
	Deferred,
	Effect,
	Fiber,
	Layer,
	Option,
	Ref,
	Schema,
	Stream,
} from "effect";
import { TestClock } from "effect/testing";
import Redis from "ioredis";
import { assert } from "vitest";

import { redisKeys, RedisService } from "#platform/redis";
import { LocalStorageService } from "#platform/storage/local-storage";
import { S3Service } from "#platform/storage/s3";
import { makeRedisService } from "#testing/effect";

import { ManagedAssetsService } from "../storage/managed-assets";
import { ObjectStorageService } from "../storage/object-storage";
import { UploadIntentsService } from "./intents";

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
const epoch = new Date(0);
const tokenRecord = JSON.stringify({ userId: user.id, intentId: cleanupIntentId });

const makeIntentRecord = (overrides: Record<string, unknown> = {}) =>
	JSON.stringify({
		createdAt: 0,
		userId: user.id,
		kind: "temporary",
		provider: "local",
		state: "completed",
		fileName: "photo.png",
		contentType: "image/png",
		intentId: cleanupIntentId,
		objectKey: "temporary/object.png",
		completion: { expiresAt: 900, token: "upload-token" },
		...overrides,
	});

class FakeUploadStore extends Context.Service<
	FakeUploadStore,
	{
		readonly leased: Effect.Effect<ReadonlyArray<string>>;
		readonly released: Effect.Effect<ReadonlyArray<string>>;
		readonly deletedKeys: Effect.Effect<ReadonlyArray<string>>;
		readonly removedMembers: Effect.Effect<ReadonlyArray<string>>;
		readonly storedValues: Effect.Effect<ReadonlyMap<string, string>>;
		readonly deletedObjects: Effect.Effect<ReadonlyArray<ManagedAssetLocator>>;
		readonly reindexed: Effect.Effect<ReadonlyArray<{ score: number; member: string }>>;
		readonly indexed: Effect.Effect<ReadonlyArray<{ key: string; score: number; member: string }>>;
		readonly tokenWrites: Effect.Effect<ReadonlyArray<{ key: string; ttl: number }>>;
		readonly writes: Effect.Effect<ReadonlyArray<string>>;
		readonly registrations: Effect.Effect<ReadonlyArray<string>>;
		readonly awaitStat: Effect.Effect<void>;
		readonly releaseStat: Effect.Effect<boolean>;
	}
>()("test/FakeUploadStore") {}

const append = <A>(ref: Ref.Ref<ReadonlyArray<A>>, ...values: ReadonlyArray<A>) =>
	Ref.update(ref, (all) => [...all, ...values]);

const makeUploadIntentsLayer = (options: {
	readonly intentRecord?: string;
	readonly objectDeletionFails?: boolean;
	readonly provider?: "local" | "s3";
	readonly blockStat?: boolean;
	readonly missingObject?: boolean;
}) =>
	UploadIntentsService.layer.pipe(
		Layer.provideMerge(
			Layer.unwrap(
				Effect.gen(function* () {
					const leased = yield* Ref.make<ReadonlyArray<string>>([]);
					const released = yield* Ref.make<ReadonlyArray<string>>([]);
					const deletedKeys = yield* Ref.make<ReadonlyArray<string>>([]);
					const removedMembers = yield* Ref.make<ReadonlyArray<string>>([]);
					const stored = yield* Ref.make<ReadonlyMap<string, string>>(
						new Map(
							options.intentRecord === undefined
								? []
								: [
										[redisKeys.uploadIntent(cleanupIntentId), options.intentRecord],
										[redisKeys.uploadToken("upload-token"), tokenRecord],
									],
						),
					);
					const locks = yield* Ref.make<ReadonlySet<string>>(new Set());
					const tokenWrites = yield* Ref.make<ReadonlyArray<{ key: string; ttl: number }>>([]);
					const writes = yield* Ref.make<ReadonlyArray<string>>([]);
					const registrations = yield* Ref.make<ReadonlyArray<string>>([]);
					const statEntered = yield* Deferred.make<void>();
					const statReleased = yield* Deferred.make<void>();
					const deletedObjects = yield* Ref.make<ReadonlyArray<ManagedAssetLocator>>([]);
					const reindexed = yield* Ref.make<ReadonlyArray<{ score: number; member: string }>>([]);
					const indexed = yield* Ref.make<
						ReadonlyArray<{ key: string; score: number; member: string }>
					>([]);
					const expiries = yield* Ref.make<ReadonlyMap<string, number>>(new Map());
					const store = (key: string, value: string) =>
						Ref.update(stored, (all) => new Map(all).set(key, value));
					const stat = Effect.gen(function* () {
						if (options.blockStat) {
							yield* Deferred.succeed(statEntered, undefined);
							yield* Deferred.await(statReleased);
						}
						if (options.missingObject) {
							return yield* badRequest("object missing");
						}
						return { size: 3, etag: "etag", type: "image/png", lastModified: epoch };
					});
					return Layer.mergeAll(
						Layer.succeed(FakeUploadStore, {
							leased: Ref.get(leased),
							writes: Ref.get(writes),
							indexed: Ref.get(indexed),
							released: Ref.get(released),
							reindexed: Ref.get(reindexed),
							storedValues: Ref.get(stored),
							deletedKeys: Ref.get(deletedKeys),
							tokenWrites: Ref.get(tokenWrites),
							registrations: Ref.get(registrations),
							awaitStat: Deferred.await(statEntered),
							removedMembers: Ref.get(removedMembers),
							deletedObjects: Ref.get(deletedObjects),
							releaseStat: Deferred.succeed(statReleased, undefined),
						}),
						Layer.succeed(
							RedisService,
							makeRedisService({
								client: makeRedisClient(),
								renewLease: () => Effect.succeed(true),
								zrem: (_key, ...members) => append(removedMembers, ...members),
								zadd: (_key, score, member) => append(reindexed, { score, member }),
								setAndIndex: (key, value, indexKey, score, member) =>
									Ref.update(stored, (all) => new Map(all).set(key, value)).pipe(
										Effect.andThen(append(indexed, { score, member, key: indexKey })),
									),
								acquireLease: (key) =>
									append(leased, key).pipe(
										Effect.andThen(
											Ref.modify(locks, (all) =>
												all.has(key) ? [null, all] : [leaseOwner, new Set(all).add(key)],
											),
										),
									),
								releaseLease: (key) =>
									append(released, key).pipe(
										Effect.andThen(
											Ref.update(locks, (all) => {
												const next = new Set(all);
												next.delete(key);
												return next;
											}),
										),
									),
								zrangeByScore: () =>
									Ref.get(stored).pipe(
										Effect.map((all) =>
											[...all.keys()]
												.filter((key) => key.startsWith("ryot:upload:intent:"))
												.map((key) => key.slice("ryot:upload:intent:".length)),
										),
									),
								get: (key) =>
									Effect.gen(function* () {
										const expiry = (yield* Ref.get(expiries)).get(key);
										if (expiry !== undefined && expiry <= (yield* Clock.currentTimeMillis)) {
											return null;
										}
										return (yield* Ref.get(stored)).get(key) ?? null;
									}),
								del: (...keys) =>
									append(deletedKeys, ...keys).pipe(
										Effect.andThen(
											Ref.update(stored, (all) => {
												const next = new Map(all);
												for (const key of keys) {
													next.delete(key);
												}
												return next;
											}),
										),
										Effect.as(keys.length),
									),
								setAndIndexAndSet: (
									key,
									value,
									indexKey,
									score,
									member,
									tokenKey,
									tokenValue,
									ttl,
								) =>
									store(key, value).pipe(
										Effect.andThen(store(tokenKey, tokenValue)),
										Effect.andThen(append(indexed, { score, member, key: indexKey })),
										Effect.andThen(append(tokenWrites, { ttl, key: tokenKey })),
									),
								setAndRemoveFromIndex: (key, value, _indexKey, member, ttlSeconds) =>
									store(key, value).pipe(
										Effect.andThen(
											Effect.gen(function* () {
												const now = yield* Clock.currentTimeMillis;
												yield* Ref.update(expiries, (all) =>
													new Map(all).set(key, now + ttlSeconds * 1000),
												);
											}),
										),
										Effect.andThen(append(removedMembers, member)),
									),
							}),
						),
						mockManagedAssets({
							registerManagedAsset: (input) =>
								append(registrations, input.key).pipe(
									Effect.as({ ...input, retiredAt: null, createdAt: epoch }),
								),
						}),
						mockObjectStorage({
							permanentStorageProvider: Effect.succeed(options.provider ?? "local"),
							openObject: () => Effect.succeed(Stream.make(new Uint8Array([1, 2, 3]))),
							deleteObject: (locator) =>
								append(deletedObjects, locator).pipe(
									Effect.andThen(
										options.objectDeletionFails
											? Effect.fail(badRequest("object deletion failed"))
											: Effect.void,
									),
								),
						}),
						mockS3({
							isConfigured: true,
							statObject: () => stat,
							presignUpload: () => Effect.succeed("https://storage.invalid/upload"),
						}),
						mockLocalStorage({
							verifyUploadTarget: () => Effect.void.pipe(Effect.as(undefined)),
							resolveObjectPath: (key) => Effect.succeed(`/isolated-test/${key}`),
							writeObject: (key, stream) =>
								Stream.runDrain(stream).pipe(
									Effect.orDie,
									Effect.andThen(append(writes, key)),
									Effect.as(undefined),
								),
							createUploadTarget: (intentId) =>
								Effect.succeed({
									method: "PUT" as const,
									expiresAt: 1_700_000_900,
									uploadUrl: `/uploads/local/${intentId}?expires=1700000900&signature=signature`,
								}),
							statObject: () =>
								stat.pipe(
									Effect.map(() => ({
										dev: 1n,
										mode: 0o644,
										ino: Option.none(),
										uid: Option.none(),
										gid: Option.none(),
										rdev: Option.none(),
										mtime: Option.none(),
										atime: Option.none(),
										nlink: Option.none(),
										type: "File" as const,
										blocks: Option.none(),
										blksize: Option.none(),
										size: ByteSize.bytes(3),
										birthtime: Option.none(),
									})),
								),
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
			claimedAt: 100,
			state: "claimed",
			claimId: "claim-id",
			leaseExpiresAt: 86_500,
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
			expect(yield* fake.reindexed).toEqual([{ score: 86_500, member: cleanupIntentId }]);
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

for (const provider of ["local", "s3"] as const) {
	layer(makeUploadIntentsLayer({ provider }))((test) => {
		test.effect(
			`completes and replays a permanent ${provider} upload without leaving cleanup authority`,
			() =>
				Effect.gen(function* () {
					const service = yield* UploadIntentsService;
					const fake = yield* FakeUploadStore;
					const intent = yield* service.createUploadIntent(user, {
						kind: "permanent",
						fileName: "photo.png",
						contentType: "image/png",
					});
					const completion = yield* service.completeUploadIntent(user, intent.intentId);
					expect(completion).toMatchObject({ type: provider });
					expect(yield* service.completeUploadIntent(user, intent.intentId)).toEqual(completion);
					expect(yield* fake.registrations).toHaveLength(1);
					expect(yield* fake.tokenWrites).toEqual([]);
					const record = (yield* fake.storedValues).get(redisKeys.uploadIntent(intent.intentId));
					assert(record);
					expect(yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(record)).toEqual(
						{
							completion,
							createdAt: 0,
							userId: user.id,
							kind: "permanent",
							state: "completed",
							fileName: "photo.png",
							contentType: "image/png",
							intentId: intent.intentId,
						},
					);
					yield* TestClock.adjust("1000 seconds");
					yield* service.cleanupPendingIntents(100);
					expect(yield* fake.deletedObjects).toEqual([]);
					assertExitFails(
						yield* Effect.exit(service.completeUploadIntent(user, intent.intentId)),
						new UploadBadRequest({ reason: { code: "intent-expired", intentId: intent.intentId } }),
					);
					assertExitFails(
						yield* Effect.exit(
							service.putLocalIntent(
								intent.intentId,
								"PUT",
								intent.uploadUrl,
								"image/png",
								"3",
								Stream.make(new Uint8Array([1, 2, 3])),
							),
						),
						new UploadBadRequest({ reason: { code: "intent-expired", intentId: intent.intentId } }),
					);
				}),
		);
	});
}

layer(makeUploadIntentsLayer({ provider: "s3" }))((test) => {
	test.effect(
		"temporary uploads stay local, preserve completion expiry across claim replay, and expire by the processing lease",
		() =>
			Effect.gen(function* () {
				const service = yield* UploadIntentsService;
				const fake = yield* FakeUploadStore;
				const intent = yield* service.createUploadIntent(user, {
					kind: "temporary",
					fileName: "photo.png",
					contentType: "image/png",
				});
				expect(intent.uploadUrl).toMatch(/^\/uploads\/local\//);
				yield* service.putLocalIntent(
					intent.intentId,
					"PUT",
					intent.uploadUrl,
					"image/png",
					"3",
					Stream.make(new Uint8Array([1, 2, 3])),
				);
				expect(yield* fake.writes).toHaveLength(1);
				const completion = yield* service.completeUploadIntent(user, intent.intentId);
				assert("token" in completion);
				expect(completion.expiresAt).toBe("1970-01-01T00:15:00.000Z");
				expect(yield* service.completeUploadIntent(user, intent.intentId)).toEqual(completion);
				assertExitFails(
					yield* Effect.exit(
						service.putLocalIntent(
							intent.intentId,
							"PUT",
							intent.uploadUrl,
							"image/png",
							"3",
							Stream.empty,
						),
					),
					new UploadBadRequest({ reason: { code: "intent-expired", intentId: intent.intentId } }),
				);
				yield* TestClock.adjust("100 seconds");
				const claimed = yield* service.claimTemporaryUpload(
					completion.token,
					user.id,
					"first-claim",
				);
				expect(claimed).toEqual({
					fileName: "photo.png",
					intentId: intent.intentId,
					leaseExpiresAt: "1970-01-02T00:01:40.000Z",
					locator: { type: "local", key: (yield* fake.writes)[0] },
					resolvedPath: `/isolated-test/${(yield* fake.writes)[0]}`,
				});
				const claimedRecord = (yield* fake.storedValues).get(
					redisKeys.uploadIntent(intent.intentId),
				);
				assert(claimedRecord);
				const storedClaim = yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(
					claimedRecord,
				);
				expect(storedClaim).toMatchObject({
					claimedAt: 100,
					state: "claimed",
					claimId: "first-claim",
					leaseExpiresAt: 86_500,
					completion: { expiresAt: 900, token: completion.token },
				});
				expect(storedClaim).not.toHaveProperty("expiresAt");
				yield* TestClock.adjust("1000 seconds");
				expect(yield* service.completeUploadIntent(user, intent.intentId)).toEqual(completion);
				expect(
					yield* service.claimTemporaryUpload(completion.token, user.id, "first-claim"),
				).toEqual(claimed);
				assertExitFails(
					yield* Effect.exit(
						service.claimTemporaryUpload(completion.token, user.id, "second-claim"),
					),
					new UploadBadRequest({ reason: { code: "token-already-claimed" } }),
				);
				assertExitFails(
					yield* Effect.exit(
						service.putLocalIntent(
							intent.intentId,
							"PUT",
							intent.uploadUrl,
							"image/png",
							"3",
							Stream.make(new Uint8Array([4, 5, 6])),
						),
					),
					new UploadBadRequest({ reason: { code: "intent-expired", intentId: intent.intentId } }),
				);
				expect(yield* fake.tokenWrites).toEqual([
					{ ttl: 900, key: redisKeys.uploadToken(completion.token) },
					{ ttl: 86_400, key: redisKeys.uploadToken(completion.token) },
				]);
				yield* service.cleanupPendingIntents(100);
				expect(yield* fake.deletedObjects).toEqual([]);
				yield* TestClock.adjust("85400 seconds");
				assertExitFails(
					yield* Effect.exit(
						service.claimTemporaryUpload(completion.token, user.id, "first-claim"),
					),
					new UploadBadRequest({ reason: { code: "token-invalid" } }),
				);
				yield* service.cleanupPendingIntents(100);
				expect(yield* fake.deletedKeys).toEqual([
					redisKeys.uploadToken(completion.token),
					redisKeys.uploadIntent(intent.intentId),
				]);
				expect(yield* fake.deletedObjects).toEqual([claimed.locator]);
			}),
	);
});

layer(makeUploadIntentsLayer({ intentRecord: makeIntentRecord() }))((test) => {
	test.effect("rejects a new claim at token expiry and rejects a foreign owner", () =>
		Effect.gen(function* () {
			const service = yield* UploadIntentsService;
			assertExitFails(
				yield* Effect.exit(
					service.claimTemporaryUpload("upload-token", UserId.make("other-user"), "claim"),
				),
				new UploadBadRequest({ reason: { code: "token-forbidden" } }),
			);
			yield* TestClock.adjust("900 seconds");
			assertExitFails(
				yield* Effect.exit(service.claimTemporaryUpload("upload-token", user.id, "claim")),
				new UploadBadRequest({ reason: { code: "token-invalid" } }),
			);
		}),
	);
});

layer(makeUploadIntentsLayer({ blockStat: true }))((test) => {
	test.effect(
		"completion excludes writes, duplicate completion, and cleanup; concurrent claimants have one winner",
		() =>
			Effect.gen(function* () {
				const service = yield* UploadIntentsService;
				const fake = yield* FakeUploadStore;
				const intent = yield* service.createUploadIntent(user, {
					kind: "temporary",
					fileName: "photo.png",
					contentType: "image/png",
				});
				const completing = yield* Effect.forkScoped(
					service.completeUploadIntent(user, intent.intentId),
				);
				yield* fake.awaitStat;
				assertExitFails(
					yield* Effect.exit(service.completeUploadIntent(user, intent.intentId)),
					new UploadBadRequest({ reason: { code: "intent-busy", intentId: intent.intentId } }),
				);
				assertExitFails(
					yield* Effect.exit(
						service.putLocalIntent(
							intent.intentId,
							"PUT",
							intent.uploadUrl,
							"image/png",
							"3",
							Stream.empty,
						),
					),
					new UploadBadRequest({ reason: { code: "intent-busy", intentId: intent.intentId } }),
				);
				yield* service.cleanupPendingIntents(100);
				expect(yield* fake.deletedObjects).toEqual([]);
				expect(yield* fake.reindexed).toEqual([]);
				expect(yield* fake.writes).toEqual([]);
				yield* fake.releaseStat;
				const completion = yield* Fiber.join(completing);
				assert("token" in completion);
				const claims = yield* Effect.all(
					[
						service.claimTemporaryUpload(completion.token, user.id, "claim-a").pipe(Effect.result),
						service.claimTemporaryUpload(completion.token, user.id, "claim-b").pipe(Effect.result),
					],
					{ concurrency: "unbounded" },
				);
				expect(claims.filter((result) => result._tag === "Success")).toHaveLength(1);
				expect(claims.filter((result) => result._tag === "Failure")).toHaveLength(1);
				const rejectedClaim = claims.find((result) => result._tag === "Failure");
				assert(rejectedClaim);
				expect(["token-busy", "token-already-claimed"]).toContain(
					rejectedClaim.failure.reason.code,
				);
				expect(yield* fake.tokenWrites).toHaveLength(2);
			}),
	);
});

for (const kind of ["temporary", "permanent"] as const) {
	layer(makeUploadIntentsLayer({}))((test) => {
		test.effect(`rejects expired pending ${kind} completion and cleans its object`, () =>
			Effect.gen(function* () {
				const service = yield* UploadIntentsService;
				const fake = yield* FakeUploadStore;
				const intent = yield* service.createUploadIntent(user, {
					kind,
					fileName: "photo.png",
					contentType: "image/png",
				});
				yield* TestClock.adjust("900 seconds");
				assertExitFails(
					yield* Effect.exit(service.completeUploadIntent(user, intent.intentId)),
					new UploadBadRequest({ reason: { code: "intent-expired", intentId: intent.intentId } }),
				);
				yield* service.cleanupPendingIntents(100);
				expect(yield* fake.deletedObjects).toHaveLength(1);
				expect(yield* fake.storedValues).toEqual(new Map());
			}),
		);
	});
}

layer(makeUploadIntentsLayer({ missingObject: true }))((test) => {
	test.effect("keeps a failed completion pending for a later upload", () =>
		Effect.gen(function* () {
			const service = yield* UploadIntentsService;
			const fake = yield* FakeUploadStore;
			const intent = yield* service.createUploadIntent(user, {
				kind: "temporary",
				fileName: "photo.png",
				contentType: "image/png",
			});
			assertExitFails(
				yield* Effect.exit(service.completeUploadIntent(user, intent.intentId)),
				new UploadBadRequest({ reason: { code: "object-missing", intentId: intent.intentId } }),
			);
			const record = (yield* fake.storedValues).get(redisKeys.uploadIntent(intent.intentId));
			assert(record);
			expect(
				yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(record),
			).toMatchObject({
				state: "pending",
				expiresAt: Math.floor((yield* Clock.currentTimeMillis) / 1000) + 900,
			});
			yield* service.putLocalIntent(
				intent.intentId,
				"PUT",
				intent.uploadUrl,
				"image/png",
				"3",
				Stream.empty,
			);
			expect(yield* fake.writes).toHaveLength(1);
			expect(yield* fake.tokenWrites).toEqual([]);
		}),
	);
});
