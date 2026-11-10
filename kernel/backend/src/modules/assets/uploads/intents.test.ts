import { expect } from "bun:test";

import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import { badRequest } from "@ryot-app/contract/errors";
import {
	type ManagedAssetLocator,
	UploadBadRequest,
} from "@ryot-app/contract/modules/assets/schemas";
import { UserId } from "@ryot-app/contract/schema/brands";
import { UTC } from "@ryot-app/contract/schema/time-zone";
import { assert } from "@ryot-app/testing/assert";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { eq, sql } from "drizzle-orm";
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

import { DatabaseSession } from "#platform/db/session";
import { LocalStorageService } from "#platform/storage/local-storage";
import { S3Service } from "#platform/storage/s3";
import { TransientValues } from "#platform/transient-values";
import { transientValue } from "#schema/tables/transient-values";
import { uploadIntent } from "#schema/tables/uploads";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { ManagedAssetsService } from "../storage/managed-assets";
import { ObjectStorageService } from "../storage/object-storage";
import { UploadIntentsService } from "./intents";
import { UploadIntentsRepository } from "./intents-repository";

const mockLocalStorage = Layer.mock(LocalStorageService);
const mockManagedAssets = Layer.mock(ManagedAssetsService);
const mockObjectStorage = Layer.mock(ObjectStorageService);
const mockS3 = Layer.mock(S3Service);

const user: CurrentUserValue = {
	image: null,
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-id"),
	preferences: {
		language: null,
		reportingTimeZone: UTC,
		ratingScale: "hundred",
		disableIntegrations: false,
	},
};

const cleanupIntentId = "intent-id";
const intentLock = (intentId: string) => `upload:lock:${intentId}`;
const uploadToken = (token: string) => `upload:token:${token}`;
const epoch = new Date(0);
const tokenRecord = JSON.stringify({ userId: user.id, intentId: cleanupIntentId });
const decodeJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));

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

const storedIntent = (intentId: string) =>
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const [row] = yield* session.run((db) =>
			db
				.select({ metadata: uploadIntent.metadata, deadline: uploadIntent.deadline })
				.from(uploadIntent)
				.where(eq(uploadIntent.id, intentId)),
		);
		return row === undefined
			? null
			: { deadline: row.deadline.getTime() / 1000, metadata: yield* decodeJson(row.metadata) };
	}).pipe(Effect.orDie);

const storedValue = (key: string) =>
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const [row] = yield* session.run((db) =>
			db
				.select({
					value: transientValue.value,
					ttlSeconds: sql<number>`round(extract(epoch from ${transientValue.expiresAt} - now()))::int`,
				})
				.from(transientValue)
				.where(eq(transientValue.key, key)),
		);
		return row ?? null;
	}).pipe(Effect.orDie);

class FakeUploadStore extends Context.Service<
	FakeUploadStore,
	{
		readonly awaitStat: Effect.Effect<void>;
		readonly releaseStat: Effect.Effect<boolean>;
		readonly writes: Effect.Effect<ReadonlyArray<string>>;
		readonly registrations: Effect.Effect<ReadonlyArray<string>>;
		readonly deletedObjects: Effect.Effect<ReadonlyArray<ManagedAssetLocator>>;
	}
>()("@ryot-app/kernel-backend/modules/assets/uploads/intents.test/FakeUploadStore") {}

const append = <A>(ref: Ref.Ref<ReadonlyArray<A>>, ...values: ReadonlyArray<A>) =>
	Ref.update(ref, (all) => [...all, ...values]);

const storageLayer = Layer.merge(UploadIntentsRepository.layer, TransientValues.layer).pipe(
	Layer.provideMerge(isolatedDatabaseLayer("upload_intents")),
);

