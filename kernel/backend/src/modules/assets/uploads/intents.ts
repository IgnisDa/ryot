import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import {
	ManagedAssetLocator,
	UploadBadRequest,
	type UploadFailureReason,
	type UploadIntentInput,
	UploadProvider,
} from "@ryot-app/contract/modules/assets/schemas";
import {
	type UploadContentType,
	uploadContentTypeExtensions,
	uploadContentTypes,
	uploadMaxBytes,
} from "@ryot-app/contract/modules/assets/upload-policy";
import { UserId } from "@ryot-app/contract/schema/brands";
import { generateId } from "better-auth";
import { CryptoHasher } from "bun";
import { Clock, Context, DateTime, Effect, Layer, Schema, Stream } from "effect";

import { redisKeys, RedisService } from "#platform/redis";
import { LocalStorageService } from "#platform/storage/local-storage";
import { S3Service } from "#platform/storage/s3";

import { ManagedAssetsService } from "../storage/managed-assets";
import { ObjectStorageService } from "../storage/object-storage";

const UPLOAD_TOKEN_TTL_SECONDS = 15 * 60;
const UPLOAD_URL_EXPIRY_SECONDS = 15 * 60;
const PROCESSING_LEASE_SECONDS = 24 * 60 * 60;
const CLEANUP_LEASE_SECONDS = 60;

const uploadError = (reason: UploadFailureReason) => new UploadBadRequest({ reason });

const intentFields = {
	userId: UserId,
	intentId: Schema.String,
	fileName: Schema.String,
	createdAt: Schema.Finite,
	contentType: Schema.String,
};
const temporaryFields = {
	...intentFields,
	objectKey: Schema.String,
	kind: Schema.Literal("temporary"),
	provider: Schema.Literal("local"),
};
const TemporaryCompletion = Schema.Struct({ token: Schema.String, expiresAt: Schema.Finite });
const UploadIntentMetadata = Schema.Union([
	Schema.Struct({ ...temporaryFields, expiresAt: Schema.Finite, state: Schema.Literal("pending") }),
	Schema.Struct({
		...intentFields,
		provider: UploadProvider,
		objectKey: Schema.String,
		expiresAt: Schema.Finite,
		state: Schema.Literal("pending"),
		kind: Schema.Literal("permanent"),
	}),
	Schema.Struct({
		...temporaryFields,
		completion: TemporaryCompletion,
		state: Schema.Literal("completed"),
	}),
	Schema.Struct({
		...intentFields,
		completion: ManagedAssetLocator,
		kind: Schema.Literal("permanent"),
		state: Schema.Literal("completed"),
	}),
	Schema.Struct({
		...temporaryFields,
		claimId: Schema.String,
		claimedAt: Schema.Finite,
		leaseExpiresAt: Schema.Finite,
		completion: TemporaryCompletion,
		state: Schema.Literal("claimed"),
	}),
]);
const IntentJson = Schema.fromJsonString(UploadIntentMetadata);
const decodeIntent = Schema.decodeEffect(IntentJson, { onExcessProperty: "error" });
const encodeIntent = Schema.encodeEffect(IntentJson);

const intentDeadline = (metadata: typeof UploadIntentMetadata.Type) => {
	switch (metadata.state) {
		case "pending":
			return metadata.expiresAt;
		case "claimed":
			return metadata.leaseExpiresAt;
		case "completed":
			return metadata.kind === "permanent" ? null : metadata.completion.expiresAt;
	}
};

const completionResponse = (
	completion: typeof TemporaryCompletion.Type | typeof ManagedAssetLocator.Type,
) =>
	"token" in completion
		? {
				token: completion.token,
				expiresAt: DateTime.formatIso(DateTime.makeUnsafe(completion.expiresAt * 1000)),
			}
		: completion;

const UploadTokenValue = Schema.Struct({ userId: UserId, intentId: Schema.String });

const resolveExtension = (contentType: UploadContentType) =>
	uploadContentTypeExtensions[contentType][0];

const isUploadContentType = (value: string): value is UploadContentType =>
	(uploadContentTypes as readonly string[]).includes(value);

