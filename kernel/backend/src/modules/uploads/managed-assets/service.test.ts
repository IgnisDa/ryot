import { expect, it } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import { BadRequest } from "@ryot-app/contract/errors";
import { UploadBadRequest } from "@ryot-app/contract/modules/uploads/schemas";
import { UserId } from "@ryot-app/contract/schema/brands";
import { CryptoHasher } from "bun";
import type { FileSystem } from "effect";
import { ByteSize, Clock, DateTime, Effect, Layer, Option, Stream } from "effect";

import { Database } from "#lib/infrastructure/db/service";
import { LocalStorageService } from "#lib/infrastructure/local-storage";
import { S3Service } from "#lib/infrastructure/s3";
import { assertExitFails } from "#lib/test-utils/assertions";
import { databaseLayer } from "#lib/test-utils/effect";
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

const makeLayer = (locators: ReadonlyArray<{ key: string; type: "local" | "s3" }>) => {
	const serviceLayer = ManagedAssetsService.layer.pipe(
		Layer.provide(
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
	const layer = Layer.merge(serviceLayer, databaseLayer);
	return layer;
};

it.effect("verifies ownership for the complete locator set", () => {
	const locators = [
		{ type: "s3" as const, key: "permanent/image.png" },
		{ type: "local" as const, key: "permanent/photo.png" },
	];
	return Effect.gen(function* () {
		const service = yield* ManagedAssetsService;
		expect(yield* service.verifyManagedAssetOwnership(userId, locators)).toHaveLength(2);
	}).pipe(Effect.provide(makeLayer(locators)));
});

it.effect("rejects a partially owned locator set", () => {
	const owned = [{ type: "s3" as const, key: "permanent/owned.png" }];
	return Effect.gen(function* () {
		const service = yield* ManagedAssetsService;
		const exit = yield* Effect.exit(
			service.verifyManagedAssetOwnership(userId, [
				...owned,
				{ type: "local", key: "permanent/unowned.png" },
			]),
		);
		assertExitFails(exit, new UploadBadRequest({ reason: { code: "asset-forbidden" } }));
	}).pipe(Effect.provide(makeLayer(owned)));
});

it.effect("returns one deterministic expiry for local and S3 download resolutions", () => {
	const presigned: Array<{
		readonly key: string;
		readonly expiresInSeconds: number;
		readonly contentDisposition: string | undefined;
	}> = [];
	const locators = [
		{ type: "local" as const, key: "permanent/local.png" },
		{ type: "s3" as const, key: "permanent/remote.svg" },
	];
	const layer = ManagedAssetsService.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				databaseLayer,
				mockLocalStorage({
					statObject: () => Effect.succeed(localFileInfo),
					createDownloadTarget: (key) => Effect.succeed(`uploads/local/download?key=${key}`),
				}),
				mockObjectStorage({}),
				mockS3({
					isConfigured: true,
					presignDownload: (key, expiresInSeconds, contentDisposition) =>
						Effect.sync(() => {
							presigned.push({ key, expiresInSeconds, contentDisposition });
							return `https://s3.test/${key}`;
						}),
				}),
				mockUserLifecycleGuard({ isActive: () => Effect.succeed(false) }),
				mockManagedAssetsRepository({
					listByOwnerAndLocators: (ownerUserId) =>
						Effect.succeed(
							locators.map(({ key, type }) => ({
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
	const providedLayer = Layer.merge(layer, databaseLayer);

	return Effect.gen(function* () {
		const now = Math.floor((yield* Clock.currentTimeMillis) / 1000);
		const service = yield* ManagedAssetsService;
		const result = yield* service.resolveDownloads(user, locators);
		const expiresAt = DateTime.formatIso(DateTime.makeUnsafe((now + 15 * 60) * 1000));
		expect(result).toEqual([
			{
				expiresAt,
				asset: locators[0],
				downloadUrl: "uploads/local/download?key=permanent/local.png",
			},
			{ expiresAt, asset: locators[1], downloadUrl: "https://s3.test/permanent/remote.svg" },
		]);
		expect(presigned).toEqual([
			{ expiresInSeconds: 15 * 60, key: "permanent/remote.svg", contentDisposition: "attachment" },
		]);
	}).pipe(Effect.provide(providedLayer));
});

it.effect("assigns concurrent staging ownership only to the conditional-create winner", () => {
	const bytes = new TextEncoder().encode("concurrent asset");
	const sha256 = new CryptoHasher("sha256").update(bytes).digest("hex");
	let stored: Uint8Array | null = null;
	let deletes = 0;
	const service = ManagedAssetsService.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				databaseLayer,
				mockLocalStorage({}),
				mockS3({ isConfigured: true }),
				mockUserLifecycleGuard({ isActive: () => Effect.succeed(false) }),
				mockManagedAssetsRepository({ getByLocator: () => Effect.succeed(null) }),
				mockObjectStorage({
					deleteObject: () =>
						Effect.sync(() => {
							deletes += 1;
							stored = null;
						}),
					openObject: () =>
						stored === null
							? Effect.fail(new BadRequest({ message: "missing" }))
							: Effect.succeed(Stream.make(stored)),
					statObject: () =>
						stored === null
							? Effect.fail(new BadRequest({ message: "missing" }))
							: Effect.succeed({
									size: stored.byteLength,
									contentType: "application/octet-stream",
								}),
					writeObjectIfAbsent: (_locator, stream) =>
						Effect.gen(function* () {
							const chunks = yield* Stream.runCollect(stream).pipe(
								Effect.mapError(() => new BadRequest({ message: "asset stream failed" })),
							);
							const body = Uint8Array.from(
								Array.from(chunks).flatMap((chunk) => Array.from(chunk)),
							);
							return yield* Effect.sync(() => {
								if (stored !== null) {
									return false;
								}
								stored = body;
								return true;
							});
						}),
				}),
			),
		),
	);
	const layer = Layer.merge(service, databaseLayer);

	return Effect.gen(function* () {
		const managedAssets = yield* ManagedAssetsService;
		const input = () => ({
			sha256,
			ownerUserId: userId,
			size: bytes.byteLength,
			stream: Stream.make(bytes),
			provider: "local" as const,
			contentType: "application/octet-stream",
		});
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
		expect(stored).not.toBeNull();
		expect(deletes).toBe(0);
	}).pipe(Effect.provide(layer));
});

it.effect("blocks managed asset registration while the owner lifecycle is active", () => {
	const transaction = Object.assign(Object.create(null), {
		execute: () => Effect.void,
		select: () => ({
			from: () => ({ where: () => ({ limit: () => Effect.succeed([{ id: "operation-1" }]) }) }),
		}),
	});
	const database = Database.of(
		Object.assign(Object.create(null), {
			transaction: (run: (tx: typeof transaction) => Effect.Effect<unknown, unknown, unknown>) =>
				run(transaction),
		}),
	);
	const serviceLayer = ManagedAssetsService.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				Layer.succeed(Database, database),
				mockLocalStorage({}),
				mockObjectStorage({}),
				mockS3({ isConfigured: true }),
				mockUserLifecycleGuard({ isActive: () => Effect.succeed(true) }),
				mockManagedAssetsRepository({
					registerPermanentOwnedObject: () => Effect.die("registration must be blocked"),
				}),
			),
		),
	);
	const layer = Layer.merge(serviceLayer, Layer.succeed(Database, database));

	return Effect.gen(function* () {
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
	}).pipe(Effect.provide(layer));
});

it.effect(
	"rejects registration when lifecycle wins after staging and cleans only its own object",
	() => {
		const bytes = new TextEncoder().encode("raced asset");
		const sha256 = new CryptoHasher("sha256").update(bytes).digest("hex");
		let active = false;
		let stored = false;
		let deletes = 0;
		const transaction = Object.assign(Object.create(null), {
			execute: () => Effect.void,
			select: () => ({
				from: () => ({
					where: () => ({ limit: () => Effect.succeed(active ? [{ id: "operation-1" }] : []) }),
				}),
			}),
		});
		const database = Database.of(
			Object.assign(Object.create(null), {
				transaction: (run: (tx: typeof transaction) => Effect.Effect<unknown, unknown, unknown>) =>
					run(transaction),
			}),
		);
		const serviceLayer = ManagedAssetsService.layer.pipe(
			Layer.provide(
				Layer.mergeAll(
					Layer.succeed(Database, database),
					mockLocalStorage({}),
					mockS3({ isConfigured: true }),
					mockUserLifecycleGuard({ isActive: () => Effect.succeed(false) }),
					mockManagedAssetsRepository({
						getByLocator: () => Effect.succeed(null),
						registerPermanentOwnedObject: () => Effect.die("registration must be blocked"),
					}),
					mockObjectStorage({
						deleteObject: () =>
							Effect.sync(() => {
								deletes += 1;
								stored = false;
							}),
						statObject: () =>
							Effect.succeed({ size: bytes.byteLength, contentType: "application/octet-stream" }),
						writeObjectIfAbsent: (_locator, stream) =>
							Stream.runDrain(stream).pipe(
								Effect.mapError(() => new BadRequest({ message: "stream failed" })),
								Effect.as(true),
								Effect.tap(() => Effect.sync(() => void (stored = true))),
							),
					}),
				),
			),
		);
		return Effect.gen(function* () {
			const service = yield* ManagedAssetsService;
			const staged = yield* service.stageContentAddressedPermanentAsset({
				sha256,
				provider: "local",
				ownerUserId: userId,
				size: bytes.byteLength,
				stream: Stream.make(bytes),
				contentType: "application/octet-stream",
			});
			active = true;
			const error = yield* service.registerManagedAsset(staged.metadata).pipe(Effect.flip);
			expect(error).toEqual(new UploadBadRequest({ reason: { code: "lifecycle-active" } }));
			yield* service.cleanupStagedPermanentAsset(staged);
			expect(stored).toBe(false);
			expect(deletes).toBe(1);
		}).pipe(Effect.provide(Layer.merge(serviceLayer, Layer.succeed(Database, database))));
	},
);
