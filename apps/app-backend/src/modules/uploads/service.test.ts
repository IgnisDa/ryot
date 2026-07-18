import { expect, it } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { BadRequest } from "@ryot/contract/errors";
import { UPLOAD_MAX_FILE_BYTES } from "@ryot/contract/modules/uploads/upload-policy";
import { UserId } from "@ryot/contract/schema/brands";
import { Effect, FileSystem, Layer, Option, Path, Redacted, Stream } from "effect";
import Redis from "ioredis";

import { LocalStorageService } from "#lib/infrastructure/local-storage";
import { RedisService, redisKeys } from "#lib/infrastructure/redis";
import { S3Service } from "#lib/infrastructure/s3";
import { assertExitFails } from "#lib/test-utils/assertions";
import { databaseLayer, makeAppConfigLayer, makeRedisService } from "#lib/test-utils/effect";

import { type RegisterManagedAssetInput, UploadsRepository } from "./repository";
import { UploadsService } from "./service";

const user: CurrentUserValue = {
	image: null,
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-id"),
	preferences: { allowNsfw: false, language: null, disableIntegrations: false },
};

const TEST_TMP_DIR = "/tmp/ryot-test-uploads";

const mockS3Service = Layer.mock(S3Service);
const mockUploadsRepository = Layer.mock(UploadsRepository);
const mockLocalStorageService = Layer.mock(LocalStorageService);

type S3Overrides = Omit<Parameters<typeof mockS3Service>[0], "_tag" | "isConfigured"> & {
	isConfigured?: Parameters<typeof mockS3Service>[0]["isConfigured"];
};

const makeS3Layer = (overrides: S3Overrides = {}) =>
	mockS3Service({
		isConfigured: true,
		openObject: () => Effect.succeed(Stream.make(new TextEncoder().encode("stored object"))),
		writeObject: () => Effect.sync(() => undefined),
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
		openObject: () => Effect.succeed(Stream.make(new TextEncoder().encode("stored object"))),
		writeObject: () => Effect.sync(() => undefined),
		deleteObject: () => Effect.void,
		statObject: () => Effect.succeed(defaultFileInfo),
		resolveObjectPath: () => Effect.succeed("/tmp/object"),
		isConfiguredForKind: () => true,
		createDownloadTarget: () => Effect.succeed("uploads/local/download?signature=local"),
		verifyDownloadTarget: () =>
			Effect.succeed({ contentType: "image/png", key: "permanent/object.png" }),
		...overrides,
	});

const makeUploadsRepositoryLayer = (overrides: Partial<UploadsRepository["Service"]> = {}) =>
	mockUploadsRepository({
		listByOwner: () => Effect.succeed([]),
		getByLocator: () => Effect.succeed(null),
		listByOwnerAndLocators: (ownerUserId, locators) =>
			Effect.succeed(
				locators.map(({ key, type }) => ({
					key,
					size: 100,
					ownerUserId,
					provider: type,
					contentType: "image/png",
					sha256: "a".repeat(64),
					createdAt: new Date("2026-01-01T00:00:00.000Z"),
				})),
			),
		registerPermanentOwnedObject: (input) =>
			Effect.succeed({ ...input, createdAt: new Date("2026-01-01T00:00:00.000Z") }),
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
		uploadsRepository?: ReturnType<typeof makeUploadsRepositoryLayer>;
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
	const uploads = UploadsService.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				appConfig,
				databaseLayer,
				fsLayer,
				options.s3Service ?? makeS3Layer(),
				options.redisService ?? makeRedisLayer(),
				options.uploadsRepository ?? makeUploadsRepositoryLayer(),
				options.localStorageService ?? localStorage,
			),
		),
	);
	return Layer.merge(uploads, databaseLayer);
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
		expect(stored.get(redisKeys.uploadIntent(result.intentId))).toContain('"fileName":"photo.png"');
	}).pipe(
		Effect.provide(
			makeUploadsLayer({
				config: {
					fileStorage: {
						localDir: TEST_TMP_DIR,
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
				fileName: "object.png",
				createdAt: 1_700_000_000,
				expiresAt: 4_102_444_800,
				contentType: "image/png",
				objectKey: "permanent/object.png",
			}),
		],
	]);
	const removed: string[] = [];
	const registered: RegisterManagedAssetInput[] = [];

	return Effect.gen(function* () {
		const service = yield* UploadsService;
		const first = yield* service.completeUploadIntent(user, intentId);
		const second = yield* service.completeUploadIntent(user, intentId);
		expect(first).toEqual({ type: "s3", key: "permanent/object.png" });
		expect(second).toEqual(first);
		expect(removed).toEqual([intentId]);
		expect(registered).toEqual([
			{
				size: 100,
				ownerUserId: user.id,
				provider: "s3",
				contentType: "image/png",
				key: "permanent/object.png",
				sha256: "0944c113cf83137f77217f86ab614aa5c3aac16cef2de6a4e2f410a529d7bd7a",
			},
		]);
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
				uploadsRepository: makeUploadsRepositoryLayer({
					registerPermanentOwnedObject: (input) => {
						registered.push(input);
						return Effect.succeed({ ...input, createdAt: new Date() });
					},
				}),
			}),
		),
	);
});

