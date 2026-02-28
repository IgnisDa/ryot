import { expect, it } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { BadRequest } from "@ryot/contract/errors";
import { UPLOAD_MAX_FILE_BYTES } from "@ryot/contract/modules/uploads/upload-policy";
import { UserId } from "@ryot/contract/schema/brands";
import { Effect, FileSystem, Layer, Option, Path, Redacted } from "effect";
import Redis from "ioredis";

import { LocalStorageService } from "#lib/infrastructure/local-storage";
import { RedisService, redisKeys } from "#lib/infrastructure/redis";
import { S3Service } from "#lib/infrastructure/s3";
import { assertExitFails } from "#lib/test-utils/assertions";
import { makeAppConfigLayer, makeRedisService } from "#lib/test-utils/effect";

import { UploadsService } from "./service";

const user: CurrentUserValue = {
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-id"),
	preferences: { isNsfw: false, language: null, disableIntegrations: false },
};

const TEST_TMP_DIR = "/tmp/ryot-test-uploads";

const mockS3Service = Layer.mock(S3Service);
const mockLocalStorageService = Layer.mock(LocalStorageService);

type S3Overrides = Omit<Parameters<typeof mockS3Service>[0], "_tag" | "isConfigured"> & {
	isConfigured?: Parameters<typeof mockS3Service>[0]["isConfigured"];
};

const makeS3Layer = (overrides: S3Overrides = {}) =>
	mockS3Service({
		isConfigured: true,
		deleteObject: () => Effect.void,
		presignUpload: () => Effect.succeed("https://example.com/upload"),
		presignDownload: () => Effect.succeed("https://example.com/download"),
		statObject: () =>
			Effect.succeed({ size: 100, etag: "etag", type: "image/png", lastModified: new Date() }),
		...overrides,
	});

type LocalStorageOverrides = Omit<
	Parameters<typeof mockLocalStorageService>[0],
	"_tag" | "isConfiguredForKind"
>;

const makeLocalStorageLayer = (overrides: LocalStorageOverrides = {}) =>
	mockLocalStorageService({
		statObject: () => Effect.succeed(defaultFileInfo),
		resolveObjectPath: () => Effect.succeed("/tmp/object"),
		isConfiguredForKind: () => true,
		createDownloadTarget: () => Effect.succeed("uploads/local/download?signature=local"),
		verifyDownloadTarget: () =>
			Effect.succeed({ contentType: "image/png", key: "permanent/object.png" }),
		...overrides,
	});

const makeRedisClient = (): RedisService["Service"]["client"] =>
	Object.assign(Object.create(Redis.prototype), { duplicate: makeRedisClient });

const makeRedisLayer = (overrides: Partial<RedisService["Service"]> = {}) =>
	Layer.succeed(
		RedisService,
		makeRedisService({
			client: makeRedisClient(),
			releaseLease: () => Effect.void,
			del: () => Effect.succeed(0),
			renewLease: () => Effect.succeed(true),
			setAndIndexAndSet: () => Effect.die("unused"),
			setAndIndexAndDelete: () => Effect.die("unused"),
			acquireLease: () => Effect.succeed("00000000-0000-0000-0000-000000000000"),
			...overrides,
		}),
	);

const makeFsLayer = (overrides: Record<string, unknown> = {}) =>
	FileSystem.layerNoop({
		stat: () => Effect.die("unused"),
		readFile: () => Effect.die("unused"),
		writeFile: () => Effect.die("unused"),
		...overrides,
	} as Parameters<typeof FileSystem.layerNoop>[0]);

const defaultFileInfo = {
	dev: 0,
	mode: 0o644,
	type: "File" as const,
	mtime: Option.none<Date>(),
	atime: Option.none<Date>(),
	ino: Option.none<number>(),
	uid: Option.none<number>(),
	gid: Option.none<number>(),
	rdev: Option.none<number>(),
	nlink: Option.none<number>(),
	blocks: Option.none<number>(),
	birthtime: Option.none<Date>(),
	size: FileSystem.Size(100),
	blksize: Option.none<FileSystem.Size>(),
} satisfies FileSystem.File.Info;

