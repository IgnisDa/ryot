import { FileSystem, Multipart } from "@effect/platform";
import { it, expect } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { BadRequest } from "@ryot/contract/errors";
import { UserId } from "@ryot/contract/schema/brands";
import { Cause, Effect, Exit, Inspectable, Layer, Option } from "effect";
import Redis from "ioredis";

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

type S3Overrides = Omit<Parameters<typeof mockS3Service>[0], "_tag" | "isConfigured"> & {
	isConfigured?: Parameters<typeof mockS3Service>[0]["isConfigured"];
};

const makeS3Layer = (overrides: S3Overrides = {}) =>
	mockS3Service({ _tag: "S3Service", isConfigured: true, ...overrides });

const makeRedisClient = (): RedisService["client"] =>
	Object.assign(Object.create(Redis.prototype), {
		duplicate: makeRedisClient,
	});

const makeRedisLayer = (overrides: Partial<RedisService> = {}) =>
	Layer.succeed(RedisService, makeRedisService({ client: makeRedisClient(), ...overrides }));

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
		redisService?: ReturnType<typeof makeRedisLayer>;
		s3Service?: ReturnType<typeof makeS3Layer>;
	} = {},
) =>
	UploadsService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				makeAppConfigLayer({ tmpDir: TEST_TMP_DIR }),
				options.s3Service ?? makeS3Layer(),
				options.redisService ?? makeRedisLayer(),
				options.fsLayer ?? makeFsLayer(),
			),
		),
	);

it.effect("rejects unsupported content types for presigned upload", () =>
	Effect.gen(function* () {
		const service = yield* UploadsService;
		const exit = yield* Effect.exit(service.createPresignedUpload(user, "application/pdf"));
		assertExitFails(
			exit,
			new BadRequest({ message: "Upload content type must be a supported MIME type" }),
		);
	}).pipe(Effect.provide(makeUploadsLayer())),
);

it.effect("generates presigned upload key with png extension", () =>
	Effect.gen(function* () {
		const service = yield* UploadsService;
		const result = yield* service.createPresignedUpload(user, "image/png");
		expect(result.key).toMatch(/^uploads\/.+\.png$/);
		expect(result.uploadUrl).toBeTruthy();
	}).pipe(
		Effect.provide(
			makeUploadsLayer({
				s3Service: makeS3Layer({
					presignUpload: (_key: string) => Effect.succeed(`https://example.com/${_key}`),
				}),
			}),
		),
	),
);

it.effect("uses mime-based extension for jpeg presigned upload", () =>
	Effect.gen(function* () {
		const service = yield* UploadsService;
		const result = yield* service.createPresignedUpload(user, "image/jpeg");
		expect(result.key).toMatch(/^uploads\/.+\.jpg$/);
	}).pipe(
		Effect.provide(
			makeUploadsLayer({
				s3Service: makeS3Layer({
					presignUpload: (_key: string) => Effect.succeed(`https://example.com/${_key}`),
				}),
			}),
		),
	),
);

it.effect("uses mime-based extensions for csv, zip, and json presigned uploads", () =>
	Effect.gen(function* () {
		const service = yield* UploadsService;
		yield* Effect.forEach(
			[
				["text/csv", "csv"] as const,
				["application/zip", "zip"] as const,
				["application/json", "json"] as const,
			],
			([contentType, ext]) =>
				Effect.gen(function* () {
					const r = yield* service.createPresignedUpload(user, contentType);
					expect(r.key).toMatch(new RegExp(`^uploads/.+\\.${ext}$`));
					expect(r.uploadUrl).toBeTruthy();
				}),
		);
	}).pipe(
		Effect.provide(
			makeUploadsLayer({
				s3Service: makeS3Layer({
					presignUpload: (_key: string) => Effect.succeed(`https://example.com/${_key}`),
				}),
			}),
		),
	),
);

it.effect("dies when S3 is not configured for presigned upload", () =>
	Effect.gen(function* () {
		const service = yield* UploadsService;
		const exit = yield* Effect.exit(service.createPresignedUpload(user, "image/png"));
		if (Exit.isFailure(exit)) {
			expect(exit.cause._tag).toBe("Die");
		} else {
			throw new Error("Expected failure");
		}
	}).pipe(Effect.provide(makeUploadsLayer({ s3Service: makeS3Layer({ isConfigured: false }) }))),
);