it.effect("stages owner-scoped content without registering and cleans a matching orphan", () => {
	const sha256 = "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81";
	const objects = new Map<string, Uint8Array<ArrayBuffer>>();
	const deleted: string[] = [];
	let ownedMetadata: RegisterManagedAssetInput | undefined;
	let registrations = 0;

	return Effect.gen(function* () {
		const service = yield* UploadsService;
		const first = yield* service.stageContentAddressedPermanentAsset({
			sha256,
			size: 3,
			provider: "s3",
			ownerUserId: user.id,
			contentType: "application/octet-stream",
			stream: Stream.make(new Uint8Array([1, 2, 3])),
		});
		const repeated = yield* service.stageContentAddressedPermanentAsset({
			sha256,
			size: 3,
			provider: "s3",
			stream: Stream.empty,
			ownerUserId: user.id,
			contentType: "application/octet-stream",
		});
		const otherUser = yield* service.stageContentAddressedPermanentAsset({
			sha256,
			size: 3,
			provider: "s3",
			ownerUserId: UserId.make("other-user"),
			contentType: "application/octet-stream",
			stream: Stream.make(new Uint8Array([1, 2, 3])),
		});
		expect(repeated.locator).toEqual(first.locator);
		expect(otherUser.locator.key).not.toBe(first.locator.key);
		expect(registrations).toBe(0);
		yield* service.cleanupStagedPermanentAsset(repeated);
		expect(deleted).toEqual([first.locator.key]);
		ownedMetadata = otherUser.metadata;
		yield* service.cleanupStagedPermanentAsset(otherUser);
		expect(deleted).toEqual([first.locator.key]);
	}).pipe(
		Effect.provide(
			makeUploadsLayer({
				s3Service: makeS3Layer({
					openObject: (key) => Effect.succeed(Stream.make(objects.get(key) ?? new Uint8Array())),
					statObject: (key) => {
						const value = objects.get(key);
						return value
							? Effect.succeed({
									size: value.byteLength,
									etag: "etag",
									lastModified: new Date(),
									type: "application/octet-stream",
								})
							: Effect.fail(new BadRequest({ message: "missing" }));
					},
					writeObject: (key, stream) =>
						Stream.runDrain(stream).pipe(
							Effect.tap(() => {
								objects.set(key, new Uint8Array([1, 2, 3]));
								return Effect.void;
							}),
							Effect.mapError(() => new BadRequest({ message: "write failed" })),
						),
					deleteObject: (key) => {
						objects.delete(key);
						deleted.push(key);
						return Effect.void;
					},
				}),
				uploadsRepository: makeUploadsRepositoryLayer({
					getByLocator: (locator) =>
						Effect.succeed(
							ownedMetadata?.key === locator.key
								? { ...ownedMetadata, createdAt: new Date() }
								: null,
						),
					registerPermanentOwnedObject: (input) => {
						registrations += 1;
						return Effect.succeed({ ...input, createdAt: new Date() });
					},
				}),
			}),
		),
	);
});