const makeUploadsLayer = (
	options: {
		fsLayer?: ReturnType<typeof makeFsLayer>;
		s3Service?: ReturnType<typeof makeS3Layer>;
		redisService?: ReturnType<typeof makeRedisLayer>;
		config?: Parameters<typeof makeAppConfigLayer>[0];
		localStorageService?: ReturnType<typeof makeLocalStorageLayer>;
	} = {},
) => {
	const appConfig = makeAppConfigLayer({
		...options.config,
		fileStorage: { ...options.config?.fileStorage, localTempDir: TEST_TMP_DIR },
	});
	const fsLayer = options.fsLayer ?? makeFsLayer();
	const localStorage = LocalStorageService.layer.pipe(
		Layer.provide(Layer.mergeAll(appConfig, fsLayer, Path.layer)),
	);
	return UploadsService.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				appConfig,
				fsLayer,
				options.s3Service ?? makeS3Layer(),
				options.redisService ?? makeRedisLayer(),
				options.localStorageService ?? localStorage,
			),
		),
	);
};

it.effect("creates and indexes a local permanent upload intent", () => {
	const stored = new Map<string, string>();
	const indexed: Array<{ key: string; score: number; member: string }> = [];

	return Effect.gen(function* () {
		const service = yield* UploadsService;
		const result = yield* service.createUploadIntent(user, {
			provider: "local",
			kind: "permanent",
			fileName: "photo.png",
			contentType: "image/png",
		});
		expect(result.uploadUrl).toMatch(new RegExp(`^/uploads/local/${result.intentId}`));
		expect(indexed).toHaveLength(1);
		expect(stored.get(redisKeys.uploadIntent(result.intentId))).toContain('"provider":"local"');
	}).pipe(
		Effect.provide(
			makeUploadsLayer({
				config: {
					fileStorage: {
						localDir: Option.some(TEST_TMP_DIR),
						localSigningSecret: Option.some(Redacted.make("secret")),
					},
				},
				localStorageService: makeLocalStorageLayer({
					createUploadTarget: (intentId) =>
						Effect.succeed({
							method: "PUT" as const,
							expiresAt: 1_700_000_900,
							uploadUrl: `/uploads/local/${intentId}?expires=1700000900&signature=signature`,
						}),
				}),
				redisService: makeRedisLayer({
					setAndIndex: (key, value, indexKey, score, member) => {
						stored.set(key, value);
						indexed.push({ key: indexKey, score, member });
						return Effect.void;
					},
				}),
			}),
		),
	);
});

