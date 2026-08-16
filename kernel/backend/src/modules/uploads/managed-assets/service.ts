import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import {
	type ManagedAssetLocator,
	UploadBadRequest,
} from "@ryot-app/contract/modules/uploads/schemas";
import {
	type UploadContentType,
	uploadContentTypeExtensions,
	uploadContentTypes,
} from "@ryot-app/contract/modules/uploads/upload-policy";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { CryptoHasher } from "bun";
import { Clock, Context, Effect, Layer, Stream } from "effect";

import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import { acquireUserWriteLock } from "#lib/infrastructure/db/user-write-lock";
import { LocalStorageService } from "#lib/infrastructure/local-storage";
import { S3Service } from "#lib/infrastructure/s3";
import { isUserLifecycleActive, LifecycleWriteGuard } from "#modules/auth/lifecycle-write-guard";

import { ObjectStorageService } from "../object-storage/service";
import { type RegisterManagedAssetInput, ManagedAssetsRepository } from "./repository";

const UPLOAD_URL_EXPIRY_SECONDS = 15 * 60;

export type StagedPermanentAsset = {
	created: boolean;
	locator: ManagedAssetLocator;
	metadata: RegisterManagedAssetInput;
};

const isUploadContentType = (value: string): value is UploadContentType =>
	(uploadContentTypes as readonly string[]).includes(value);

const resolvePermanentExtension = (contentType: string) => {
	const normalized = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
	if (isUploadContentType(normalized)) {
		return uploadContentTypeExtensions[normalized][0];
	}
	return normalized === "application/octet-stream" ? "bin" : null;
};

const isPermanentObjectKey = (key: string) => /^permanent\/[A-Za-z0-9_-]+\.[a-z0-9]+$/.test(key);

