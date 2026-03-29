import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { type BadRequest, badRequest } from "@ryot/contract/errors";
import type { UploadIntentInput } from "@ryot/contract/modules/uploads/schemas";
import {
	UPLOAD_MAX_FILE_BYTES,
	type UploadContentType,
	uploadContentTypeExtensions,
	uploadContentTypes,
} from "@ryot/contract/modules/uploads/upload-policy";
import { UserId } from "@ryot/contract/schema/brands";
import { generateId } from "better-auth";
import type { Stream } from "effect";
import { Clock, Context, DateTime, Effect, Layer, Schema, FileSystem } from "effect";
import type { Multipart } from "effect/unstable/http";

import { AppConfig } from "#lib/infrastructure/config/service";
import { LocalStorageService } from "#lib/infrastructure/local-storage";
import { RedisService, redisKeys } from "#lib/infrastructure/redis";
import { S3Service } from "#lib/infrastructure/s3";

const UPLOAD_TOKEN_TTL_SECONDS = 15 * 60;
const UPLOAD_URL_EXPIRY_SECONDS = 15 * 60;

const UploadIntentMetadata = Schema.Struct({
	userId: UserId,
	intentId: Schema.String,
	objectKey: Schema.String,
	createdAt: Schema.Finite,
	expiresAt: Schema.Finite,
	contentType: Schema.String,
	provider: Schema.Literals(["local", "s3"]),
	state: Schema.Literals(["pending", "completed"]),
	kind: Schema.Literals(["temporary", "permanent"]),
	completion: Schema.optional(
		Schema.Union([
			Schema.Struct({ key: Schema.String, type: Schema.Literal("local") }),
			Schema.Struct({ key: Schema.String, type: Schema.Literal("s3") }),
		]),
	),
});
type UploadIntentMetadata = typeof UploadIntentMetadata.Type;

const UploadTokenValue = Schema.Struct({ userId: UserId, resolvedPath: Schema.String });

const resolveExtension = (contentType: UploadContentType) =>
	uploadContentTypeExtensions[contentType][0];

const isUploadContentType = (value: string): value is UploadContentType =>
	(uploadContentTypes as readonly string[]).includes(value);

const resolveContentType = (contentType: string): Effect.Effect<UploadContentType, BadRequest> => {
	const normalized = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
	if (!normalized || !isUploadContentType(normalized)) {
		return Effect.fail(badRequest("Upload content type must be a supported MIME type"));
	}
	return Effect.succeed(normalized);
};

const resolveContentTypeFromFileName = (
	fileName: string,
): Effect.Effect<UploadContentType, BadRequest> => {
	const extension = fileName.split(".").pop()?.trim().toLowerCase() ?? "";
	const entry = Object.entries(uploadContentTypeExtensions).find(([, exts]) =>
		exts.includes(extension),
	);
	if (!entry || !isUploadContentType(entry[0])) {
		return Effect.fail(badRequest(`Unsupported file extension: .${extension}`));
	}
	return Effect.succeed(entry[0]);
};

const resolveTemporaryUploadContentType = (
	contentType: string,
	fileName: string,
): Effect.Effect<UploadContentType, BadRequest> => {
	const normalized = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
	if (!normalized || normalized === "application/octet-stream") {
		return resolveContentTypeFromFileName(fileName);
	}
	return resolveContentType(normalized);
};

const resolveIntentContentType = (contentType: string, fileName: string) => {
	const normalized = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
	return !normalized || normalized === "application/octet-stream"
		? resolveContentTypeFromFileName(fileName)
		: resolveContentType(normalized);
};

const resolveFileName = (name: string): Effect.Effect<string, BadRequest> => {
	const segments = name
		.replace(/[\\/]+$/, "")
		.split(/[\\/]/)
		.filter(Boolean);
	const fileName = segments[segments.length - 1];
	if (!fileName) {
		return Effect.fail(badRequest("Upload file name must not be empty"));
	}
	return Effect.succeed(fileName);
};

const resolveContentTypeFromKey = (key: string): Effect.Effect<UploadContentType, BadRequest> => {
	const extension = key.split(".").pop()?.toLowerCase() ?? "";
	const entry = Object.entries(uploadContentTypeExtensions).find(([, extensions]) =>
		extensions.includes(extension),
	);
	return entry && isUploadContentType(entry[0])
		? Effect.succeed(entry[0])
		: Effect.fail(badRequest("Local object key has an unsupported file extension"));
};