const makeUploadIntentsLayer = (options: {
	readonly blockStat?: boolean;
	readonly intentRecord?: string;
	readonly missingObject?: boolean;
	readonly provider?: "s3" | "local";
	readonly objectDeletionFails?: boolean;
}) =>
	UploadIntentsService.layer.pipe(
		Layer.provideMerge(
			Layer.unwrap(
				Effect.gen(function* () {
					if (options.intentRecord !== undefined) {
						yield* (yield* UploadIntentsRepository).put(cleanupIntentId, options.intentRecord, 900);
						yield* (yield* TransientValues)
							.set(uploadToken("upload-token"), tokenRecord)
							.pipe(Effect.orDie);
					}
					const writes = yield* Ref.make<ReadonlyArray<string>>([]);
					const registrations = yield* Ref.make<ReadonlyArray<string>>([]);
					const statEntered = yield* Deferred.make<void>();
					const statReleased = yield* Deferred.make<void>();
					const deletedObjects = yield* Ref.make<ReadonlyArray<ManagedAssetLocator>>([]);
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
							writes: Ref.get(writes),
							registrations: Ref.get(registrations),
							awaitStat: Deferred.await(statEntered),
							deletedObjects: Ref.get(deletedObjects),
							releaseStat: Deferred.succeed(statReleased, undefined),
						}),
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
		Layer.provideMerge(storageLayer),
	);

layer(makeUploadIntentsLayer({}))((test) => {
	test.effect(
		"selects, creates, and indexes a permanent upload intent without client provider input",
		() =>
			Effect.gen(function* () {
				const service = yield* UploadIntentsService;
				const result = yield* service.createUploadIntent(user, {
					kind: "permanent",
					fileName: "photo.png",
					contentType: "image/png",
				});
				expect(result.uploadUrl).toMatch(new RegExp(`^/uploads/local/${result.intentId}`));
				expect(yield* storedIntent(result.intentId)).toMatchObject({
					deadline: 900,
					metadata: { provider: "local", fileName: "photo.png" },
				});
			}),
		testTimeout,
	);
});

layer(
	makeUploadIntentsLayer({
		intentRecord: makeIntentRecord({ completion: { expiresAt: 900, token: "upload-token" } }),
	}),
)((test) => {
	test.effect(
		"cleans up an expired upload intent and releases its lock",
		() =>
			Effect.gen(function* () {
				const service = yield* UploadIntentsService;
				const fake = yield* FakeUploadStore;
				yield* TestClock.adjust("1000 seconds");
				yield* service.cleanupPendingIntents(100);
				expect(yield* storedValue(intentLock(cleanupIntentId))).toBeNull();
				expect(yield* storedIntent(cleanupIntentId)).toBeNull();
				expect(yield* storedValue(uploadToken("upload-token"))).toBeNull();
				expect(yield* fake.deletedObjects).toEqual([
					{ type: "local", key: "temporary/object.png" },
				]);
			}),
		testTimeout,
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
	test.effect(
		"moves the deadline of an intent whose expiry was renewed after selection",
		() =>
			Effect.gen(function* () {
				const service = yield* UploadIntentsService;
				const fake = yield* FakeUploadStore;
				yield* TestClock.adjust("1000 seconds");
				yield* service.cleanupPendingIntents(100);
				expect(yield* fake.deletedObjects).toEqual([]);
				expect(yield* storedIntent(cleanupIntentId)).toMatchObject({ deadline: 86_500 });
			}),
		testTimeout,
	);
});

layer(makeUploadIntentsLayer({ objectDeletionFails: true, intentRecord: makeIntentRecord() }))(
	(test) => {
		test.effect(
			"leaves a failed deletion due for the next cleanup run",
			() =>
				Effect.gen(function* () {
					const service = yield* UploadIntentsService;
					const fake = yield* FakeUploadStore;
					yield* TestClock.adjust("1000 seconds");
					yield* service.cleanupPendingIntents(100);
					expect(yield* storedValue(intentLock(cleanupIntentId))).toBeNull();
					expect(yield* storedIntent(cleanupIntentId)).toMatchObject({ deadline: 900 });
					expect((yield* fake.deletedObjects).map(({ key }) => key)).toEqual([
						"temporary/object.png",
					]);
				}),
			testTimeout,
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
					const record = yield* storedIntent(intent.intentId);
					assert(record);
					expect(record.metadata).toEqual({
						completion,
						createdAt: 0,
						userId: user.id,
						kind: "permanent",
						state: "completed",
						fileName: "photo.png",
						contentType: "image/png",
						intentId: intent.intentId,
					});
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
			testTimeout,
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
				expect((yield* storedValue(uploadToken(completion.token)))?.ttlSeconds).toBe(900);
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
				expect(claimed).toEqual<unknown>({
					fileName: "photo.png",
					intentId: intent.intentId,
					leaseExpiresAt: "1970-01-02T00:01:40.000Z",
					locator: { type: "local", key: (yield* fake.writes)[0] },
					resolvedPath: `/isolated-test/${(yield* fake.writes)[0]}`,
				});
				const claimedRecord = yield* storedIntent(intent.intentId);
				assert(claimedRecord);
				const storedClaim = claimedRecord.metadata;
				expect(claimedRecord.deadline).toBe(86_500);
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
				expect((yield* storedValue(uploadToken(completion.token)))?.ttlSeconds).toBeGreaterThan(
					86_000,
				);
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
				expect(yield* storedValue(uploadToken(completion.token))).toBeNull();
				expect(yield* storedIntent(intent.intentId)).toBeNull();
				expect(yield* fake.deletedObjects).toEqual([claimed.locator]);
			}),
		testTimeout,
	);
});

layer(makeUploadIntentsLayer({ intentRecord: makeIntentRecord() }))((test) => {
	test.effect(
		"rejects a new claim at token expiry and rejects a foreign owner",
		() =>
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
		testTimeout,
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
				expect(yield* storedIntent(intent.intentId)).toMatchObject({
					metadata: { state: "pending" },
				});
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
			}),
		testTimeout,
	);
});

for (const kind of ["temporary", "permanent"] as const) {
	layer(makeUploadIntentsLayer({}))((test) => {
		test.effect(
			`rejects expired pending ${kind} completion and cleans its object`,
			() =>
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
					expect(yield* storedIntent(intent.intentId)).toBeNull();
				}),
			testTimeout,
		);
	});
}

layer(makeUploadIntentsLayer({ missingObject: true }))((test) => {
	test.effect(
		"keeps a failed completion pending for a later upload",
		() =>
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
				const record = yield* storedIntent(intent.intentId);
				assert(record);
				expect(record.metadata).toMatchObject({
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
				expect(yield* storedValue(uploadToken("upload-token"))).toBeNull();
			}),
		testTimeout,
	);
});