const validateManagedAsset = (input: RegisterManagedAssetInput) => {
	if (!isPermanentObjectKey(input.key)) {
		return Effect.fail(
			new UploadBadRequest({ reason: { code: "asset-metadata-invalid", field: "key" } }),
		);
	}
	if (!/^[a-f0-9]{64}$/.test(input.sha256)) {
		return Effect.fail(
			new UploadBadRequest({ reason: { code: "asset-metadata-invalid", field: "sha256" } }),
		);
	}
	if (!Number.isSafeInteger(input.size) || input.size < 0) {
		return Effect.fail(
			new UploadBadRequest({ reason: { code: "asset-metadata-invalid", field: "size" } }),
		);
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

export class ManagedAssetsService extends Context.Service<ManagedAssetsService>()(
	"ManagedAssetsService",
	{
		make: Effect.gen(function* () {
			const s3Service = yield* S3Service;
			const lifecycle = yield* LifecycleWriteGuard;
			const localStorage = yield* LocalStorageService;
			const objectStorage = yield* ObjectStorageService;
			const repository = yield* ManagedAssetsRepository;

			const registerManagedAsset = Effect.fn("ManagedAssetsService.registerManagedAsset")(
				function* (input: RegisterManagedAssetInput) {
					yield* validateManagedAsset(input);
					const database = yield* Database;
					return yield* mapDatabaseErrors(
						database.transaction(
							(transaction) =>
								Effect.gen(function* () {
									yield* acquireUserWriteLock(input.ownerUserId);
									if (yield* isUserLifecycleActive(input.ownerUserId)) {
										return yield* new UploadBadRequest({ reason: { code: "lifecycle-active" } });
									}
									return yield* repository.registerPermanentOwnedObject(input);
								}).pipe(Effect.provideService(Database, transaction)),
							{ isolationLevel: "read committed" },
						),
					);
				},
			);
			const registerManagedAssetInLockedTransaction = Effect.fn(
				"ManagedAssetsService.registerManagedAssetInLockedTransaction",
			)(function* (input: RegisterManagedAssetInput) {
				yield* validateManagedAsset(input);
				if (yield* isUserLifecycleActive(input.ownerUserId)) {
					return yield* new UploadBadRequest({ reason: { code: "lifecycle-active" } });
				}
				return yield* repository.registerPermanentOwnedObject(input);
			});

			const listManagedAssetsForOwner = Effect.fn("ManagedAssetsService.listManagedAssetsForOwner")(
				function* (ownerUserId: UserId) {
					return yield* repository.listByOwner(ownerUserId);
				},
			);

			const verifyManagedAssetOwnership = Effect.fn(
				"ManagedAssetsService.verifyManagedAssetOwnership",
			)(function* (ownerUserId: UserId, locators: ReadonlyArray<ManagedAssetLocator>) {
				const assets = yield* repository.listByOwnerAndLocators(ownerUserId, locators);
				const requested = new Set(locators.map(({ type, key }) => `${type}\0${key}`));
				if (assets.length !== requested.size) {
					return yield* new UploadBadRequest({ reason: { code: "asset-forbidden" } });
				}
				return assets;
			});

			const stageContentAddressedPermanentAsset = Effect.fn(
				"ManagedAssetsService.stageContentAddressedPermanentAsset",
			)(function* (
				input: Omit<RegisterManagedAssetInput, "key"> & {
					stream: Stream.Stream<Uint8Array, unknown>;
				},
			) {
				if (yield* lifecycle.isActive(input.ownerUserId)) {
					return yield* new UploadBadRequest({ reason: { code: "lifecycle-active" } });
				}
				const extension = resolvePermanentExtension(input.contentType);
				if (extension === null) {
					return yield* new UploadBadRequest({
						reason: { code: "asset-content-type-unsupported", contentType: input.contentType },
					});
				}
				const metadata: RegisterManagedAssetInput = {
					...input,
					key: `permanent/${ownerNamespace(input.ownerUserId)}_${input.sha256}.${extension}`,
				};
				yield* validateManagedAsset(metadata);
				const locator: ManagedAssetLocator = { type: metadata.provider, key: metadata.key };
				const verifyStoredObject = Effect.gen(function* () {
					const stored = yield* objectStorage.statObject(locator);
					if (!storedMetadataMatches(stored, metadata)) {
						return yield* new UploadBadRequest({ reason: { code: "asset-metadata-mismatch" } });
					}
					const hasher = new CryptoHasher("sha256");
					const object = yield* objectStorage.openObject(locator);
					yield* Stream.runForEach(object, (chunk) =>
						Effect.sync(() => {
							hasher.update(chunk);
						}),
					);
					if (hasher.digest("hex") !== metadata.sha256) {
						return yield* new UploadBadRequest({ reason: { code: "asset-metadata-mismatch" } });
					}
					return yield* Effect.void;
				});

				let size = 0;
				let created = false;
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
					created = yield* objectStorage.writeObjectIfAbsent(
						locator,
						measured,
						metadata.contentType,
						metadata.size,
						metadata.size,
					);
					if (created) {
						if (size !== metadata.size || hasher.digest("hex") !== metadata.sha256) {
							return yield* new UploadBadRequest({ reason: { code: "asset-metadata-mismatch" } });
						}
						const stored = yield* objectStorage.statObject(locator);
						if (!storedMetadataMatches(stored, metadata)) {
							return yield* new UploadBadRequest({ reason: { code: "asset-metadata-mismatch" } });
						}
					} else {
						yield* verifyStoredObject;
					}
					return { created, locator, metadata } satisfies StagedPermanentAsset;
				}).pipe(
					Effect.catchCause((cause) =>
						created
							? objectStorage
									.deleteObject(locator)
									.pipe(Effect.ignore, Effect.andThen(Effect.failCause(cause)))
							: Effect.failCause(cause),
					),
				);
			});

			const cleanupStagedPermanentAsset = Effect.fn(
				"ManagedAssetsService.cleanupStagedPermanentAsset",
			)(function* (staged: StagedPermanentAsset) {
				if (!staged.created) {
					return;
				}
				if (yield* repository.getByLocator(staged.locator)) {
					return;
				}
				yield* objectStorage.deleteObject(staged.locator);
			});

			const resolveDownloads = Effect.fn("ManagedAssetsService.resolveDownloads")(function* (
				user: CurrentUserValue,
				assets: ReadonlyArray<{ key: string; type: "local" | "s3" }>,
			) {
				const owned = yield* verifyManagedAssetOwnership(user.id, assets);
				const ownedByLocator = new Map(
					owned.map((asset) => [`${asset.provider}\0${asset.key}`, asset] as const),
				);
				const now = Math.floor((yield* Clock.currentTimeMillis) / 1000);
				return yield* Effect.forEach(assets, (asset) =>
					Effect.gen(function* () {
						const managed = ownedByLocator.get(`${asset.type}\0${asset.key}`);
						if (!managed) {
							return yield* new UploadBadRequest({ reason: { code: "asset-forbidden" } });
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
										Effect.mapError(
											() => new UploadBadRequest({ reason: { code: "invalid-download-target" } }),
										),
									)
								: yield* s3Service.presignDownload(asset.key, UPLOAD_URL_EXPIRY_SECONDS);
						return { asset, downloadUrl };
					}),
				);
			});

			return {
				resolveDownloads,
				registerManagedAsset,
				listManagedAssetsForOwner,
				verifyManagedAssetOwnership,
				cleanupStagedPermanentAsset,
				stageContentAddressedPermanentAsset,
				registerManagedAssetInLockedTransaction,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
