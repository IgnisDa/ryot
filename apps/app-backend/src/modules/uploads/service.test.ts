import { expect, it } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { BadRequest } from "@ryot/contract/errors";
import { UserId } from "@ryot/contract/schema/brands";
import { Effect, FileSystem, Inspectable, Layer, Option, Path, Redacted } from "effect";
import { Multipart } from "effect/unstable/http";
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

const fakeFile = (name: string, contentType: string): Multipart.PersistedFile => ({
	name,
	key: name,
	contentType,
	toJSON: () => ({}),
	_tag: "PersistedFile",
	path: `/tmp/test-uploads/${name}`,
	[Multipart.TypeId]: Multipart.TypeId,
	toString: () => `PersistedFile(${name})`,
	[Inspectable.NodeInspectSymbol]: () => `PersistedFile(${name})`,
});

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
	"_tag" | "isConfigured"
> & { isConfigured?: Parameters<typeof mockLocalStorageService>[0]["isConfigured"] };

const makeLocalStorageLayer = (overrides: LocalStorageOverrides = {}) =>
	mockLocalStorageService({
		isConfigured: true,
		statObject: () => Effect.succeed(defaultFileInfo),
		resolveObjectPath: () => Effect.succeed("/tmp/object"),
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
			del: () => Effect.succeed(0),
			claim: () => Effect.succeed(true),
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
	const appConfig = makeAppConfigLayer({ ...options.config, tmpDir: TEST_TMP_DIR });
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

it.effect("writes supported files to temporary directory and returns tokens", () => {
	const writtenPaths: Array<{ path: string; bytes: Uint8Array }> = [];
	const storedTokens: Array<{ key: string; value: string; ttl: number | undefined }> = [];

	return Effect.gen(function* () {
		const service = yield* UploadsService;
		const files = [
			fakeFile("report.csv", "text/csv"),
			fakeFile("archive.zip", "application/zip"),
			fakeFile("payload.json", "application/json"),
		];
		const tokens = yield* service.uploadTemporary(user, files);
		expect(tokens).toHaveLength(3);
		expect(writtenPaths).toHaveLength(3);
		expect(storedTokens).toHaveLength(3);
	}).pipe(
		Effect.provide(
			makeUploadsLayer({
				redisService: makeRedisLayer({
					set: (_key, _value, _ttl) => {
						storedTokens.push({ key: _key, value: _value, ttl: _ttl });
						return Effect.void;
					},
				}),
				fsLayer: makeFsLayer({
					stat: () => Effect.succeed(defaultFileInfo),
					readFile: () => Effect.succeed(new Uint8Array([99, 115, 118])),
					writeFile: (path: string, bytes: Uint8Array) => {
						writtenPaths.push({ path, bytes });
						return Effect.void;
					},
				}),
			}),
		),
	);
});

it.effect("rejects unsupported temporary upload file types", () =>
	Effect.gen(function* () {
		const service = yield* UploadsService;
		const exit = yield* Effect.exit(
			service.uploadTemporary(user, [fakeFile("document.pdf", "application/pdf")]),
		);
		assertExitFails(
			exit,
			new BadRequest({ message: "Upload content type must be a supported MIME type" }),
		);
	}).pipe(Effect.provide(makeUploadsLayer())),
);
