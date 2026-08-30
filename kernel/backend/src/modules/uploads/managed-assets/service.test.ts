import { expect, layer } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import { BadRequest } from "@ryot-app/contract/errors";
import { UploadBadRequest } from "@ryot-app/contract/modules/uploads/schemas";
import { UserId } from "@ryot-app/contract/schema/brands";
import { CryptoHasher } from "bun";
import type { FileSystem } from "effect";
import { ByteSize, Clock, Context, DateTime, Effect, Layer, Option, Ref, Stream } from "effect";

import { mapDatabaseErrors } from "#lib/infrastructure/db/errors";
import { LocalStorageService } from "#lib/infrastructure/local-storage";
import { S3Service } from "#lib/infrastructure/s3";
import { assertExitFails } from "#lib/test-utils/assertions";
import { databaseLayer, fakeDatabaseSession } from "#lib/test-utils/effect";
import { LifecycleWriteGuard } from "#modules/auth/lifecycle-write-guard";

import { ObjectStorageService } from "../object-storage/service";
import { ManagedAssetsRepository } from "./repository";
import { ManagedAssetsService } from "./service";

const mockLocalStorage = Layer.mock(LocalStorageService);
const mockManagedAssetsRepository = Layer.mock(ManagedAssetsRepository);
const mockObjectStorage = Layer.mock(ObjectStorageService);
const mockS3 = Layer.mock(S3Service);
const mockUserLifecycleGuard = Layer.mock(LifecycleWriteGuard);

const userId = UserId.make("user-id");
const user: CurrentUserValue = {
	id: userId,
	image: null,
	name: "Test User",
	email: "user@example.com",
	preferences: { language: null, allowNsfw: false, disableIntegrations: false },
};
const managedAssetCreatedAt = new Date("2026-01-01T00:00:00.000Z");
const localFileInfo = {
	dev: 1,
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
	size: ByteSize.bytes(1),
	birthtime: Option.none(),
} satisfies FileSystem.File.Info;

type PresignedDownload = {
	readonly key: string;
	readonly expiresInSeconds: number;
	readonly contentDisposition: string | undefined;
};

class FakeObjectStorage extends Context.Service<
	FakeObjectStorage,
	{ readonly deletes: Effect.Effect<number>; readonly stored: Effect.Effect<Uint8Array | null> }
>()("test/FakeObjectStorage") {}

class FakeLifecycleOperation extends Context.Service<
	FakeLifecycleOperation,
	{ readonly activate: Effect.Effect<void> }
>()("test/FakeLifecycleOperation") {}

class FakeS3Presigner extends Context.Service<
	FakeS3Presigner,
	{ readonly presigned: Effect.Effect<ReadonlyArray<PresignedDownload>> }
>()("test/FakeS3Presigner") {}

const missingObject = () => Effect.fail(new BadRequest({ message: "missing" }));

const inMemoryObjectStorageLayer = Layer.unwrap(
	Effect.gen(function* () {
		const stored = yield* Ref.make<Uint8Array | null>(null);
		const deletes = yield* Ref.make(0);
		return Layer.merge(
			Layer.succeed(FakeObjectStorage, { stored: Ref.get(stored), deletes: Ref.get(deletes) }),
			mockObjectStorage({
				deleteObject: () =>
					Ref.update(deletes, (count) => count + 1).pipe(Effect.andThen(Ref.set(stored, null))),
				openObject: () =>
					Ref.get(stored).pipe(
						Effect.flatMap((body) =>
							body === null ? missingObject() : Effect.succeed(Stream.make(body)),
						),
					),
				statObject: () =>
					Ref.get(stored).pipe(
						Effect.flatMap((body) =>
							body === null
								? missingObject()
								: Effect.succeed({
										size: body.byteLength,
										contentType: "application/octet-stream",
									}),
						),
					),
				writeObjectIfAbsent: (_locator, stream) =>
					Effect.gen(function* () {
						const chunks = yield* Stream.runCollect(
							stream.pipe(
								Stream.mapError(() => new BadRequest({ message: "asset stream failed" })),
							),
						);
						const body = Uint8Array.from(Array.from(chunks).flatMap((chunk) => Array.from(chunk)));
						return yield* Ref.modify(stored, (current) =>
							current === null ? [true, body] : [false, current],
						);
					}),
			}),
		);
	}),
);

const makeLifecycleDatabaseLayer = (initiallyActive: boolean) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const active = yield* Ref.make(initiallyActive);
			const transaction = Object.assign(Object.create(null), {
				execute: () => Effect.void,
				select: () => ({
					from: () => ({
						where: () => ({
							limit: () =>
								Ref.get(active).pipe(
									Effect.map((isActive) => (isActive ? [{ id: "operation-1" }] : [])),
								),
						}),
					}),
				}),
			});
			return LifecycleWriteGuard.layer.pipe(
				Layer.provideMerge(
					Layer.merge(
						Layer.succeed(FakeLifecycleOperation, { activate: Ref.set(active, true) }),
						fakeDatabaseSession(transaction, { transaction: (work) => mapDatabaseErrors(work) }),
					),
				),
			);
		}),
	);

