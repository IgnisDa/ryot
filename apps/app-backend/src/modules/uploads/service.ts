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
import { Clock, Context, DateTime, Effect, FileSystem, Layer, Schema, Stream } from "effect";
import type { Multipart } from "effect/unstable/http";

import { AppConfig } from "#lib/infrastructure/config/service";
import { LocalStorageService } from "#lib/infrastructure/local-storage";
import { RedisService, redisKeys } from "#lib/infrastructure/redis";
import { S3Service } from "#lib/infrastructure/s3";

const UPLOAD_TOKEN_TTL_SECONDS = 15 * 60;
const UPLOAD_URL_EXPIRY_SECONDS = 15 * 60;
const PROCESSING_LEASE_SECONDS = 24 * 60 * 60;
const CLEANUP_LEASE_SECONDS = 60;

const UploadIntentMetadata = Schema.Struct({
	userId: UserId,
	intentId: Schema.String,
	objectKey: Schema.String,
	createdAt: Schema.Finite,
	expiresAt: Schema.Finite,
	contentType: Schema.String,
	claimedAt: Schema.optional(Schema.Finite),
	cleaningAt: Schema.optional(Schema.Finite),
	provider: Schema.Literals(["local", "s3"]),
	kind: Schema.Literals(["temporary", "permanent"]),
	state: Schema.Literals(["pending", "completed", "claimed", "cleaning"]),
	completion: Schema.optional(
		Schema.Union([
			Schema.Struct({ expiresAt: Schema.Finite, token: Schema.String }),
			Schema.Struct({ key: Schema.String, type: Schema.Literal("s3") }),
			Schema.Struct({ key: Schema.String, type: Schema.Literal("local") }),
		]),
	),
});
type UploadIntentMetadata = typeof UploadIntentMetadata.Type;

