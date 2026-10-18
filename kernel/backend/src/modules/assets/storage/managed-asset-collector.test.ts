import { expect, layer } from "@effect/vitest";
import { BadRequest } from "@ryot-app/contract/errors";
import type { ManagedAssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import { UserId } from "@ryot-app/contract/schema/brands";
import { and, eq, sql } from "drizzle-orm";
import { Context, Effect, Layer, Ref } from "effect";

import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { ManagedAssetCollector } from "./managed-asset-collector";
import { ManagedAssetReferencesRepository } from "./managed-asset-references-repository";
import { ManagedAssetsRepository } from "./managed-assets-repository";
import { ObjectStorageService } from "./object-storage";

class ObjectDeletions extends Context.Service<
	ObjectDeletions,
	{
		readonly deleted: Effect.Effect<ReadonlyArray<string>>;
		readonly failFor: (key: null | string) => Effect.Effect<void>;
	}
>()("test/ObjectDeletions") {}

const objectStorageLayer = Layer.unwrap(
	Effect.gen(function* () {
		const deleted = yield* Ref.make<ReadonlyArray<string>>([]);
		const failing = yield* Ref.make<null | string>(null);
		return Layer.merge(
			Layer.succeed(ObjectDeletions, {
				deleted: Ref.get(deleted),
				failFor: (key) => Ref.set(failing, key),
			}),
			Layer.mock(ObjectStorageService)({
				deleteObject: (locator) =>
					Effect.gen(function* () {
						if ((yield* Ref.get(failing)) === locator.key) {
							return yield* new BadRequest({ message: "storage unavailable" });
						}
						return yield* Ref.update(deleted, (keys) => [...keys, locator.key]);
					}),
			}),
		);
	}),
);

const testLayer = ManagedAssetCollector.layer.pipe(
	Layer.provideMerge(
		Layer.mergeAll(
			ManagedAssetsRepository.layer,
			ManagedAssetReferencesRepository.layer,
			objectStorageLayer,
		),
	),
	Layer.provideMerge(isolatedDatabaseLayer("managed_asset_collector")),
);

const insertAsset = Effect.fn(function* (ownerUserId: UserId, checkAfter: Date) {
	const session = yield* DatabaseSession;
	const locator: ManagedAssetLocator = {
		type: "s3",
		key: `permanent/${ownerUserId}_${crypto.randomUUID()}.png`,
	};
	yield* session.run((db) =>
		db
			.insert(tables.user)
			.values({ id: ownerUserId, name: ownerUserId, email: `${ownerUserId}@example.test` })
			.onConflictDoNothing(),
	);
	yield* session.run((db) =>
		db
			.insert(tables.managedAsset)
			.values({
				size: 1,
				checkAfter,
				ownerUserId,
				key: locator.key,
				provider: locator.type,
				sha256: "a".repeat(64),
				contentType: "image/png",
			}),
	);
	return locator;
});

const readAsset = Effect.fn(function* (locator: ManagedAssetLocator) {
	const [row] = yield* (yield* DatabaseSession).run((db) =>
		db
			.select({
				retiredAt: tables.managedAsset.retiredAt,
				deferred: sql<boolean>`${tables.managedAsset.checkAfter} > now() + interval '23 hours'`,
			})
			.from(tables.managedAsset)
			.where(
				and(
					eq(tables.managedAsset.provider, locator.type),
					eq(tables.managedAsset.key, locator.key),
				),
			),
	);
	return row ?? null;
});

const due = new Date(0);
const future = new Date("2999-01-01T00:00:00.000Z");

layer(testLayer)((test) => {
	test.effect("deletes due unreferenced assets and keeps referenced and fresh ones", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const collector = yield* ManagedAssetCollector;
			const deletions = yield* ObjectDeletions;
			const ownerUserId = UserId.make(crypto.randomUUID());
			const abandoned = yield* insertAsset(ownerUserId, due);
			const referenced = yield* insertAsset(ownerUserId, due);
			const fresh = yield* insertAsset(ownerUserId, future);
			yield* session.run((db) =>
				db
					.insert(tables.savedView)
					.values({
						icon: "view",
						name: "Reference",
						userId: ownerUserId,
						slug: crypto.randomUUID(),
						settings: { cover: referenced },
						renderer: { kind: "kernel", name: "entity-browser" },
					}),
			);

			yield* collector.runBatch(100);

			expect(yield* readAsset(abandoned)).toBeNull();
			expect(yield* deletions.deleted).toContain(abandoned.key);
			expect(yield* readAsset(referenced)).toEqual({ deferred: true, retiredAt: null });
			expect(yield* readAsset(fresh)).toEqual({ deferred: true, retiredAt: null });
			expect(yield* deletions.deleted).not.toContain(referenced.key);
			expect(yield* deletions.deleted).not.toContain(fresh.key);
		}),
	);

	test.effect("keeps a retired row until its object deletion succeeds", () =>
		Effect.gen(function* () {
			const collector = yield* ManagedAssetCollector;
			const deletions = yield* ObjectDeletions;
			const locator = yield* insertAsset(UserId.make(crypto.randomUUID()), due);

			yield* deletions.failFor(locator.key);
			yield* collector.runBatch(100);
			expect((yield* readAsset(locator))?.retiredAt).toBeInstanceOf(Date);

			yield* deletions.failFor(null);
			yield* collector.runBatch(100);
			expect(yield* readAsset(locator)).toBeNull();
			expect(yield* deletions.deleted).toContain(locator.key);
		}),
	);
});
