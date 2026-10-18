import type { ManagedAssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer } from "effect";

import { managedAssetLocatorKey } from "#lib/domain/managed-asset-locators";
import { DatabaseSession } from "#platform/db/session";

import { ManagedAssetReferencesRepository } from "./managed-asset-references-repository";
import { ManagedAssetsRepository } from "./managed-assets-repository";
import { ObjectStorageService } from "./object-storage";

export class ManagedAssetCollector extends Context.Service<ManagedAssetCollector>()(
	"ManagedAssetCollector",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const objectStorage = yield* ObjectStorageService;
			const repository = yield* ManagedAssetsRepository;
			const references = yield* ManagedAssetReferencesRepository;

			const checkOwner = Effect.fn("ManagedAssetCollector.checkOwner")(function* (
				ownerUserId: UserId,
				locators: ReadonlyArray<ManagedAssetLocator>,
			) {
				yield* session.transaction(
					Effect.gen(function* () {
						const due = yield* repository.lockDue(ownerUserId, locators);
						const referenced = new Set(
							(yield* references.referencedLocators(ownerUserId, due)).map(managedAssetLocatorKey),
						);
						yield* repository.deferChecks(
							due.filter((locator) => referenced.has(managedAssetLocatorKey(locator))),
						);
						yield* repository.retire(
							due.filter((locator) => !referenced.has(managedAssetLocatorKey(locator))),
						);
					}),
				);
			});

			const purge = Effect.fn("ManagedAssetCollector.purge")(function* (
				locator: ManagedAssetLocator,
			) {
				yield* objectStorage.deleteObject(locator);
				yield* repository.deleteRetired(locator);
			});

			const runBatch = Effect.fn("ManagedAssetCollector.runBatch")(function* (limit: number) {
				const due = yield* repository.listDue(limit);
				const byOwner = Map.groupBy(due, ({ ownerUserId }) => ownerUserId);
				yield* Effect.forEach(byOwner, ([ownerUserId, assets]) =>
					checkOwner(
						ownerUserId,
						assets.map(({ locator }) => locator),
					).pipe(
						Effect.catchCause((cause) =>
							Effect.logWarning("managed asset reference check failed", cause).pipe(
								Effect.annotateLogs({ ownerUserId }),
							),
						),
					),
				);
				const retired = yield* repository.listRetired(limit);
				yield* Effect.forEach(retired, (locator) =>
					purge(locator).pipe(
						Effect.catchCause((cause) =>
							Effect.logWarning("managed asset deletion failed", cause).pipe(
								Effect.annotateLogs({ key: locator.key, provider: locator.type }),
							),
						),
					),
				);
			});

			return { runBatch };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