export class UploadsService extends Context.Service<UploadsService>()("UploadsService", {
	make: Effect.gen(function* () {
		const config = yield* AppConfig;
		const redis = yield* RedisService;
		const s3Service = yield* S3Service;
		const fs = yield* FileSystem.FileSystem;
		const localStorage = yield* LocalStorageService;

		const createUploadIntent = Effect.fn("UploadsService.createUploadIntent")(function* (
			user: CurrentUserValue,
			input: typeof UploadIntentInput.Type,
		) {
			if (input.kind !== "permanent") {
				return yield* badRequest("Only permanent upload intents are currently supported");
			}
			if (input.provider === "s3" && !s3Service.isConfigured) {
				return yield* badRequest(
					"S3 file storage is not configured. Set the FILE_STORAGE_S3_* settings.",
				);
			}
			if (input.provider === "local" && !localStorage.isConfigured) {
				return yield* badRequest(
					"Local file storage is not configured. Set FILE_STORAGE_LOCAL_DIR and FILE_STORAGE_LOCAL_SIGNING_SECRET.",
				);
			}
			const fileName = yield* resolveFileName(input.fileName);
			const contentType = yield* resolveIntentContentType(input.contentType, fileName);
			const intentId = generateId();
			const objectKey = `permanent/${generateId()}.${resolveExtension(contentType)}`;
			const now = Math.floor((yield* Clock.currentTimeMillis) / 1000);
			const expiresAt = now + UPLOAD_URL_EXPIRY_SECONDS;
			const target =
				input.provider === "local"
					? yield* localStorage.createUploadTarget(intentId, now)
					: {
							expiresAt,
							method: "PUT" as const,
							uploadUrl: yield* s3Service.presignUpload(
								objectKey,
								contentType,
								UPLOAD_URL_EXPIRY_SECONDS,
							),
						};
			const metadata = {
				intentId,
				objectKey,
				expiresAt,
				contentType,
				createdAt: now,
				userId: user.id,
				kind: input.kind,
				provider: input.provider,
				state: "pending" as const,
			};
			const encoded = yield* Schema.encodeUnknownEffect(
				Schema.fromJsonString(UploadIntentMetadata),
			)(metadata).pipe(Effect.orDie);
			yield* redis.setAndIndex(
				redisKeys.uploadIntent(intentId),
				encoded,
				redisKeys.uploadIntentExpiry,
				expiresAt,
				intentId,
			);
			return {
				intentId,
				method: target.method,
				uploadUrl: target.uploadUrl,
				headers: { "content-type": contentType },
				expiresAt: DateTime.formatIso(DateTime.makeUnsafe(expiresAt * 1000)),
			};
		});

		const getIntent = (intentId: string) =>
			redis
				.get(redisKeys.uploadIntent(intentId))
				.pipe(
					Effect.flatMap((raw) =>
						raw
							? Schema.decodeUnknownEffect(Schema.fromJsonString(UploadIntentMetadata))(raw).pipe(
									Effect.mapError(() => badRequest("Upload intent is invalid")),
								)
							: Effect.fail(badRequest("Upload intent is invalid or has expired")),
					),
				);

		const completeUploadIntent = Effect.fn("UploadsService.completeUploadIntent")(function* (
			user: CurrentUserValue,
			intentId: string,
		) {
			const lockKey = redisKeys.uploadIntentLock(intentId);
			if (!(yield* redis.claim(lockKey, 60))) {
				return yield* badRequest("Upload intent is currently being processed");
			}
			return yield* Effect.gen(function* () {
				const metadata = yield* getIntent(intentId);
				if (metadata.userId !== user.id) {
					return yield* badRequest("Upload intent does not belong to this user");
				}
				if (metadata.state === "completed" && metadata.completion) {
					return metadata.completion;
				}
				if (metadata.expiresAt < Math.floor((yield* Clock.currentTimeMillis) / 1000)) {
					return yield* badRequest("Upload intent is invalid or has expired");
				}
				const info =
					metadata.provider === "local"
						? yield* localStorage
								.statObject(metadata.objectKey)
								.pipe(Effect.mapError(() => badRequest("Upload object is missing or invalid")))
						: yield* s3Service
								.statObject(metadata.objectKey)
								.pipe(Effect.mapError(() => badRequest("Upload object is missing or invalid")));
				if (Number(info.size) > UPLOAD_MAX_FILE_BYTES) {
					return yield* badRequest(
						`Upload exceeds maximum allowed size of ${UPLOAD_MAX_FILE_BYTES} bytes`,
					);
				}
				if (
					metadata.provider === "s3" &&
					info.type.split(";", 1)[0]?.trim().toLowerCase() !== metadata.contentType
				) {
					return yield* badRequest("Upload content type does not match the upload intent");
				}
				const completion = { type: metadata.provider, key: metadata.objectKey };
				const completed = { ...metadata, state: "completed" as const, completion };
				const encoded = yield* Schema.encodeUnknownEffect(
					Schema.fromJsonString(UploadIntentMetadata),
				)(completed).pipe(Effect.orDie);
				yield* redis.setAndRemoveFromIndex(
					redisKeys.uploadIntent(intentId),
					encoded,
					redisKeys.uploadIntentExpiry,
					intentId,
				);
				return completion;
			}).pipe(Effect.ensuring(redis.del(lockKey)));
		});

		const putLocalIntent = Effect.fn("UploadsService.putLocalIntent")(function* (
			intentId: string,
			method: string,
			url: string,
			contentType: string | undefined,
			contentLength: string | undefined,
			stream: Stream.Stream<Uint8Array, unknown>,
		) {
			yield* localStorage.verifyUploadTarget(
				method,
				url,
				Math.floor((yield* Clock.currentTimeMillis) / 1000),
			);
			const raw = yield* redis.get(redisKeys.uploadIntent(intentId));
			if (!raw) {
				return;
			}
			const metadata = yield* Schema.decodeUnknownEffect(
				Schema.fromJsonString(UploadIntentMetadata),
			)(raw).pipe(Effect.mapError(() => badRequest("Upload intent is invalid")));
			if (metadata.state === "completed") {
				return;
			}
			if (metadata.provider !== "local") {
				return yield* badRequest("Upload intent does not target local storage");
			}
			if (
				metadata.state !== "pending" ||
				metadata.expiresAt < Math.floor((yield* Clock.currentTimeMillis) / 1000)
			) {
				return yield* badRequest("Upload intent is invalid or has expired");
			}
			const normalizedContentType = contentType?.split(";")[0]?.trim().toLowerCase();
			if (normalizedContentType !== metadata.contentType) {
				return yield* badRequest("Upload content type does not match the upload intent");
			}
			yield* localStorage
				.writeObject(metadata.objectKey, stream, contentLength)
				.pipe(
					Effect.mapError((error) =>
						error instanceof Error ? badRequest(error.message) : badRequest("Local upload failed"),
					),
				);
		});

		const removeUploadIntent = Effect.fn("UploadsService.removeUploadIntent")(function* (
			intentId: string,
		) {
			const raw = yield* redis.get(redisKeys.uploadIntent(intentId));
			if (!raw) {
				yield* redis.zrem(redisKeys.uploadIntentExpiry, intentId);
				return;
			}
			const metadata = yield* Schema.decodeUnknownEffect(
				Schema.fromJsonString(UploadIntentMetadata),
			)(raw).pipe(Effect.mapError(() => badRequest("Upload intent is invalid")));
			yield* metadata.provider === "local"
				? localStorage.deleteObject(metadata.objectKey)
				: s3Service.deleteObject(metadata.objectKey);
			yield* redis.del(redisKeys.uploadIntent(intentId));
			yield* redis.zrem(redisKeys.uploadIntentExpiry, intentId);
		});

		const resolveDownloads = Effect.fn("UploadsService.resolveDownloads")(function* (
			_user: CurrentUserValue,
			assets: ReadonlyArray<{ key: string; type: "local" | "s3" }>,
		) {
			const now = Math.floor((yield* Clock.currentTimeMillis) / 1000);
			return yield* Effect.forEach(assets, (asset) =>
				Effect.gen(function* () {
					const downloadUrl =
						asset.type === "local"
							? yield* Effect.gen(function* () {
									yield* localStorage
										.statObject(asset.key)
										.pipe(
											Effect.mapError(() =>
												badRequest("Local download object is missing or invalid"),
											),
										);
									return yield* localStorage
										.createDownloadTarget(
											asset.key,
											yield* resolveContentTypeFromKey(asset.key),
											now,
										)
										.pipe(
											Effect.mapError(() =>
												badRequest("Local download object is missing or invalid"),
											),
										);
								})
							: yield* s3Service.presignDownload(asset.key, UPLOAD_URL_EXPIRY_SECONDS);
					return { asset, downloadUrl };
				}),
			);
		});

		const resolveLocalDownload = Effect.fn("UploadsService.resolveLocalDownload")(function* (
			method: string,
			url: string,
		) {
			const target = yield* localStorage.verifyDownloadTarget(
				method,
				url,
				Math.floor((yield* Clock.currentTimeMillis) / 1000),
			);
			const path = yield* localStorage
				.resolveObjectPath(target.key)
				.pipe(Effect.mapError(() => badRequest("Local download object is missing or invalid")));
			const info = yield* localStorage
				.statObject(target.key)
				.pipe(Effect.mapError(() => badRequest("Local download object is missing or invalid")));
			return { contentType: target.contentType, path, size: Number(info.size) };
		});

		const cleanupPendingIntents = Effect.fn("UploadsService.cleanupPendingIntents")(function* (
			max: number,
		) {
			const now = Math.floor((yield* Clock.currentTimeMillis) / 1000);
			const intentIds = yield* redis.zrangeByScore(redisKeys.uploadIntentExpiry, now, max);
			yield* Effect.forEach(intentIds, (intentId) =>
				Effect.gen(function* () {
					const raw = yield* redis.get(redisKeys.uploadIntent(intentId));
					if (!raw) {
						yield* redis.zrem(redisKeys.uploadIntentExpiry, intentId);
						return;
					}
					const metadata = yield* Schema.decodeUnknownEffect(
						Schema.fromJsonString(UploadIntentMetadata),
					)(raw).pipe(Effect.mapError(() => badRequest("Upload intent is invalid")));
					if (metadata.state !== "pending" || metadata.expiresAt > now) {
						yield* redis.zrem(redisKeys.uploadIntentExpiry, intentId);
						return;
					}
					if (!(yield* redis.claim(redisKeys.uploadIntentLock(intentId), 60))) {
						return;
					}
					yield* removeUploadIntent(intentId).pipe(
						Effect.ensuring(redis.del(redisKeys.uploadIntentLock(intentId))),
					);
				}).pipe(
					Effect.catchCause((cause) =>
						Effect.logWarning("upload intent cleanup failed", cause).pipe(
							Effect.annotateLogs({ intentId }),
						),
					),
				),
			);
		});

		const uploadTemporary = Effect.fn("UploadsService.uploadTemporary")(function* (
			user: CurrentUserValue,
			files: ReadonlyArray<Multipart.PersistedFile>,
		) {
			if (files.length === 0) {
				return yield* badRequest("At least one upload file is required");
			}

			const tempDir = config.tmpDir;
			const resolvedFiles = yield* Effect.forEach(files, (file) =>
				Effect.gen(function* () {
					const fileName = yield* resolveFileName(file.name);
					yield* resolveTemporaryUploadContentType(file.contentType, fileName);

					const info = yield* fs.stat(file.path).pipe(Effect.orDie);
					if (Number(info.size) > UPLOAD_MAX_FILE_BYTES) {
						return yield* badRequest(
							`Upload file exceeds maximum allowed size of ${UPLOAD_MAX_FILE_BYTES} bytes (file is ${info.size} bytes)`,
						);
					}

					const id = generateId();
					const destPath = `${tempDir.replace(/[\\/]+$/, "")}/${id}-${fileName}`;

					const bytes = yield* fs.readFile(file.path).pipe(Effect.orDie);
					yield* fs.writeFile(destPath, bytes).pipe(Effect.orDie);

					return { id, destPath };
				}),
			);

			const tokens = yield* Effect.forEach(resolvedFiles, ({ id, destPath }) =>
				Effect.gen(function* () {
					const encoded = yield* Schema.encodeUnknownEffect(
						Schema.fromJsonString(UploadTokenValue),
					)({
						userId: user.id,
						resolvedPath: destPath,
					}).pipe(Effect.orDie);
					const key = redisKeys.uploadToken(id);
					yield* redis.set(key, encoded, UPLOAD_TOKEN_TTL_SECONDS);
					return id;
				}),
			);

			return tokens;
		});

		const claimUploadToken = Effect.fn("UploadsService.claimUploadToken")(function* (
			token: string,
			userId: UserId,
		) {
			const raw = yield* redis.getdel(redisKeys.uploadToken(token));
			if (!raw) {
				return yield* badRequest("Upload token is invalid or has expired");
			}
			const value = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(UploadTokenValue))(
				raw,
			).pipe(Effect.mapError(() => badRequest("Upload token is invalid or has expired")));
			if (value.userId !== userId) {
				return yield* badRequest("Upload token does not belong to this user");
			}
			return { resolvedPath: value.resolvedPath };
		});

		return {
			putLocalIntent,
			uploadTemporary,
			resolveDownloads,
			claimUploadToken,
			removeUploadIntent,
			createUploadIntent,
			completeUploadIntent,
			resolveLocalDownload,
			cleanupPendingIntents,
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