const UploadTokenValue = Schema.Struct({ intentId: Schema.String, userId: UserId });
const LegacyUploadTokenValue = Schema.Struct({ userId: UserId, resolvedPath: Schema.String });

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
			if (input.kind === "temporary" && input.provider !== "local") {
				return yield* badRequest("Temporary upload intents currently support local storage only");
			}
			if (input.provider === "s3" && !s3Service.isConfigured) {
				return yield* badRequest(
					"S3 file storage is not configured. Set the FILE_STORAGE_S3_* settings.",
				);
			}
			if (input.provider === "local" && !localStorage.isConfiguredForKind(input.kind)) {
				return yield* badRequest(
					input.kind === "temporary"
						? "Local temporary storage is not configured. Set FILE_STORAGE_LOCAL_TEMP_DIR and FILE_STORAGE_LOCAL_SIGNING_SECRET."
						: "Local permanent storage is not configured. Set FILE_STORAGE_LOCAL_DIR and FILE_STORAGE_LOCAL_SIGNING_SECRET.",
				);
			}
			const fileName = yield* resolveFileName(input.fileName);
			const contentType = yield* resolveIntentContentType(input.contentType, fileName);
			const intentId = generateId();
			const objectKey = `${input.kind}/${generateId()}.${resolveExtension(contentType)}`;
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
			const lease = yield* redis.acquireLease(lockKey, UPLOAD_URL_EXPIRY_SECONDS);
			if (lease === null) {
				return yield* badRequest("Upload intent is currently being processed");
			}
			return yield* Effect.gen(function* () {
				const metadata = yield* getIntent(intentId);
				if (metadata.userId !== user.id) {
					return yield* badRequest("Upload intent does not belong to this user");
				}
				if (metadata.state !== "pending" && metadata.completion) {
					return "token" in metadata.completion
						? {
								token: metadata.completion.token,
								expiresAt: DateTime.formatIso(
									DateTime.makeUnsafe(metadata.completion.expiresAt * 1000),
								),
							}
						: metadata.completion;
				}
				const now = Math.floor((yield* Clock.currentTimeMillis) / 1000);
				if (metadata.expiresAt <= now) {
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
				const completion =
					metadata.kind === "temporary"
						? {
								token: generateId(),
								expiresAt: DateTime.formatIso(
									DateTime.makeUnsafe((now + UPLOAD_TOKEN_TTL_SECONDS) * 1000),
								),
							}
						: { type: metadata.provider, key: metadata.objectKey };
				const storedCompletion =
					metadata.kind === "temporary"
						? { expiresAt: now + UPLOAD_TOKEN_TTL_SECONDS, token: completion.token }
						: completion;
				const completed = {
					...metadata,
					state: "completed" as const,
					completion: storedCompletion,
					expiresAt:
						metadata.kind === "temporary" ? now + UPLOAD_TOKEN_TTL_SECONDS : metadata.expiresAt,
				};
				const encoded = yield* Schema.encodeUnknownEffect(
					Schema.fromJsonString(UploadIntentMetadata),
				)(completed).pipe(Effect.orDie);
				if (metadata.kind === "temporary") {
					const completionToken = "token" in completion ? completion.token : "";
					const tokenValue = yield* Schema.encodeUnknownEffect(
						Schema.fromJsonString(UploadTokenValue),
					)({ intentId, userId: user.id }).pipe(Effect.orDie);
					yield* redis.setAndIndexAndSet(
						redisKeys.uploadIntent(intentId),
						encoded,
						redisKeys.uploadIntentExpiry,
						completed.expiresAt,
						intentId,
						redisKeys.uploadToken(completionToken),
						tokenValue,
						UPLOAD_TOKEN_TTL_SECONDS,
					);
				} else {
					yield* redis.setAndRemoveFromIndex(
						redisKeys.uploadIntent(intentId),
						encoded,
						redisKeys.uploadIntentExpiry,
						intentId,
					);
				}
				return completion;
			}).pipe(Effect.ensuring(redis.releaseLease(lockKey, lease)));
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
			const lockKey = redisKeys.uploadIntentLock(intentId);
			const lease = yield* redis.acquireLease(lockKey, UPLOAD_URL_EXPIRY_SECONDS);
			if (lease === null) {
				return yield* badRequest("Upload intent is currently being processed");
			}
			return yield* Effect.gen(function* () {
				const raw = yield* redis.get(redisKeys.uploadIntent(intentId));
				if (!raw) {
					return yield* badRequest("Upload intent is invalid or has expired");
				}
				const metadata = yield* Schema.decodeUnknownEffect(
					Schema.fromJsonString(UploadIntentMetadata),
				)(raw).pipe(Effect.mapError(() => badRequest("Upload intent is invalid")));
				if (metadata.state !== "pending") {
					return yield* badRequest("Upload intent is invalid or has expired");
				}
				if (metadata.provider !== "local") {
					return yield* badRequest("Upload intent does not target local storage");
				}
				if (metadata.expiresAt <= Math.floor((yield* Clock.currentTimeMillis) / 1000)) {
					return yield* badRequest("Upload intent is invalid or has expired");
				}
				const normalizedContentType = contentType?.split(";")[0]?.trim().toLowerCase();
				if (normalizedContentType !== metadata.contentType) {
					return yield* badRequest("Upload content type does not match the upload intent");
				}
				const renewedStream = stream.pipe(
					Stream.mapEffect((chunk) =>
						redis
							.renewLease(lockKey, lease, UPLOAD_URL_EXPIRY_SECONDS)
							.pipe(
								Effect.flatMap((renewed) =>
									renewed
										? Effect.succeed(chunk)
										: Effect.fail(badRequest("Upload intent is no longer active")),
								),
							),
					),
				);
				yield* localStorage
					.writeObject(metadata.objectKey, renewedStream, contentLength)
					.pipe(
						Effect.mapError((error) =>
							error instanceof Error
								? badRequest(error.message)
								: badRequest("Local upload failed"),
						),
					);
			}).pipe(Effect.ensuring(redis.releaseLease(lockKey, lease)));
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
			if (metadata.completion && "token" in metadata.completion) {
				yield* redis.del(redisKeys.uploadToken(metadata.completion.token));
			}
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
					const cleanupLock = redisKeys.uploadIntentCleanupLock(intentId);
					const cleanupLease = yield* redis.acquireLease(cleanupLock, CLEANUP_LEASE_SECONDS);
					if (cleanupLease === null) {
						return;
					}
					const intentLock = redisKeys.uploadIntentLock(intentId);
					const intentLease = yield* redis.acquireLease(intentLock, CLEANUP_LEASE_SECONDS);
					if (intentLease === null) {
						yield* redis.releaseLease(cleanupLock, cleanupLease);
						return;
					}
					return yield* Effect.gen(function* () {
						const raw = yield* redis.get(redisKeys.uploadIntent(intentId));
						if (!raw) {
							yield* redis.zrem(redisKeys.uploadIntentExpiry, intentId);
							return;
						}
						const metadata = yield* Schema.decodeUnknownEffect(
							Schema.fromJsonString(UploadIntentMetadata),
						)(raw).pipe(Effect.mapError(() => badRequest("Upload intent is invalid")));
						if (
							!(["pending", "completed", "claimed", "cleaning"] as const).includes(
								metadata.state,
							) ||
							metadata.expiresAt > now
						) {
							yield* redis.zrem(redisKeys.uploadIntentExpiry, intentId);
							return;
						}
						const cleaning = { ...metadata, state: "cleaning" as const, cleaningAt: now };
						const cleaningEncoded = yield* Schema.encodeUnknownEffect(
							Schema.fromJsonString(UploadIntentMetadata),
						)(cleaning).pipe(Effect.orDie);
						yield* redis.setAndIndex(
							redisKeys.uploadIntent(intentId),
							cleaningEncoded,
							redisKeys.uploadIntentExpiry,
							now,
							intentId,
						);
						yield* removeUploadIntent(intentId).pipe(
							Effect.catchCause((cause) =>
								Schema.encodeUnknownEffect(Schema.fromJsonString(UploadIntentMetadata))(
									metadata,
								).pipe(
									Effect.orDie,
									Effect.flatMap((encoded) =>
										redis.setAndIndex(
											redisKeys.uploadIntent(intentId),
											encoded,
											redisKeys.uploadIntentExpiry,
											now + CLEANUP_LEASE_SECONDS,
											intentId,
										),
									),
									Effect.andThen(Effect.failCause(cause)),
								),
							),
						);
					}).pipe(
						Effect.ensuring(redis.releaseLease(intentLock, intentLease)),
						Effect.ensuring(redis.releaseLease(cleanupLock, cleanupLease)),
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

		const claimTemporaryUpload = Effect.fn("UploadsService.claimTemporaryUpload")(function* (
			token: string,
			userId: UserId,
		) {
			const rawToken = yield* redis.get(redisKeys.uploadToken(token));
			if (!rawToken) {
				return yield* badRequest("Upload token is invalid or has expired");
			}
			const tokenValue = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(UploadTokenValue))(
				rawToken,
			).pipe(Effect.mapError(() => badRequest("Upload token is invalid or has expired")));
			if (tokenValue.userId !== userId) {
				return yield* badRequest("Upload token does not belong to this user");
			}
			const lockKey = redisKeys.uploadIntentLock(tokenValue.intentId);
			const lease = yield* redis.acquireLease(lockKey, CLEANUP_LEASE_SECONDS);
			if (lease === null) {
				return yield* badRequest("Upload token is currently being processed");
			}
			return yield* Effect.gen(function* () {
				const metadata = yield* getIntent(tokenValue.intentId);
				const now = Math.floor((yield* Clock.currentTimeMillis) / 1000);
				if (
					metadata.userId !== userId ||
					metadata.provider !== "local" ||
					metadata.kind !== "temporary" ||
					metadata.state !== "completed" ||
					metadata.expiresAt <= now ||
					!metadata.completion ||
					!("token" in metadata.completion) ||
					metadata.completion.token !== token
				) {
					return yield* badRequest("Upload token is invalid or has expired");
				}
				const resolvedPath = yield* localStorage
					.resolveObjectPath(metadata.objectKey)
					.pipe(Effect.mapError(() => badRequest("Upload object is missing or invalid")));
				const leaseExpiresAt = now + PROCESSING_LEASE_SECONDS;
				const claimed = {
					...metadata,
					expiresAt: leaseExpiresAt,
					state: "claimed" as const,
					claimedAt: now,
				};
				const encoded = yield* Schema.encodeUnknownEffect(
					Schema.fromJsonString(UploadIntentMetadata),
				)(claimed).pipe(Effect.orDie);
				yield* redis.setAndIndexAndDelete(
					redisKeys.uploadIntent(tokenValue.intentId),
					encoded,
					redisKeys.uploadIntentExpiry,
					leaseExpiresAt,
					tokenValue.intentId,
					redisKeys.uploadToken(token),
				);
				return {
					resolvedPath,
					intentId: tokenValue.intentId,
					leaseExpiresAt: DateTime.formatIso(DateTime.makeUnsafe(leaseExpiresAt * 1000)),
					locator: { type: "local" as const, key: metadata.objectKey },
				};
			}).pipe(Effect.ensuring(redis.releaseLease(lockKey, lease)));
		});

		const deleteTemporaryUpload = Effect.fn("UploadsService.deleteTemporaryUpload")(function* (
			intentId: string,
		) {
			const lockKey = redisKeys.uploadIntentLock(intentId);
			const lease = yield* redis.acquireLease(lockKey, CLEANUP_LEASE_SECONDS);
			if (lease === null) {
				return yield* badRequest("Upload is currently being processed");
			}
			yield* removeUploadIntent(intentId).pipe(Effect.ensuring(redis.releaseLease(lockKey, lease)));
		});

		const uploadTemporary = Effect.fn("UploadsService.uploadTemporary")(function* (
			user: CurrentUserValue,
			files: ReadonlyArray<Multipart.PersistedFile>,
		) {
			if (files.length === 0) {
				return yield* badRequest("At least one upload file is required");
			}

			const tempDir = config.fileStorage.localTempDir;
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
						Schema.fromJsonString(LegacyUploadTokenValue),
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
			const value = yield* Schema.decodeUnknownEffect(
				Schema.fromJsonString(LegacyUploadTokenValue),
			)(raw).pipe(Effect.mapError(() => badRequest("Upload token is invalid or has expired")));
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
			claimTemporaryUpload,
			deleteTemporaryUpload,
			cleanupPendingIntents,
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