it.effect("creates an S3 permanent intent with an absolute upload URL", () =>
	Effect.gen(function* () {
		const service = yield* UploadsService;
		const result = yield* service.createUploadIntent(user, {
			provider: "s3",
			kind: "permanent",
			fileName: "photo.png",
			contentType: "image/png",
		});
		expect(result.uploadUrl).toMatch(/^https:\/\//);
		expect(result.headers).toEqual({ "content-type": "image/png" });
	}).pipe(
		Effect.provide(
			makeUploadsLayer({
				redisService: makeRedisLayer({ setAndIndex: () => Effect.void }),
				s3Service: makeS3Layer({
					presignUpload: (key, contentType) =>
						Effect.succeed(`https://example.com/${key}?type=${contentType}`),
				}),
			}),
		),
	),
);

it.effect("rejects S3 intents when the provider is unavailable", () =>
	Effect.gen(function* () {
		const service = yield* UploadsService;
		const exit = yield* Effect.exit(
			service.createUploadIntent(user, {
				provider: "s3",
				kind: "permanent",
				fileName: "photo.png",
				contentType: "image/png",
			}),
		);
		assertExitFails(
			exit,
			new BadRequest({
				message: "S3 file storage is not configured. Set the FILE_STORAGE_S3_* settings.",
			}),
		);
	}).pipe(Effect.provide(makeUploadsLayer({ s3Service: makeS3Layer({ isConfigured: false }) }))),
);

it.effect("completes an S3 intent idempotently after verification", () => {
	const intentId = "s3-intent";
	const intentKey = redisKeys.uploadIntent(intentId);
	const stored = new Map([
		[
			intentKey,
			JSON.stringify({
				intentId,
				provider: "s3",
				state: "pending",
				kind: "permanent",
				userId: "user-id",
				createdAt: 1_700_000_000,
				expiresAt: 4_102_444_800,
				contentType: "image/png",
				objectKey: "permanent/object.png",
			}),
		],
	]);
	const removed: string[] = [];

	return Effect.gen(function* () {
		const service = yield* UploadsService;
		const first = yield* service.completeUploadIntent(user, intentId);
		const second = yield* service.completeUploadIntent(user, intentId);
		expect(first).toEqual({ type: "s3", key: "permanent/object.png" });
		expect(second).toEqual(first);
		expect(removed).toEqual([intentId]);
	}).pipe(
		Effect.provide(
			makeUploadsLayer({
				redisService: makeRedisLayer({
					get: (key) => Effect.succeed(stored.get(key) ?? null),
					setAndRemoveFromIndex: (key, value, _indexKey, member) => {
						stored.set(key, value);
						removed.push(member);
						return Effect.void;
					},
				}),
				s3Service: makeS3Layer({
					statObject: () =>
						Effect.succeed({
							size: 100,
							etag: "etag",
							lastModified: new Date(),
							type: "image/png; charset=binary",
						}),
				}),
			}),
		),
	);
});

it.effect("resolves local and S3 download URLs with their locators", () =>
	Effect.gen(function* () {
		const service = yield* UploadsService;
		const result = yield* service.resolveDownloads(user, [
			{ type: "s3", key: "permanent/image.png" },
			{ type: "local", key: "permanent/image.png" },
		]);
		expect(result[0]).toEqual({
			downloadUrl: "https://example.com/s3",
			asset: { type: "s3", key: "permanent/image.png" },
		});
		expect(result[1]?.asset).toEqual({ type: "local", key: "permanent/image.png" });
		expect(result[1]?.downloadUrl).toContain("uploads/local/download?");
	}).pipe(
		Effect.provide(
			makeUploadsLayer({
				localStorageService: makeLocalStorageLayer(),
				s3Service: makeS3Layer({
					presignDownload: () => Effect.succeed("https://example.com/s3"),
				}),
			}),
		),
	),
);

it.effect("cleans up due local and S3 pending intents in a bounded batch", () => {
	const stored = new Map([
		[
			redisKeys.uploadIntent("local-intent"),
			JSON.stringify({
				createdAt: 1,
				expiresAt: 0,
				state: "pending",
				userId: "user-id",
				provider: "local",
				kind: "permanent",
				intentId: "local-intent",
				contentType: "image/png",
				objectKey: "permanent/local.png",
			}),
		],
		[
			redisKeys.uploadIntent("s3-intent"),
			JSON.stringify({
				createdAt: 1,
				expiresAt: 0,
				provider: "s3",
				state: "pending",
				kind: "permanent",
				userId: "user-id",
				intentId: "s3-intent",
				contentType: "image/png",
				objectKey: "permanent/s3.png",
			}),
		],
	]);
	const deleted: string[] = [];

	return Effect.gen(function* () {
		const service = yield* UploadsService;
		yield* service.cleanupPendingIntents(2);
		expect(deleted).toEqual(["local:permanent/local.png", "s3:permanent/s3.png"]);
		expect(stored.has(redisKeys.uploadIntent("local-intent"))).toBe(false);
		expect(stored.has(redisKeys.uploadIntent("s3-intent"))).toBe(false);
	}).pipe(
		Effect.provide(
			makeUploadsLayer({
				redisService: makeRedisLayer({
					get: (key) => Effect.succeed(stored.get(key) ?? null),
					setAndIndex: (key, value) => {
						stored.set(key, value);
						return Effect.void;
					},
					zrangeByScore: () => Effect.succeed(["local-intent", "s3-intent"]),
					zrem: () => Effect.void,
					del: (...keys) => {
						for (const key of keys) {
							stored.delete(key);
						}
						return Effect.succeed(keys.length);
					},
				}),
				localStorageService: makeLocalStorageLayer({
					deleteObject: (key) => {
						deleted.push(`local:${key}`);
						return Effect.void;
					},
				}),
				s3Service: makeS3Layer({
					deleteObject: (key) => {
						deleted.push(`s3:${key}`);
						return Effect.void;
					},
				}),
			}),
		),
	);
});

it.effect("keeps duplicate cleanup dispatches idempotent", () => {
	const intentId = "duplicate-cleanup-intent";
	const intentKey = redisKeys.uploadIntent(intentId);
	const stored = new Map([
		[
			intentKey,
			JSON.stringify({
				intentId,
				createdAt: 1,
				expiresAt: 0,
				state: "pending",
				kind: "temporary",
				userId: "user-id",
				provider: "local",
				contentType: "text/csv",
				objectKey: "temporary/duplicate.csv",
			}),
		],
	]);
	const deleted: string[] = [];

	return Effect.gen(function* () {
		const service = yield* UploadsService;
		yield* service.cleanupPendingIntents(1);
		yield* service.cleanupPendingIntents(1);
		expect(deleted).toEqual(["temporary/duplicate.csv"]);
	}).pipe(
		Effect.provide(
			makeUploadsLayer({
				redisService: makeRedisLayer({
					get: (key) => Effect.succeed(stored.get(key) ?? null),
					setAndIndex: (key, value) => {
						stored.set(key, value);
						return Effect.void;
					},
					zrangeByScore: () => Effect.succeed([intentId]),
					zrem: () => Effect.void,
					del: (...keys) => {
						for (const key of keys) {
							stored.delete(key);
						}
						return Effect.succeed(keys.length);
					},
				}),
				localStorageService: makeLocalStorageLayer({
					deleteObject: (key) => {
						deleted.push(key);
						return Effect.void;
					},
				}),
			}),
		),
	);
});

it.effect("does not clean an intent while its processing lease is held", () => {
	const intentId = "claimed-during-cleanup-intent";
	const intentKey = redisKeys.uploadIntent(intentId);
	const stored = new Map([
		[
			intentKey,
			JSON.stringify({
				intentId,
				createdAt: 1,
				expiresAt: 0,
				userId: "user-id",
				provider: "local",
				kind: "temporary",
				state: "completed",
				contentType: "text/csv",
				objectKey: "temporary/claimed.csv",
				completion: { expiresAt: 0, token: "token" },
			}),
		],
	]);

	return Effect.gen(function* () {
		const service = yield* UploadsService;
		yield* service.cleanupPendingIntents(1);
		expect(stored.has(intentKey)).toBe(true);
	}).pipe(
		Effect.provide(
			makeUploadsLayer({
				redisService: makeRedisLayer({
					zrangeByScore: () => Effect.succeed([intentId]),
					get: (key) => Effect.succeed(stored.get(key) ?? null),
					acquireLease: (key) =>
						Effect.succeed(
							key === redisKeys.uploadIntentCleanupLock(intentId)
								? "00000000-0000-0000-0000-000000000000"
								: null,
						),
				}),
			}),
		),
	);
});

it.effect("completes a local intent idempotently and removes its expiry index", () => {
	const intentId = "intent-id";
	const intentKey = redisKeys.uploadIntent(intentId);
	const stored = new Map([
		[
			intentKey,
			'{"intentId":"intent-id","userId":"user-id","provider":"local","kind":"permanent","objectKey":"permanent/object.png","contentType":"image/png","state":"pending","createdAt":1700000000,"expiresAt":4102444800}',
		],
	]);
	const removed: string[] = [];

	return Effect.gen(function* () {
		const service = yield* UploadsService;
		const first = yield* service.completeUploadIntent(user, intentId);
		const second = yield* service.completeUploadIntent(user, intentId);
		expect(first).toEqual({ type: "local", key: "permanent/object.png" });
		expect(second).toEqual(first);
		expect(removed).toEqual([intentId]);
	}).pipe(
		Effect.provide(
			makeUploadsLayer({
				redisService: makeRedisLayer({
					get: (key) => Effect.succeed(stored.get(key) ?? null),
					setAndRemoveFromIndex: (key, value, _indexKey, member) => {
						stored.set(key, value);
						removed.push(member);
						return Effect.void;
					},
				}),
				localStorageService: makeLocalStorageLayer({
					statObject: () => Effect.succeed(defaultFileInfo),
				}),
			}),
		),
	);
});

it.effect("completes, claims, and deletes a local temporary intent", () => {
	const stored = new Map<string, string>();
	const deleted: string[] = [];

	return Effect.gen(function* () {
		const service = yield* UploadsService;
		const intent = yield* service.createUploadIntent(user, {
			provider: "local",
			kind: "temporary",
			fileName: "report.csv",
			contentType: "text/csv",
		});
		const intentKey = redisKeys.uploadIntent(intent.intentId);
		const completed = yield* service.completeUploadIntent(user, intent.intentId);
		if (!("token" in completed)) {
			throw new Error("Expected a temporary upload token");
		}
		const otherUser = { ...user, id: UserId.make("other-user") };
		const wrongUser = yield* Effect.exit(
			service.claimTemporaryUpload(completed.token, otherUser.id),
		);
		assertExitFails(
			wrongUser,
			new BadRequest({ message: "Upload token does not belong to this user" }),
		);
		const claimed = yield* service.claimTemporaryUpload(completed.token, user.id);
		expect(claimed.locator.type).toBe("local");
		expect(claimed.locator.key).toMatch(/^temporary\/.+\.csv$/);
		expect(claimed.resolvedPath).toBe("/tmp/object");
		expect(stored.get(intentKey)).toContain('"state":"claimed"');
		yield* service.deleteTemporaryUpload(intent.intentId);
		yield* service.deleteTemporaryUpload(intent.intentId);
		expect(deleted).toEqual([claimed.locator.key]);
		expect(stored.has(intentKey)).toBe(false);
	}).pipe(
		Effect.provide(
			makeUploadsLayer({
				config: {
					fileStorage: {
						localDir: Option.some(TEST_TMP_DIR),
						localSigningSecret: Option.some(Redacted.make("secret")),
					},
				},
				redisService: makeRedisLayer({
					setAndIndex: (key, value) => {
						stored.set(key, value);
						return Effect.void;
					},
					set: (key, value) => {
						stored.set(key, value);
						return Effect.void;
					},
					setAndIndexAndDelete: (key, value, _indexKey, _score, _member, deleteKey) => {
						stored.set(key, value);
						stored.delete(deleteKey);
						return Effect.void;
					},
					setAndIndexAndSet: (
						key,
						value,
						_indexKey,
						_score,
						_member,
						secondaryKey,
						secondaryValue,
					) => {
						stored.set(key, value);
						stored.set(secondaryKey, secondaryValue);
						return Effect.void;
					},
					get: (key) => Effect.succeed(stored.get(key) ?? null),
					zrem: () => Effect.void,
					del: (...keys) => {
						for (const key of keys) {
							if (key.startsWith("ryot:upload:intent:")) {
								stored.delete(key);
							}
							if (key.startsWith("ryot:upload:token:")) {
								stored.delete(key);
							}
						}
						return Effect.succeed(keys.length);
					},
				}),
				localStorageService: makeLocalStorageLayer({
					createUploadTarget: (createdIntentId) =>
						Effect.succeed({
							method: "PUT" as const,
							expiresAt: 1_700_000_900,
							uploadUrl: `/uploads/local/${createdIntentId}?expires=1700000900&signature=signature`,
						}),
					deleteObject: (key) => {
						deleted.push(key);
						return Effect.void;
					},
				}),
			}),
		),
	);
});

it.effect("completes, claims, and deletes an S3 temporary intent", () => {
	const stored = new Map<string, string>();
	const deleted: string[] = [];

	return Effect.gen(function* () {
		const service = yield* UploadsService;
		const intent = yield* service.createUploadIntent(user, {
			provider: "s3",
			kind: "temporary",
			fileName: "report.csv",
			contentType: "text/csv",
		});
		const completed = yield* service.completeUploadIntent(user, intent.intentId);
		if (!("token" in completed)) {
			throw new Error("Expected a temporary upload token");
		}
		const claimed = yield* service.claimTemporaryUpload(completed.token, user.id);
		expect(claimed.locator).toMatchObject({ type: "s3" });
		expect(claimed.locator.key).toMatch(/^temporary\/.+\.csv$/);
		expect("resolvedPath" in claimed).toBe(false);
		yield* service.deleteTemporaryUpload(intent.intentId);
		expect(deleted).toEqual([claimed.locator.key]);
		expect(stored.has(redisKeys.uploadIntent(intent.intentId))).toBe(false);
	}).pipe(
		Effect.provide(
			makeUploadsLayer({
				redisService: makeRedisLayer({
					setAndIndex: (key, value) => {
						stored.set(key, value);
						return Effect.void;
					},
					setAndIndexAndDelete: (key, value, _indexKey, _score, _member, deleteKey) => {
						stored.set(key, value);
						stored.delete(deleteKey);
						return Effect.void;
					},
					setAndIndexAndSet: (
						key,
						value,
						_indexKey,
						_score,
						_member,
						secondaryKey,
						secondaryValue,
					) => {
						stored.set(key, value);
						stored.set(secondaryKey, secondaryValue);
						return Effect.void;
					},
					get: (key) => Effect.succeed(stored.get(key) ?? null),
					zrem: () => Effect.void,
					del: (...keys) => {
						for (const key of keys) {
							stored.delete(key);
						}
						return Effect.succeed(keys.length);
					},
				}),
				s3Service: makeS3Layer({
					statObject: () =>
						Effect.succeed({ size: 100, etag: "etag", type: "text/csv", lastModified: new Date() }),
					deleteObject: (key) => {
						deleted.push(key);
						return Effect.void;
					},
				}),
			}),
		),
	);
});

it.effect("deletes invalid S3 objects when completion rejects them", () => {
	const intentIds = ["oversized-s3-intent", "mismatched-s3-intent"];
	const stored = new Map(
		intentIds.map((intentId) => [
			redisKeys.uploadIntent(intentId),
			JSON.stringify({
				intentId,
				createdAt: 1,
				provider: "s3",
				state: "pending",
				kind: "temporary",
				userId: "user-id",
				contentType: "text/csv",
				expiresAt: 4_102_444_800,
				objectKey: `temporary/${intentId}.csv`,
			}),
		]),
	);
	const deleted: string[] = [];

	return Effect.gen(function* () {
		const service = yield* UploadsService;
		const oversized = yield* Effect.exit(service.completeUploadIntent(user, "oversized-s3-intent"));
		assertExitFails(
			oversized,
			new BadRequest({
				message: `Upload exceeds maximum allowed size of ${UPLOAD_MAX_FILE_BYTES} bytes`,
			}),
		);
		const mismatched = yield* Effect.exit(
			service.completeUploadIntent(user, "mismatched-s3-intent"),
		);
		assertExitFails(
			mismatched,
			new BadRequest({ message: "Upload content type does not match the upload intent" }),
		);
		expect(deleted).toEqual([
			"temporary/oversized-s3-intent.csv",
			"temporary/mismatched-s3-intent.csv",
		]);
	}).pipe(
		Effect.provide(
			makeUploadsLayer({
				redisService: makeRedisLayer({
					get: (key) => Effect.succeed(stored.get(key) ?? null),
				}),
				s3Service: makeS3Layer({
					statObject: (key) =>
						Effect.succeed({
							etag: "etag",
							lastModified: new Date(),
							size: key.includes("oversized") ? UPLOAD_MAX_FILE_BYTES + 1 : 100,
							type: key.includes("mismatched") ? "application/json" : "text/csv",
						}),
					deleteObject: (key) => {
						deleted.push(key);
						return Effect.void;
					},
				}),
			}),
		),
	);
});

it.effect("retries failed cleanup for an expired claimed local upload", () => {
	const intentId = "expired-claimed-intent";
	const intentKey = redisKeys.uploadIntent(intentId);
	const stored = new Map([
		[
			intentKey,
			`{"intentId":"${intentId}","userId":"user-id","provider":"local","kind":"temporary","objectKey":"temporary/object.csv","contentType":"text/csv","state":"claimed","createdAt":1,"expiresAt":0,"claimedAt":1}`,
		],
	]);
	let attempts = 0;

	return Effect.gen(function* () {
		const service = yield* UploadsService;
		yield* service.cleanupPendingIntents(1);
		expect(attempts).toBe(1);
		expect(stored.has(intentKey)).toBe(true);
		yield* service.cleanupPendingIntents(1);
		expect(attempts).toBe(2);
		expect(stored.has(intentKey)).toBe(false);
	}).pipe(
		Effect.provide(
			makeUploadsLayer({
				redisService: makeRedisLayer({
					get: (key) => Effect.succeed(stored.get(key) ?? null),
					setAndIndex: (key, value) => {
						stored.set(key, value);
						return Effect.void;
					},
					zrangeByScore: () => Effect.succeed([intentId]),
					zrem: () => Effect.void,
					del: (...keys) => {
						for (const key of keys) {
							if (key === intentKey) {
								stored.delete(key);
							}
						}
						return Effect.succeed(keys.length);
					},
				}),
				localStorageService: makeLocalStorageLayer({
					deleteObject: () => {
						attempts += 1;
						return attempts === 1
							? Effect.fail(new BadRequest({ message: "temporary" }))
							: Effect.void;
					},
				}),
			}),
		),
	);
});
