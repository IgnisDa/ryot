import { expect, layer } from "@effect/vitest";
import type { ManagedAssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import { UserId } from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { and, eq } from "drizzle-orm";
import { Deferred, Effect, Fiber, Layer } from "effect";

import {
	makeManagedAssetReferenceLocker,
	ManagedAssetReferenceRejected,
} from "#lib/domain/managed-asset-writes";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { ManagedAssetReferencesRepository } from "./managed-asset-references-repository";
import { ManagedAssetsRepository } from "./managed-assets-repository";

const assetSchema: AppSchema = {
	fields: {
		image: {
			type: "object",
			properties: {},
			label: "Image",
			description: "Image",
			validation: { asset: true },
		},
	},
};

const testLayer = ManagedAssetsRepository.layer.pipe(
	Layer.provideMerge(isolatedDatabaseLayer("managed_asset_concurrency")),
);
const referenceTestLayer = Layer.mergeAll(
	ManagedAssetsRepository.layer,
	ManagedAssetReferencesRepository.layer,
).pipe(Layer.provideMerge(isolatedDatabaseLayer("managed_asset_references")));

layer(testLayer)((test) => {
	test.effect("owner listing and verification queries exclude retired locators", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const repository = yield* ManagedAssetsRepository;
			const ownerUserId = UserId.make(crypto.randomUUID());
			const locator: ManagedAssetLocator = { type: "s3", key: `permanent/${ownerUserId}.png` };
			yield* session.run((db) =>
				db
					.insert(tables.user)
					.values({ id: ownerUserId, name: "Asset owner", email: `${ownerUserId}@example.test` }),
			);
			yield* session.run((db) =>
				db
					.insert(tables.managedAsset)
					.values({
						size: 1,
						ownerUserId,
						key: locator.key,
						retiredAt: new Date(),
						provider: locator.type,
						sha256: "a".repeat(64),
						contentType: "image/png",
					}),
			);
			expect(yield* repository.listByOwner(ownerUserId)).toEqual([]);
			expect(yield* repository.listByOwnerAndLocators(ownerUserId, [locator])).toEqual([]);
		}),
	);

	test.effect("a writer is rejected after cleanup commits its tombstone", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const lockAssetReferences = makeManagedAssetReferenceLocker(session);
			const repository = yield* ManagedAssetsRepository;
			const ownerUserId = UserId.make(crypto.randomUUID());
			const locator: ManagedAssetLocator = { type: "s3", key: `permanent/${ownerUserId}.png` };
			yield* session.run((db) =>
				db
					.insert(tables.user)
					.values({ id: ownerUserId, name: "Asset owner", email: `${ownerUserId}@example.test` }),
			);
			yield* session.run((db) =>
				db
					.insert(tables.managedAsset)
					.values({
						size: 1,
						ownerUserId,
						key: locator.key,
						provider: locator.type,
						sha256: "a".repeat(64),
						contentType: "image/png",
					}),
			);
			const locked = yield* Deferred.make<void>();
			const releaseCleanup = yield* Deferred.make<void>();
			const writerStarted = yield* Deferred.make<void>();
			const cleanup = yield* Effect.forkScoped(
				session.transaction(
					Effect.gen(function* () {
						const asset = yield* repository.lockByLocator(locator);
						expect(asset?.retiredAt).toBeNull();
						expect(yield* repository.retireOwned(ownerUserId, locator)).toBe(true);
						yield* Deferred.succeed(locked, undefined);
						yield* Deferred.await(releaseCleanup);
					}),
				),
			);
			yield* Deferred.await(locked);
			const writer = yield* Effect.forkScoped(
				session
					.transaction(
						Effect.gen(function* () {
							yield* Deferred.succeed(writerStarted, undefined);
							return yield* lockAssetReferences([
								{ ownerUserId, propertiesSchema: assetSchema, properties: { image: locator } },
							]);
						}),
					)
					.pipe(Effect.exit),
			);
			yield* Deferred.await(writerStarted);
			yield* Effect.yieldNow;
			yield* Deferred.succeed(releaseCleanup, undefined);
			yield* Fiber.join(cleanup);
			assertExitFails(yield* Fiber.join(writer), new ManagedAssetReferenceRejected());
			const tombstone = yield* session.run((db) =>
				db
					.select({ retiredAt: tables.managedAsset.retiredAt })
					.from(tables.managedAsset)
					.where(
						and(
							eq(tables.managedAsset.provider, locator.type),
							eq(tables.managedAsset.key, locator.key),
						),
					),
			);
			expect(tombstone[0]?.retiredAt).toBeInstanceOf(Date);
		}),
	);
});