it.effect("returns presigned download URLs for multiple keys", () =>
	Effect.gen(function* () {
		const service = yield* UploadsService;
		const keys = ["uploads/image_123.png", "uploads/image_456.jpg"];
		const result = yield* service.createPresignedDownload(user, keys);
		expect(result).toHaveLength(2);
		expect(result[0]?.key).toBe("uploads/image_123.png");
		expect(result[0]?.downloadUrl).toBeTruthy();
		expect(result[1]?.key).toBe("uploads/image_456.jpg");
		expect(result[1]?.downloadUrl).toBeTruthy();
	}).pipe(
		Effect.provide(
			makeUploadsLayer({
				s3Service: makeS3Layer({
					presignDownload: (_key: string) => Effect.succeed(`https://example.com/${_key}`),
				}),
			}),
		),
	),
);

it.effect("dies when S3 is not configured for presigned download", () =>
	Effect.gen(function* () {
		const service = yield* UploadsService;
		const exit = yield* Effect.exit(service.createPresignedDownload(user, ["uploads/image.png"]));
		if (Exit.isFailure(exit)) {
			expect(exit.cause._tag).toBe("Die");
		} else {
			throw new Error("Expected failure");
		}
	}).pipe(Effect.provide(makeUploadsLayer({ s3Service: makeS3Layer({ isConfigured: false }) }))),
);

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
		tokens.forEach((t) => expect(typeof t).toBe("string"));

		expect(writtenPaths).toHaveLength(3);
		writtenPaths.forEach((w) =>
			expect(w.path).toMatch(
				/^\/tmp\/ryot-test-uploads\/.+-(report\.csv|archive\.zip|payload\.json)$/,
			),
		);

		expect(storedTokens).toHaveLength(3);
		storedTokens.forEach((t, i) => {
			expect(t.key).toBe(redisKeys.uploadToken(tokens[i] ?? ""));
			const decoded = JSON.parse(t.value);
			expect(decoded.userId).toBe("user-id");
			expect(decoded.resolvedPath).toBe(writtenPaths[i]?.path);
			expect(t.ttl).toBe(900);
		});
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
					writeFile: (_path: string, _bytes: Uint8Array) => {
						writtenPaths.push({ path: _path, bytes: _bytes });
						return Effect.void;
					},
				}),
			}),
		),
	);
});

it.effect("strips trailing separators from file names", () => {
	const writtenPaths: string[] = [];

	return Effect.gen(function* () {
		const service = yield* UploadsService;
		const tokens = yield* service.uploadTemporary(user, [
			fakeFile("folder/report.csv/", "text/csv"),
		]);
		expect(tokens).toHaveLength(1);
		expect(writtenPaths[0]).toMatch(/\/tmp\/ryot-test-uploads\/.+?-report\.csv$/);
	}).pipe(
		Effect.provide(
			makeUploadsLayer({
				redisService: makeRedisLayer({ set: () => Effect.void }),
				fsLayer: makeFsLayer({
					stat: () => Effect.succeed(defaultFileInfo),
					readFile: () => Effect.succeed(new Uint8Array()),
					writeFile: (path: string) => {
						writtenPaths.push(path);
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

it.effect("rejects oversized temporary upload files", () => {
	const oversizedStat = { ...defaultFileInfo, size: FileSystem.Size(60 * 1024 * 1024) };
	return Effect.gen(function* () {
		const service = yield* UploadsService;
		const exit = yield* Effect.exit(
			service.uploadTemporary(user, [fakeFile("report.csv", "text/csv")]),
		);
		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isFailure(exit)) {
			const failure = Cause.failureOption(exit.cause);
			expect(Option.isSome(failure)).toBe(true);
			if (Option.isSome(failure)) {
				expect(failure.value).toBeInstanceOf(BadRequest);
				expect(failure.value.message).toMatch(/exceeds maximum allowed size/);
			}
		}
	}).pipe(
		Effect.provide(
			makeUploadsLayer({
				fsLayer: makeFsLayer({
					stat: () => Effect.succeed(oversizedStat),
				}),
			}),
		),
	);
});

it.effect("rejects empty temporary upload requests", () =>
	Effect.gen(function* () {
		const service = yield* UploadsService;
		const exit = yield* Effect.exit(service.uploadTemporary(user, []));
		assertExitFails(exit, new BadRequest({ message: "At least one upload file is required" }));
	}).pipe(Effect.provide(makeUploadsLayer())),
);