const recordingPresignerLayer = Layer.unwrap(
	Effect.gen(function* () {
		const presigned = yield* Ref.make<ReadonlyArray<PresignedDownload>>([]);
		return Layer.merge(
			Layer.succeed(FakeS3Presigner, { presigned: Ref.get(presigned) }),
			mockS3({
				isConfigured: true,
				presignDownload: (key, expiresInSeconds, contentDisposition) =>
					Ref.update(presigned, (all) => [
						...all,
						{ key, expiresInSeconds, contentDisposition },
					]).pipe(Effect.as(`https://s3.test/${key}`)),
			}),
		);
	}),
);

const makeLayer = (locators: ReadonlyArray<{ key: string; type: "local" | "s3" }>) =>
	ManagedAssetsService.layer.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				databaseLayer,
				mockLocalStorage({}),
				mockObjectStorage({}),
				mockS3({ isConfigured: true }),
				mockUserLifecycleGuard({ isActive: () => Effect.succeed(false) }),
				mockManagedAssetsRepository({
					listByOwnerAndLocators: (ownerUserId) =>
						Effect.succeed(
							locators.map(({ key, type }) => ({
								key,
								size: 100,
								ownerUserId,
								provider: type,
								sha256: "a".repeat(64),
								contentType: "image/png",
								createdAt: new Date("2026-01-01T00:00:00.000Z"),
							})),
						),
				}),
			),
		),
	);

const verifiedLocators = [
	{ type: "s3" as const, key: "permanent/image.png" },
	{ type: "local" as const, key: "permanent/photo.png" },
];

layer(makeLayer(verifiedLocators))((test) => {
	test.effect("verifies ownership for the complete locator set", () =>
		Effect.gen(function* () {
			const service = yield* ManagedAssetsService;
			expect(yield* service.verifyManagedAssetOwnership(userId, verifiedLocators)).toHaveLength(2);
		}),
	);
});

const ownedLocators = [{ type: "s3" as const, key: "permanent/owned.png" }];

layer(makeLayer(ownedLocators))((test) => {
	test.effect("rejects a partially owned locator set", () =>
		Effect.gen(function* () {
			const service = yield* ManagedAssetsService;
			const exit = yield* Effect.exit(
				service.verifyManagedAssetOwnership(userId, [
					...ownedLocators,
					{ type: "local", key: "permanent/unowned.png" },
				]),
			);
			assertExitFails(exit, new UploadBadRequest({ reason: { code: "asset-forbidden" } }));
		}),
	);
});

const downloadLocators = [
	{ type: "local" as const, key: "permanent/local.png" },
	{ type: "s3" as const, key: "permanent/remote.svg" },
];

const downloadLayer = ManagedAssetsService.layer.pipe(
	Layer.provideMerge(
		Layer.mergeAll(
			databaseLayer,
			mockLocalStorage({
				statObject: () => Effect.succeed(localFileInfo),
				createDownloadTarget: (key) => Effect.succeed(`uploads/local/download?key=${key}`),
			}),
			mockObjectStorage({}),
			recordingPresignerLayer,
			mockUserLifecycleGuard({ isActive: () => Effect.succeed(false) }),
			mockManagedAssetsRepository({
				listByOwnerAndLocators: (ownerUserId) =>
					Effect.succeed(
						downloadLocators.map(({ key, type }) => ({
							key,
							size: 1,
							ownerUserId,
							provider: type,
							sha256: "a".repeat(64),
							createdAt: managedAssetCreatedAt,
							contentType: type === "s3" ? "image/svg+xml" : "image/png",
						})),
					),
			}),
		),
	),
);

layer(downloadLayer)((test) => {
	test.effect("returns one deterministic expiry for local and S3 download resolutions", () =>
		Effect.gen(function* () {
			const now = Math.floor((yield* Clock.currentTimeMillis) / 1000);
			const service = yield* ManagedAssetsService;
			const result = yield* service.resolveDownloads(user, downloadLocators);
			const expiresAt = DateTime.formatIso(DateTime.makeUnsafe((now + 15 * 60) * 1000));
			expect(result).toEqual([
				{
					expiresAt,
					asset: downloadLocators[0],
					downloadUrl: "uploads/local/download?key=permanent/local.png",
				},
				{
					expiresAt,
					asset: downloadLocators[1],
					downloadUrl: "https://s3.test/permanent/remote.svg",
				},
			]);
			expect(yield* (yield* FakeS3Presigner).presigned).toEqual([
				{
					expiresInSeconds: 15 * 60,
					key: "permanent/remote.svg",
					contentDisposition: "attachment",
				},
			]);
		}),
	);
});