layer(referenceTestLayer)((test) => {
	test.effect("cleanup reports referenced when the reference writer commits first", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const lockAssetReferences = makeManagedAssetReferenceLocker(session);
			const repository = yield* ManagedAssetsRepository;
			const references = yield* ManagedAssetReferencesRepository;
			const ownerUserId = UserId.make(crypto.randomUUID());
			const locator: ManagedAssetLocator = { type: "s3", key: `permanent/${ownerUserId}.png` };
			const entitySchemaSlug = `owned-asset-${ownerUserId}`;
			yield* session.run((db) =>
				db
					.insert(tables.user)
					.values({ id: ownerUserId, name: "Asset owner", email: `${ownerUserId}@example.test` }),
			);
			yield* session.run((db) =>
				db
					.insert(tables.managedAsset)
					.values({
						size: 1,
						ownerUserId,
						key: locator.key,
						provider: locator.type,
						sha256: "a".repeat(64),
						contentType: "image/png",
					}),
			);
			yield* session.run((db) =>
				db
					.insert(tables.definitionEntitySchema)
					.values({
						position: 0,
						icon: "box",
						name: "Owned entity",
						pluginRevisionId: null,
						slug: entitySchemaSlug,
						mergeIdentityProperties: [],
						propertiesSchema: assetSchema,
					}),
			);
			const locked = yield* Deferred.make<void>();
			const releaseWriter = yield* Deferred.make<void>();
			const cleanupStarted = yield* Deferred.make<void>();
			const writer = yield* Effect.forkScoped(
				session.transaction(
					Effect.gen(function* () {
						yield* lockAssetReferences([
							{ ownerUserId, propertiesSchema: assetSchema, properties: { image: locator } },
						]);
						yield* session.run((db) =>
							db
								.insert(tables.entity)
								.values({
									entitySchemaSlug,
									userId: ownerUserId,
									name: "Owned entity",
									entitySchemaPluginId: null,
									id: `owned-${ownerUserId}`,
									properties: { image: locator },
								}),
						);
						yield* Deferred.succeed(locked, undefined);
						yield* Deferred.await(releaseWriter);
					}),
				),
			);
			yield* Deferred.await(locked);
			const cleanup = yield* Effect.forkScoped(
				session.transaction(
					Effect.gen(function* () {
						yield* Deferred.succeed(cleanupStarted, undefined);
						const asset = yield* repository.lockByLocator(locator);
						return { asset, referenced: yield* references.hasReference(ownerUserId, locator) };
					}),
				),
			);
			yield* Deferred.await(cleanupStarted);
			yield* Effect.yieldNow;
			yield* Deferred.succeed(releaseWriter, undefined);
			yield* Fiber.join(writer);
			const result = yield* Fiber.join(cleanup);
			expect(result.asset?.retiredAt).toBeNull();
			expect(result.referenced).toBe(true);
		}),
	);

	test.effect("retains an owned asset referenced by a shared entity", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const references = yield* ManagedAssetReferencesRepository;
			const ownerUserId = UserId.make(crypto.randomUUID());
			const locator: ManagedAssetLocator = { type: "s3", key: `permanent/${ownerUserId}.png` };
			yield* session.run((db) =>
				db
					.insert(tables.user)
					.values({ id: ownerUserId, name: "Asset owner", email: `${ownerUserId}@example.test` }),
			);
			yield* session.run((db) =>
				db
					.insert(tables.managedAsset)
					.values({
						size: 1,
						ownerUserId,
						key: locator.key,
						provider: locator.type,
						sha256: "a".repeat(64),
						contentType: "image/png",
					}),
			);
			yield* session.run((db) =>
				db
					.insert(tables.definitionEntitySchema)
					.values({
						position: 0,
						icon: "box",
						name: "Shared entity",
						pluginRevisionId: null,
						mergeIdentityProperties: [],
						propertiesSchema: assetSchema,
						slug: "shared-asset-reference",
					}),
			);
			yield* session.run((db) =>
				db
					.insert(tables.entity)
					.values({
						userId: null,
						name: "Shared entity",
						entitySchemaPluginId: null,
						id: `shared-${ownerUserId}`,
						properties: { image: locator },
						entitySchemaSlug: "shared-asset-reference",
					}),
			);
			expect(yield* references.hasReference(ownerUserId, locator)).toBe(true);
		}),
	);
});