const resolveContentType = (contentType: string) => {
	const normalized = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
	if (!normalized || !isUploadContentType(normalized)) {
		return Effect.fail(uploadError({ contentType: normalized, code: "unsupported-file-type" }));
	}
	return Effect.succeed(normalized);
};

const resolveContentTypeFromFileName = (fileName: string) => {
	const extension = fileName.split(".").pop()?.trim().toLowerCase() ?? "";
	const entry = Object.entries(uploadContentTypeExtensions).find(([, exts]) =>
		exts.includes(extension),
	);
	if (!entry || !isUploadContentType(entry[0])) {
		return Effect.fail(uploadError({ extension, code: "unsupported-file-extension" }));
	}
	return Effect.succeed(entry[0]);
};

const resolveIntentContentType = (contentType: string, fileName: string) => {
	const normalized = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
	return !normalized || normalized === "application/octet-stream"
		? resolveContentTypeFromFileName(fileName)
		: resolveContentType(normalized);
};

const resolveFileName = (name: string) => {
	const segments = name
		.replace(/[\\/]+$/, "")
		.split(/[\\/]/)
		.filter(Boolean);
	const fileName = segments[segments.length - 1];
	if (!fileName) {
		return Effect.fail(uploadError({ code: "empty-file-name" }));
	}
	return Effect.succeed(fileName);
};

