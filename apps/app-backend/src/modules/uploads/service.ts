import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { type BadRequest, badRequest } from "@ryot/contract/errors";
import {
	ManagedAssetLocator,
	UploadKind,
	UploadProvider,
	type UploadIntentInput,
} from "@ryot/contract/modules/uploads/schemas";
import {
	type UploadContentType,
	uploadMaxBytes,
	uploadContentTypeExtensions,
	uploadContentTypes,
} from "@ryot/contract/modules/uploads/upload-policy";
import { UserId } from "@ryot/contract/schema/brands";
import { generateId } from "better-auth";
import { CryptoHasher } from "bun";
import { Clock, Context, DateTime, Effect, Layer, Schema, Stream } from "effect";

import { LocalStorageService } from "#lib/infrastructure/local-storage";
import { RedisService, redisKeys } from "#lib/infrastructure/redis";
import { S3Service } from "#lib/infrastructure/s3";

import { type RegisterManagedAssetInput, UploadsRepository } from "./repository";

const UPLOAD_TOKEN_TTL_SECONDS = 15 * 60;
const UPLOAD_URL_EXPIRY_SECONDS = 15 * 60;
const PROCESSING_LEASE_SECONDS = 24 * 60 * 60;
const CLEANUP_LEASE_SECONDS = 60;

const UploadIntentMetadata = Schema.Struct({
	userId: UserId,
	kind: UploadKind,
	intentId: Schema.String,
	fileName: Schema.String,
	objectKey: Schema.String,
	createdAt: Schema.Finite,
	expiresAt: Schema.Finite,
	provider: UploadProvider,
	contentType: Schema.String,
	claimId: Schema.optional(Schema.String),
	claimedAt: Schema.optional(Schema.Finite),
	cleaningAt: Schema.optional(Schema.Finite),
	state: Schema.Literals(["pending", "completed", "claimed", "cleaning"]),
	completion: Schema.optional(
		Schema.Union([
			ManagedAssetLocator,
			Schema.Struct({ expiresAt: Schema.Finite, token: Schema.String }),
		]),
	),
});
type UploadIntentMetadata = typeof UploadIntentMetadata.Type;

const UploadTokenValue = Schema.Struct({ intentId: Schema.String, userId: UserId });

export type StagedPermanentAsset = {
	locator: ManagedAssetLocator;
	metadata: RegisterManagedAssetInput;
};

const resolveExtension = (contentType: UploadContentType) =>
	uploadContentTypeExtensions[contentType][0];

const resolvePermanentExtension = (contentType: string) => {
	const normalized = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
	if (isUploadContentType(normalized)) {
		return resolveExtension(normalized);
	}
	return normalized === "application/octet-stream" ? "bin" : null;
};

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

const isPermanentObjectKey = (key: string) => /^permanent\/[A-Za-z0-9_-]+\.[a-z0-9]+$/.test(key);

const validateManagedAsset = (input: RegisterManagedAssetInput) => {
	if (!isPermanentObjectKey(input.key)) {
		return Effect.fail(badRequest("Permanent object key is invalid"));
	}
	if (!/^[a-f0-9]{64}$/.test(input.sha256)) {
		return Effect.fail(badRequest("Managed asset SHA-256 is invalid"));
	}
	if (!Number.isSafeInteger(input.size) || input.size < 0) {
		return Effect.fail(badRequest("Managed asset size is invalid"));
	}
	return Effect.void;
};

const ownerNamespace = (ownerUserId: UserId) =>
	new CryptoHasher("sha256").update(ownerUserId).digest("hex");

const storedMetadataMatches = (
	stored: { contentType: string | null; size: number },
	metadata: Pick<RegisterManagedAssetInput, "contentType" | "size">,
) =>
	stored.size === metadata.size &&
	(stored.contentType === null ||
		stored.contentType.split(";", 1)[0]?.trim().toLowerCase() ===
			metadata.contentType.split(";", 1)[0]?.trim().toLowerCase());

const limitStreamBytes = (stream: Stream.Stream<Uint8Array, unknown>, maxBytes: number) => {
	let size = 0;
	return stream.pipe(
		Stream.mapEffect((chunk) => {
			size += chunk.byteLength;
			return size > maxBytes
				? Effect.fail(badRequest(`Upload exceeds maximum allowed size of ${maxBytes} bytes`))
				: Effect.succeed(chunk);
		}),
	);
};