it.effect("bounds S3 writes and deletes a partial object", () => {
	const deleted: string[] = [];
	return Effect.gen(function* () {
		const service = yield* UploadsService;
		const exit = yield* Effect.exit(
			service.writeObject(
				{ type: "s3", key: "temporary/archive.zip" },
				Stream.make(new Uint8Array(2), new Uint8Array(2)),
				"application/zip",
				undefined,
				3,
			),
		);
		assertExitFails(
			exit,
			new BadRequest({ message: "Upload exceeds maximum allowed size of 3 bytes" }),
		);
		expect(deleted).toEqual(["temporary/archive.zip"]);
	}).pipe(
		Effect.provide(
			makeUploadsLayer({
				s3Service: makeS3Layer({
					writeObject: (_key, stream) =>
						Stream.runDrain(stream).pipe(
							Effect.mapError((error) =>
								error instanceof BadRequest
									? error
									: new BadRequest({ message: "S3 object write failed" }),
							),
						),
					deleteObject: (key) => {
						deleted.push(key);
						return Effect.void;
					},
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

it.effect("rejects an unowned download batch before signing any locator", () => {
	let signed = 0;
	return Effect.gen(function* () {
		const service = yield* UploadsService;
		const exit = yield* Effect.exit(
			service.resolveDownloads(user, [
				{ type: "s3", key: "permanent/owned.png" },
				{ type: "local", key: "permanent/unowned.png" },
			]),
		);
		assertExitFails(
			exit,
			new BadRequest({ message: "One or more managed assets do not belong to this user" }),
		);
		expect(signed).toBe(0);
	}).pipe(
		Effect.provide(
			makeUploadsLayer({
				uploadsRepository: makeUploadsRepositoryLayer({
					listByOwnerAndLocators: (ownerUserId) =>
						Effect.succeed([
							{
								size: 100,
								ownerUserId,
								provider: "s3",
								contentType: "image/png",
								key: "permanent/owned.png",
								sha256: "a".repeat(64),
								createdAt: new Date("2026-01-01T00:00:00.000Z"),
							},
						]),
				}),
				localStorageService: makeLocalStorageLayer({
					createDownloadTarget: () => {
						signed += 1;
						return Effect.succeed("local");
					},
				}),
				s3Service: makeS3Layer({
					presignDownload: () => {
						signed += 1;
						return Effect.succeed("s3");
					},
				}),
			}),
		),
	);
});

it.effect("rejects a locator owned by another user before signing it", () => {
	let signed = false;
	return Effect.gen(function* () {
		const service = yield* UploadsService;
		const exit = yield* Effect.exit(
			service.resolveDownloads(user, [{ type: "s3", key: "permanent/other.png" }]),
		);
		assertExitFails(
			exit,
			new BadRequest({ message: "One or more managed assets do not belong to this user" }),
		);
		expect(signed).toBe(false);
	}).pipe(
		Effect.provide(
			makeUploadsLayer({
				uploadsRepository: makeUploadsRepositoryLayer({
					listByOwnerAndLocators: () => Effect.succeed([]),
				}),
				s3Service: makeS3Layer({
					presignDownload: () => {
						signed = true;
						return Effect.succeed("s3");
					},
				}),
			}),
		),
	);
});

it.effect("uses managed asset content type for restored local downloads", () => {
	let signedContentType: string | null = null;
	return Effect.gen(function* () {
		const service = yield* UploadsService;
		yield* service.resolveDownloads(user, [
			{ type: "local", key: `permanent/${"a".repeat(64)}_${"b".repeat(64)}.bin` },
		]);
		expect(signedContentType).toBe("application/octet-stream");
	}).pipe(
		Effect.provide(
			makeUploadsLayer({
				uploadsRepository: makeUploadsRepositoryLayer({
					listByOwnerAndLocators: (ownerUserId, [locator]) =>
						Effect.succeed(
							locator
								? [
										{
											size: 3,
											ownerUserId,
											key: locator.key,
											provider: locator.type,
											sha256: "b".repeat(64),
											contentType: "application/octet-stream",
											createdAt: new Date("2026-01-01T00:00:00.000Z"),
										},
									]
								: [],
						),
				}),
				localStorageService: makeLocalStorageLayer({
					createDownloadTarget: (_key, contentType) => {
						signedContentType = contentType;
						return Effect.succeed("local");
					},
				}),
			}),
		),
	);
});

it.effect("rejects a missing owned object instead of omitting it", () =>
	Effect.gen(function* () {
		const service = yield* UploadsService;
		const exit = yield* Effect.exit(
			service.resolveDownloads(user, [{ type: "local", key: "permanent/missing.png" }]),
		);
		assertExitFails(
			exit,
			new BadRequest({ message: "Local download object is missing or invalid" }),
		);
	}).pipe(
		Effect.provide(
			makeUploadsLayer({
				localStorageService: makeLocalStorageLayer({
					statObject: () => Effect.fail(new BadRequest({ message: "missing" })),
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
				fileName: "local.png",
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
				fileName: "s3.png",
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
				fileName: "duplicate.csv",
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
				fileName: "claimed.csv",
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
			'{"intentId":"intent-id","userId":"user-id","provider":"local","kind":"permanent","objectKey":"permanent/object.png","fileName":"object.png","contentType":"image/png","state":"pending","createdAt":1700000000,"expiresAt":4102444800}',
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
			kind: "temporary",
			provider: "local",
			contentType: "text/csv",
			fileName: "/exports/report.csv",
		});
		const intentKey = redisKeys.uploadIntent(intent.intentId);
		const completed = yield* service.completeUploadIntent(user, intent.intentId);
		if (!("token" in completed)) {
			throw new Error("Expected a temporary upload token");
		}
		const otherUser = { ...user, id: UserId.make("other-user") };
		const wrongUser = yield* Effect.exit(
			service.claimTemporaryUpload(completed.token, otherUser.id, "import-run-1"),
		);
		assertExitFails(
			wrongUser,
			new BadRequest({ message: "Upload token does not belong to this user" }),
		);
		const claimed = yield* service.claimTemporaryUpload(completed.token, user.id, "import-run-1");
		const replayed = yield* service.claimTemporaryUpload(completed.token, user.id, "import-run-1");
		const differentClaim = yield* Effect.exit(
			service.claimTemporaryUpload(completed.token, user.id, "import-run-2"),
		);
		expect(replayed).toEqual(claimed);
		assertExitFails(
			differentClaim,
			new BadRequest({ message: "Upload token was claimed by a different operation" }),
		);
		expect(claimed.fileName).toBe("report.csv");
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
				uploadsRepository: makeUploadsRepositoryLayer({
					registerPermanentOwnedObject: () => Effect.die("temporary upload must not register"),
				}),
				config: {
					fileStorage: {
						localDir: TEST_TMP_DIR,
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
		const claimed = yield* service.claimTemporaryUpload(completed.token, user.id, "import-run-1");
		expect(claimed.fileName).toBe("report.csv");
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
				fileName: `${intentId}.csv`,
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
			`{"intentId":"${intentId}","userId":"user-id","provider":"local","kind":"temporary","objectKey":"temporary/object.csv","fileName":"object.csv","contentType":"text/csv","state":"claimed","createdAt":1,"expiresAt":0,"claimedAt":1}`,
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