export class UploadIntentsService extends Context.Service<UploadIntentsService>()(
	"UploadIntentsService",
	{
		make: Effect.gen(function* () {
			const redis = yield* RedisService;
			const s3Service = yield* S3Service;
			const managedAssets = yield* ManagedAssetsService;
			const objectStorage = yield* ObjectStorageService;
			const localStorage = yield* LocalStorageService;

			const createUploadIntent = Effect.fn("UploadIntentsService.createUploadIntent")(function* (
				user: CurrentUserValue,
				input: typeof UploadIntentInput.Type,
			) {
				const fileName = yield* resolveFileName(input.fileName);
				const contentType = yield* resolveIntentContentType(input.contentType, fileName);
				const provider =
					input.kind === "temporary" ? "local" : yield* objectStorage.permanentStorageProvider;
				const intentId = generateId();
				const objectKey = `${input.kind}/${generateId()}.${resolveExtension(contentType)}`;
				const now = Math.floor((yield* Clock.currentTimeMillis) / 1000);
				const expiresAt = now + UPLOAD_URL_EXPIRY_SECONDS;
				const target =
					provider === "local"
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
				const pending = {
					intentId,
					fileName,
					objectKey,
					expiresAt,
					contentType,
					createdAt: now,
					userId: user.id,
					state: "pending" as const,
				};
				const metadata =
					input.kind === "temporary"
						? { ...pending, kind: "temporary" as const, provider: "local" as const }
						: { ...pending, provider, kind: "permanent" as const };
				const encoded = yield* encodeIntent(metadata).pipe(Effect.orDie);
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
								? decodeIntent(raw).pipe(
										Effect.mapError(() => uploadError({ intentId, code: "intent-invalid" })),
									)
								: Effect.fail(uploadError({ intentId, code: "intent-expired" })),
						),
					);

			const completeUploadIntent = Effect.fn("UploadIntentsService.completeUploadIntent")(
				function* (user: CurrentUserValue, intentId: string) {
					const lockKey = redisKeys.uploadIntentLock(intentId);
					const lease = yield* redis.acquireLease(lockKey, UPLOAD_URL_EXPIRY_SECONDS);
					if (lease === null) {
						return yield* uploadError({ intentId, code: "intent-busy" });
					}
					return yield* Effect.gen(function* () {
						const metadata = yield* getIntent(intentId);
						if (metadata.userId !== user.id) {
							return yield* uploadError({ intentId, code: "intent-forbidden" });
						}
						if (metadata.state !== "pending") {
							return completionResponse(metadata.completion);
						}
						const now = Math.floor((yield* Clock.currentTimeMillis) / 1000);
						if (metadata.expiresAt <= now) {
							return yield* uploadError({ intentId, code: "intent-expired" });
						}
						const info =
							metadata.provider === "local"
								? yield* localStorage
										.statObject(metadata.objectKey)
										.pipe(Effect.mapError(() => uploadError({ intentId, code: "object-missing" })))
								: yield* s3Service
										.statObject(metadata.objectKey)
										.pipe(Effect.mapError(() => uploadError({ intentId, code: "object-missing" })));
						const maxBytes = uploadMaxBytes(metadata.kind, metadata.contentType);
						if (Number(info.size) > maxBytes) {
							yield* objectStorage
								.deleteObject({ type: metadata.provider, key: metadata.objectKey })
								.pipe(Effect.ignore);
							return yield* uploadError({
								maxBytes,
								code: "upload-too-large",
								actualBytes: Number(info.size),
							});
						}
						if (
							metadata.provider === "s3" &&
							info.type.split(";", 1)[0]?.trim().toLowerCase() !== metadata.contentType
						) {
							yield* objectStorage
								.deleteObject({ type: metadata.provider, key: metadata.objectKey })
								.pipe(Effect.ignore);
							return yield* uploadError({
								actual: info.type,
								code: "content-type-mismatch",
								expected: metadata.contentType,
							});
						}
						if (metadata.kind === "permanent") {
							const locator: ManagedAssetLocator = {
								type: metadata.provider,
								key: metadata.objectKey,
							};
							const hasher = new CryptoHasher("sha256");
							const objectStream = yield* objectStorage.openObject(locator);
							yield* Stream.runForEach(objectStream, (chunk) =>
								Effect.sync(() => {
									hasher.update(chunk);
								}),
							).pipe(Effect.mapError(() => uploadError({ code: "upload-failed" })));
							yield* managedAssets
								.registerManagedAsset({
									key: locator.key,
									ownerUserId: user.id,
									provider: locator.type,
									size: Number(info.size),
									sha256: hasher.digest("hex"),
									contentType: metadata.contentType,
								})
								.pipe(
									Effect.catchTag("Conflict", () =>
										Effect.fail(uploadError({ code: "upload-failed" })),
									),
								);
							const encoded = yield* encodeIntent({
								intentId,
								kind: "permanent",
								state: "completed",
								completion: locator,
								userId: metadata.userId,
								fileName: metadata.fileName,
								createdAt: metadata.createdAt,
								contentType: metadata.contentType,
							}).pipe(Effect.orDie);
							yield* redis.setAndRemoveFromIndex(
								redisKeys.uploadIntent(intentId),
								encoded,
								redisKeys.uploadIntentExpiry,
								intentId,
								UPLOAD_URL_EXPIRY_SECONDS,
							);
							return completionResponse(locator);
						}
						const completion = { token: generateId(), expiresAt: now + UPLOAD_TOKEN_TTL_SECONDS };
						const { expiresAt: _expiresAt, ...temporary } = metadata;
						const completed = { ...temporary, completion, state: "completed" as const };
						const encoded = yield* encodeIntent(completed).pipe(Effect.orDie);
						const tokenValue = yield* Schema.encodeUnknownEffect(
							Schema.fromJsonString(UploadTokenValue),
						)({ intentId, userId: user.id }).pipe(Effect.orDie);
						yield* redis.setAndIndexAndSet(
							redisKeys.uploadIntent(intentId),
							encoded,
							redisKeys.uploadIntentExpiry,
							completion.expiresAt,
							intentId,
							redisKeys.uploadToken(completion.token),
							tokenValue,
							UPLOAD_TOKEN_TTL_SECONDS,
						);
						return completionResponse(completion);
					}).pipe(Effect.ensuring(redis.releaseLease(lockKey, lease)));
				},
			);

			const putLocalIntent = Effect.fn("UploadIntentsService.putLocalIntent")(function* (
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
					return yield* uploadError({ intentId, code: "intent-busy" });
				}
				yield* Effect.gen(function* () {
					const raw = yield* redis.get(redisKeys.uploadIntent(intentId));
					if (!raw) {
						return yield* uploadError({ intentId, code: "intent-expired" });
					}
					const metadata = yield* decodeIntent(raw).pipe(
						Effect.mapError(() => uploadError({ intentId, code: "intent-invalid" })),
					);
					if (metadata.state !== "pending") {
						return yield* uploadError({ intentId, code: "intent-expired" });
					}
					if (metadata.provider !== "local") {
						return yield* uploadError({ intentId, code: "intent-provider-mismatch" });
					}
					if (metadata.expiresAt <= Math.floor((yield* Clock.currentTimeMillis) / 1000)) {
						return yield* uploadError({ intentId, code: "intent-expired" });
					}
					const normalizedContentType = contentType?.split(";")[0]?.trim().toLowerCase();
					if (normalizedContentType !== metadata.contentType) {
						return yield* uploadError({
							code: "content-type-mismatch",
							expected: metadata.contentType,
							actual: normalizedContentType ?? null,
						});
					}
					const maxBytes = uploadMaxBytes(metadata.kind, metadata.contentType);
					const declaredBytes = contentLength === undefined ? null : Number(contentLength);
					if (
						declaredBytes !== null &&
						Number.isFinite(declaredBytes) &&
						declaredBytes > maxBytes
					) {
						return yield* uploadError({
							maxBytes,
							code: "upload-too-large",
							actualBytes: declaredBytes,
						});
					}
					const renewedStream = stream.pipe(
						Stream.mapEffect((chunk) =>
							redis
								.renewLease(lockKey, lease, UPLOAD_URL_EXPIRY_SECONDS)
								.pipe(
									Effect.flatMap((renewed) =>
										renewed
											? Effect.succeed(chunk)
											: Effect.fail(uploadError({ intentId, code: "intent-expired" })),
									),
								),
						),
					);
					yield* localStorage
						.writeObject(metadata.objectKey, renewedStream, contentLength, maxBytes)
						.pipe(
							Effect.tapError((error) => Effect.logError("local upload failed", error)),
							Effect.mapError(() => uploadError({ code: "upload-failed" })),
						);
					return void 0;
				}).pipe(Effect.ensuring(redis.releaseLease(lockKey, lease)));
				return void 0;
			});

			const removeIntentRecord = (intentId: string, metadata: typeof UploadIntentMetadata.Type) =>
				Effect.gen(function* () {
					if (metadata.kind === "permanent" && metadata.state === "completed") {
						yield* redis.del(redisKeys.uploadIntent(intentId));
						yield* redis.zrem(redisKeys.uploadIntentExpiry, intentId);
						return;
					}
					yield* objectStorage.deleteObject({ type: metadata.provider, key: metadata.objectKey });
					if (metadata.kind === "temporary" && metadata.state !== "pending") {
						yield* redis.del(redisKeys.uploadToken(metadata.completion.token));
					}
					yield* redis.del(redisKeys.uploadIntent(intentId));
					yield* redis.zrem(redisKeys.uploadIntentExpiry, intentId);
				});

			const removeUploadIntent = Effect.fn("UploadIntentsService.removeUploadIntent")(function* (
				intentId: string,
			) {
				const raw = yield* redis.get(redisKeys.uploadIntent(intentId));
				if (!raw) {
					yield* redis.zrem(redisKeys.uploadIntentExpiry, intentId);
					return;
				}
				const metadata = yield* decodeIntent(raw).pipe(
					Effect.mapError(() => uploadError({ intentId, code: "intent-invalid" })),
				);
				yield* removeIntentRecord(intentId, metadata);
			});

			const cleanupPendingIntents = Effect.fn("UploadIntentsService.cleanupPendingIntents")(
				function* (max: number) {
					const now = Math.floor((yield* Clock.currentTimeMillis) / 1000);
					const intentIds = yield* redis.zrangeByScore(redisKeys.uploadIntentExpiry, now, max);
					yield* Effect.forEach(intentIds, (intentId) =>
						Effect.gen(function* () {
							const lockKey = redisKeys.uploadIntentLock(intentId);
							const lease = yield* redis.acquireLease(lockKey, CLEANUP_LEASE_SECONDS);
							if (lease === null) {
								return;
							}
							yield* Effect.gen(function* () {
								const raw = yield* redis.get(redisKeys.uploadIntent(intentId));
								if (!raw) {
									return yield* redis.zrem(redisKeys.uploadIntentExpiry, intentId);
								}
								const metadata = yield* decodeIntent(raw).pipe(
									Effect.mapError(() => uploadError({ intentId, code: "intent-invalid" })),
								);
								const deadline = intentDeadline(metadata);
								if (deadline !== null && deadline > now) {
									return yield* redis.zadd(redisKeys.uploadIntentExpiry, deadline, intentId);
								}
								return yield* removeIntentRecord(intentId, metadata);
							}).pipe(Effect.ensuring(redis.releaseLease(lockKey, lease)));
						}).pipe(
							Effect.catchCause((cause) =>
								Effect.logWarning("upload intent cleanup failed", cause).pipe(
									Effect.annotateLogs({ intentId }),
								),
							),
						),
					);
				},
			);

			const claimTemporaryUpload = Effect.fn("UploadIntentsService.claimTemporaryUpload")(
				function* (token: string, userId: UserId, claimId: string) {
					const rawToken = yield* redis.get(redisKeys.uploadToken(token));
					if (!rawToken) {
						return yield* uploadError({ code: "token-invalid" });
					}
					const tokenValue = yield* Schema.decodeEffect(Schema.fromJsonString(UploadTokenValue))(
						rawToken,
					).pipe(Effect.mapError(() => uploadError({ code: "token-invalid" })));
					if (tokenValue.userId !== userId) {
						return yield* uploadError({ code: "token-forbidden" });
					}
					const lockKey = redisKeys.uploadIntentLock(tokenValue.intentId);
					const lease = yield* redis.acquireLease(lockKey, CLEANUP_LEASE_SECONDS);
					if (lease === null) {
						return yield* uploadError({ code: "token-busy" });
					}
					return yield* Effect.gen(function* () {
						const metadata = yield* getIntent(tokenValue.intentId);
						const now = Math.floor((yield* Clock.currentTimeMillis) / 1000);
						const deadline = intentDeadline(metadata);
						if (
							metadata.userId !== userId ||
							metadata.kind !== "temporary" ||
							metadata.state === "pending" ||
							deadline === null ||
							deadline <= now ||
							metadata.completion.token !== token
						) {
							return yield* uploadError({ code: "token-invalid" });
						}
						if (metadata.state === "claimed" && metadata.claimId !== claimId) {
							return yield* uploadError({ code: "token-already-claimed" });
						}
						const resolvedPath = yield* localStorage
							.resolveObjectPath(metadata.objectKey)
							.pipe(
								Effect.mapError(() =>
									uploadError({ code: "object-missing", intentId: tokenValue.intentId }),
								),
							);
						const leaseExpiresAt =
							metadata.state === "claimed"
								? metadata.leaseExpiresAt
								: now + PROCESSING_LEASE_SECONDS;
						if (metadata.state === "completed") {
							const claimed = {
								...metadata,
								claimId,
								claimedAt: now,
								leaseExpiresAt,
								state: "claimed" as const,
							};
							const encoded = yield* encodeIntent(claimed).pipe(Effect.orDie);
							yield* redis.setAndIndexAndSet(
								redisKeys.uploadIntent(tokenValue.intentId),
								encoded,
								redisKeys.uploadIntentExpiry,
								leaseExpiresAt,
								tokenValue.intentId,
								redisKeys.uploadToken(token),
								rawToken,
								PROCESSING_LEASE_SECONDS,
							);
						}
						return {
							resolvedPath,
							fileName: metadata.fileName,
							intentId: tokenValue.intentId,
							locator: { type: metadata.provider, key: metadata.objectKey },
							leaseExpiresAt: DateTime.formatIso(DateTime.makeUnsafe(leaseExpiresAt * 1000)),
						};
					}).pipe(Effect.ensuring(redis.releaseLease(lockKey, lease)));
				},
			);

			const deleteTemporaryUpload = Effect.fn("UploadIntentsService.deleteTemporaryUpload")(
				function* (intentId: string) {
					const lockKey = redisKeys.uploadIntentLock(intentId);
					const lease = yield* redis.acquireLease(lockKey, CLEANUP_LEASE_SECONDS);
					if (lease === null) {
						return yield* uploadError({ intentId, code: "intent-busy" });
					}
					yield* removeUploadIntent(intentId).pipe(
						Effect.ensuring(redis.releaseLease(lockKey, lease)),
					);
					return void 0;
				},
			);

			return {
				putLocalIntent,
				createUploadIntent,
				completeUploadIntent,
				claimTemporaryUpload,
				deleteTemporaryUpload,
				cleanupPendingIntents,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