export class UploadsService extends Context.Service<UploadsService>()("UploadsService", {
	make: Effect.gen(function* () {
		const redis = yield* RedisService;
		const s3Service = yield* S3Service;
		const repository = yield* UploadsRepository;
		const localStorage = yield* LocalStorageService;

		const openObject = Effect.fn("UploadsService.openObject")(function* (
			locator: ManagedAssetLocator,
		) {
			return yield* locator.type === "local"
				? localStorage.openObject(locator.key)
				: s3Service.openObject(locator.key);
		});

		const writeObject = Effect.fn("UploadsService.writeObject")(function* (
			locator: ManagedAssetLocator,
			stream: Stream.Stream<Uint8Array, unknown>,
			contentType: string,
			contentLength: number | undefined,
			maxBytes: number,
		) {
			if (contentLength !== undefined && contentLength > maxBytes) {
				return yield* badRequest(`Upload exceeds maximum allowed size of ${maxBytes} bytes`);
			}
			if (locator.type === "local") {
				return yield* localStorage.writeObject(
					locator.key,
					stream,
					contentLength === undefined ? undefined : String(contentLength),
					maxBytes,
				);
			}
			const bounded = limitStreamBytes(stream, maxBytes);
			return yield* s3Service
				.writeObject(locator.key, bounded, contentType)
				.pipe(
					Effect.catchCause((cause) =>
						s3Service
							.deleteObject(locator.key)
							.pipe(Effect.ignore, Effect.andThen(Effect.failCause(cause))),
					),
				);
		});

		const selectStorageProvider = Effect.fn("UploadsService.selectStorageProvider")(function* (
			kind: "permanent" | "temporary",
		) {
			if (localStorage.isConfiguredForKind(kind)) {
				return "local" as const;
			}
			if (s3Service.isConfigured) {
				return "s3" as const;
			}
			return yield* badRequest("No object storage provider is configured");
		});

		const statObject = Effect.fn("UploadsService.statObject")(function* (
			locator: ManagedAssetLocator,
		) {
			const info = yield* locator.type === "local"
				? localStorage.statObject(locator.key)
				: s3Service.statObject(locator.key);
			return {
				size: Number(info.size),
				contentType: locator.type === "s3" ? info.type : null,
			};
		});

		const deleteObject = Effect.fn("UploadsService.deleteObject")(function* (
			locator: ManagedAssetLocator,
		) {
			yield* locator.type === "local"
				? localStorage.deleteObject(locator.key)
				: s3Service.deleteObject(locator.key);
		});

		const registerManagedAsset = Effect.fn("UploadsService.registerManagedAsset")(function* (
			input: RegisterManagedAssetInput,
		) {
			yield* validateManagedAsset(input);
			return yield* repository.registerPermanentOwnedObject(input);
		});

		const listManagedAssetsForOwner = Effect.fn("UploadsService.listManagedAssetsForOwner")(
			function* (ownerUserId: UserId) {
				return yield* repository.listByOwner(ownerUserId);
			},
		);

		const verifyManagedAssetOwnership = Effect.fn("UploadsService.verifyManagedAssetOwnership")(
			function* (ownerUserId: UserId, locators: ReadonlyArray<ManagedAssetLocator>) {
				const assets = yield* repository.listByOwnerAndLocators(ownerUserId, locators);
				const requested = new Set(locators.map(({ type, key }) => `${type}\0${key}`));
				if (assets.length !== requested.size) {
					return yield* badRequest("One or more managed assets do not belong to this user");
				}
				return assets;
			},
		);

		const stageContentAddressedPermanentAsset = Effect.fn(
			"UploadsService.stageContentAddressedPermanentAsset",
		)(function* (
			input: Omit<RegisterManagedAssetInput, "key"> & {
				stream: Stream.Stream<Uint8Array, unknown>;
			},
		) {
			const extension = resolvePermanentExtension(input.contentType);
			if (extension === null) {
				return yield* badRequest("Managed asset content type is unsupported");
			}
			const metadata: RegisterManagedAssetInput = {
				...input,
				key: `permanent/${ownerNamespace(input.ownerUserId)}_${input.sha256}.${extension}`,
			};
			yield* validateManagedAsset(metadata);
			const locator: ManagedAssetLocator = { type: metadata.provider, key: metadata.key };
			const existing = yield* statObject(locator).pipe(Effect.option);
			if (existing._tag === "Some") {
				if (!storedMetadataMatches(existing.value, metadata)) {
					return yield* badRequest("Stored managed asset does not match its metadata");
				}
				const hasher = new CryptoHasher("sha256");
				const object = yield* openObject(locator);
				yield* Stream.runForEach(object, (chunk) =>
					Effect.sync(() => {
						hasher.update(chunk);
					}),
				);
				if (hasher.digest("hex") !== metadata.sha256) {
					return yield* badRequest("Stored managed asset does not match its metadata");
				}
				return { locator, metadata } satisfies StagedPermanentAsset;
			}

			let size = 0;
			const hasher = new CryptoHasher("sha256");
			const measured = input.stream.pipe(
				Stream.mapEffect((chunk) =>
					Effect.sync(() => {
						size += chunk.byteLength;
						hasher.update(chunk);
						return chunk;
					}),
				),
			);
			return yield* Effect.gen(function* () {
				yield* writeObject(locator, measured, metadata.contentType, metadata.size, metadata.size);
				if (size !== metadata.size || hasher.digest("hex") !== metadata.sha256) {
					return yield* badRequest("Stored managed asset does not match its metadata");
				}
				const stored = yield* statObject(locator);
				if (!storedMetadataMatches(stored, metadata)) {
					return yield* badRequest("Stored managed asset does not match its metadata");
				}
				return { locator, metadata } satisfies StagedPermanentAsset;
			}).pipe(
				Effect.catchCause((cause) =>
					deleteObject(locator).pipe(Effect.ignore, Effect.andThen(Effect.failCause(cause))),
				),
			);
		});

		const cleanupStagedPermanentAsset = Effect.fn("UploadsService.cleanupStagedPermanentAsset")(
			function* (staged: StagedPermanentAsset) {
				if (yield* repository.getByLocator(staged.locator)) {
					return;
				}
				yield* deleteObject(staged.locator);
			},
		);

		const createUploadIntent = Effect.fn("UploadsService.createUploadIntent")(function* (
			user: CurrentUserValue,
			input: typeof UploadIntentInput.Type,
		) {
			if (input.provider === "s3" && !s3Service.isConfigured) {
				return yield* badRequest(
					"S3 file storage is not configured. Set the FILE_STORAGE_S3_* settings.",
				);
			}
			if (input.provider === "local" && !localStorage.isConfiguredForKind(input.kind)) {
				return yield* badRequest(
					input.kind === "temporary"
						? "Local temporary storage is not configured. Set FILE_STORAGE_LOCAL_SIGNING_SECRET."
						: "Local permanent storage is not configured. Set FILE_STORAGE_LOCAL_SIGNING_SECRET.",
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
				fileName,
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
				const maxBytes = uploadMaxBytes(metadata.kind, metadata.contentType);
				if (Number(info.size) > maxBytes) {
					yield* (
						metadata.provider === "local"
							? localStorage.deleteObject(metadata.objectKey)
							: s3Service.deleteObject(metadata.objectKey)
					).pipe(Effect.ignore);
					return yield* badRequest(`Upload exceeds maximum allowed size of ${maxBytes} bytes`);
				}
				if (
					metadata.provider === "s3" &&
					info.type.split(";", 1)[0]?.trim().toLowerCase() !== metadata.contentType
				) {
					yield* s3Service.deleteObject(metadata.objectKey).pipe(Effect.ignore);
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
				if (metadata.kind === "permanent") {
					const locator: ManagedAssetLocator = {
						type: metadata.provider,
						key: metadata.objectKey,
					};
					const hasher = new CryptoHasher("sha256");
					const objectStream = yield* openObject(locator);
					yield* Stream.runForEach(objectStream, (chunk) =>
						Effect.sync(() => {
							hasher.update(chunk);
						}),
					).pipe(Effect.mapError(() => badRequest("Upload object could not be read")));
					yield* registerManagedAsset({
						key: locator.key,
						ownerUserId: user.id,
						provider: locator.type,
						size: Number(info.size),
						contentType: metadata.contentType,
						sha256: hasher.digest("hex"),
					}).pipe(
						Effect.catchTag("Conflict", () =>
							Effect.fail(badRequest("Upload object is already registered")),
						),
					);
				}
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
			yield* Effect.gen(function* () {
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
					.writeObject(
						metadata.objectKey,
						renewedStream,
						contentLength,
						uploadMaxBytes(metadata.kind, metadata.contentType),
					)
					.pipe(
						Effect.mapError((error) =>
							error instanceof Error
								? badRequest(error.message)
								: badRequest("Local upload failed"),
						),
					);
				return void 0;
			}).pipe(Effect.ensuring(redis.releaseLease(lockKey, lease)));
			return void 0;
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
			user: CurrentUserValue,
			assets: ReadonlyArray<{ key: string; type: "local" | "s3" }>,
		) {
			const owned = yield* verifyManagedAssetOwnership(user.id, assets);
			const ownedByLocator = new Map(
				owned.map((asset) => [`${asset.provider}\0${asset.key}`, asset] as const),
			);
			const now = Math.floor((yield* Clock.currentTimeMillis) / 1000);
			const resolved = yield* Effect.forEach(assets, (asset) =>
				Effect.gen(function* () {
					const managed = ownedByLocator.get(`${asset.type}\0${asset.key}`);
					if (!managed) {
						return yield* badRequest("Managed asset does not belong to this user");
					}
					const downloadUrl =
						asset.type === "local"
							? yield* Effect.gen(function* () {
									yield* localStorage.statObject(asset.key);
									return yield* localStorage.createDownloadTarget(
										asset.key,
										managed.contentType,
										now,
									);
								}).pipe(
									Effect.mapError(() => badRequest("Local download object is missing or invalid")),
								)
							: yield* s3Service.presignDownload(asset.key, UPLOAD_URL_EXPIRY_SECONDS);
					return { asset, downloadUrl };
				}),
			);
			return resolved;
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
					yield* Effect.gen(function* () {
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
			claimId: string,
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
					metadata.kind !== "temporary" ||
					(metadata.state !== "completed" && metadata.state !== "claimed") ||
					metadata.expiresAt <= now ||
					!metadata.completion ||
					!("token" in metadata.completion) ||
					metadata.completion.token !== token
				) {
					return yield* badRequest("Upload token is invalid or has expired");
				}
				if (metadata.state === "claimed" && metadata.claimId !== claimId) {
					return yield* badRequest("Upload token was claimed by a different operation");
				}
				const resolvedPath =
					metadata.provider === "local"
						? yield* localStorage
								.resolveObjectPath(metadata.objectKey)
								.pipe(Effect.mapError(() => badRequest("Upload object is missing or invalid")))
						: null;
				if (metadata.state === "claimed") {
					return {
						fileName: metadata.fileName,
						intentId: tokenValue.intentId,
						...(resolvedPath === null ? {} : { resolvedPath }),
						locator: { type: metadata.provider, key: metadata.objectKey },
						leaseExpiresAt: DateTime.formatIso(DateTime.makeUnsafe(metadata.expiresAt * 1000)),
					};
				}
				const leaseExpiresAt = now + PROCESSING_LEASE_SECONDS;
				const claimed = {
					...metadata,
					claimId,
					claimedAt: now,
					state: "claimed" as const,
					expiresAt: leaseExpiresAt,
				};
				const encoded = yield* Schema.encodeUnknownEffect(
					Schema.fromJsonString(UploadIntentMetadata),
				)(claimed).pipe(Effect.orDie);
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
				return {
					fileName: metadata.fileName,
					intentId: tokenValue.intentId,
					...(resolvedPath === null ? {} : { resolvedPath }),
					locator: { type: metadata.provider, key: metadata.objectKey },
					leaseExpiresAt: DateTime.formatIso(DateTime.makeUnsafe(leaseExpiresAt * 1000)),
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
			return void 0;
		});

		return {
			openObject,
			statObject,
			writeObject,
			deleteObject,
			putLocalIntent,
			resolveDownloads,
			createUploadIntent,
			completeUploadIntent,
			registerManagedAsset,
			resolveLocalDownload,
			claimTemporaryUpload,
			selectStorageProvider,
			deleteTemporaryUpload,
			cleanupPendingIntents,
			listManagedAssetsForOwner,
			verifyManagedAssetOwnership,
			cleanupStagedPermanentAsset,
			stageContentAddressedPermanentAsset,
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