const concurrentStagingLayer = ManagedAssetsService.layer.pipe(
	Layer.provideMerge(
		Layer.mergeAll(
			databaseLayer,
			mockLocalStorage({}),
			mockS3({ isConfigured: true }),
			mockUserLifecycleGuard({ isActive: () => Effect.succeed(false) }),
			mockManagedAssetsRepository({ getByLocator: () => Effect.succeed(null) }),
			inMemoryObjectStorageLayer,
		),
	),
);

layer(concurrentStagingLayer)((test) => {
	test.effect("assigns concurrent staging ownership only to the conditional-create winner", () =>
		Effect.gen(function* () {
			const bytes = new TextEncoder().encode("concurrent asset");
			const sha256 = new CryptoHasher("sha256").update(bytes).digest("hex");
			const input = () => ({
				sha256,
				ownerUserId: userId,
				size: bytes.byteLength,
				stream: Stream.make(bytes),
				provider: "local" as const,
				contentType: "application/octet-stream",
			});
			const managedAssets = yield* ManagedAssetsService;
			const objectStorage = yield* FakeObjectStorage;
			const staged = yield* Effect.all(
				[
					managedAssets.stageContentAddressedPermanentAsset(input()),
					managedAssets.stageContentAddressedPermanentAsset(input()),
				],
				{ concurrency: "unbounded" },
			);
			expect(staged.map(({ created }) => created).sort((a, b) => Number(a) - Number(b))).toEqual([
				false,
				true,
			]);
			const loser = staged.find(({ created }) => !created);
			expect(loser).toBeDefined();
			if (loser) {
				yield* managedAssets.cleanupStagedPermanentAsset(loser);
			}
			expect(yield* objectStorage.stored).not.toBeNull();
			expect(yield* objectStorage.deletes).toBe(0);
		}),
	);
});

const blockedRegistrationLayer = ManagedAssetsService.layer.pipe(
	Layer.provideMerge(
		Layer.mergeAll(
			makeLifecycleDatabaseLayer(true),
			mockLocalStorage({}),
			mockObjectStorage({}),
			mockS3({ isConfigured: true }),
			mockManagedAssetsRepository({
				registerPermanentOwnedObject: () => Effect.die("registration must be blocked"),
			}),
		),
	),
);

layer(blockedRegistrationLayer)((test) => {
	test.effect("blocks managed asset registration while the owner lifecycle is active", () =>
		Effect.gen(function* () {
			const service = yield* ManagedAssetsService;
			const exit = yield* Effect.exit(
				service.registerManagedAsset({
					size: 1,
					provider: "s3",
					ownerUserId: userId,
					sha256: "a".repeat(64),
					contentType: "image/png",
					key: "permanent/image.png",
				}),
			);
			assertExitFails(exit, new UploadBadRequest({ reason: { code: "lifecycle-active" } }));
		}),
	);
});

const racedRegistrationLayer = ManagedAssetsService.layer.pipe(
	Layer.provideMerge(
		Layer.mergeAll(
			makeLifecycleDatabaseLayer(false),
			mockLocalStorage({}),
			mockS3({ isConfigured: true }),
			mockManagedAssetsRepository({
				getByLocator: () => Effect.succeed(null),
				registerPermanentOwnedObject: () => Effect.die("registration must be blocked"),
			}),
			inMemoryObjectStorageLayer,
		),
	),
);

layer(racedRegistrationLayer)((test) => {
	test.effect(
		"rejects registration when lifecycle wins after staging and cleans only its own object",
		() =>
			Effect.gen(function* () {
				const bytes = new TextEncoder().encode("raced asset");
				const sha256 = new CryptoHasher("sha256").update(bytes).digest("hex");
				const service = yield* ManagedAssetsService;
				const objectStorage = yield* FakeObjectStorage;
				const staged = yield* service.stageContentAddressedPermanentAsset({
					sha256,
					provider: "local",
					ownerUserId: userId,
					size: bytes.byteLength,
					stream: Stream.make(bytes),
					contentType: "application/octet-stream",
				});
				yield* (yield* FakeLifecycleOperation).activate;
				const error = yield* service.registerManagedAsset(staged.metadata).pipe(Effect.flip);
				expect(error).toEqual(new UploadBadRequest({ reason: { code: "lifecycle-active" } }));
				yield* service.cleanupStagedPermanentAsset(staged);
				expect(yield* objectStorage.stored).toBeNull();
				expect(yield* objectStorage.deletes).toBe(1);
			}),
	);
});
