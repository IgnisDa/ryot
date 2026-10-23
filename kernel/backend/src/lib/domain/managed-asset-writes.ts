import type { ManagedAssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { and, asc, eq, or } from "drizzle-orm";
import { Context, Data, Effect } from "effect";

import {
	collectManagedAssetLocators,
	managedAssetLocatorKey,
	type ManagedAssetPropertyRecord,
	sortedManagedAssetLocators,
} from "#lib/domain/managed-asset-locators";
import { DatabaseSession } from "#platform/db/session";
import { managedAsset } from "#schema/tables/uploads";

export class ManagedAssetReferenceRejected extends Data.TaggedError(
	"ManagedAssetReferenceRejected",
)<{}> {}

export type OwnedManagedAssetPropertyRecord = ManagedAssetPropertyRecord & {
	readonly ownerUserId: UserId | null;
};

const locatorWhere = (locator: ManagedAssetLocator) =>
	and(eq(managedAsset.provider, locator.type), eq(managedAsset.key, locator.key));

export class ManagedAssetReferenceLocker extends Context.Service<ManagedAssetReferenceLocker>()(
	"ManagedAssetReferenceLocker",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			// Every locator is checked, not only newly added ones: managed_asset rows are removed only by
			// the owner-account cascade, and only rows owned by that same owner may reference them.
			const lock = Effect.fn("ManagedAssetReferenceLocker.lock")(function* (
				records: ReadonlyArray<OwnedManagedAssetPropertyRecord>,
			) {
				const recordLocators = records.map((record) => ({
					ownerUserId: record.ownerUserId,
					locators: collectManagedAssetLocators([record], true),
				}));
				const requested = sortedManagedAssetLocators(
					new Map(
						recordLocators.flatMap((record) =>
							record.locators.map((locator) => [managedAssetLocatorKey(locator), locator] as const),
						),
					),
				);
				if (requested.length === 0) {
					return yield* Effect.void;
				}
				yield* session.requireTransaction;
				const rows = yield* session.run((db) =>
					db
						.select({
							key: managedAsset.key,
							provider: managedAsset.provider,
							retiredAt: managedAsset.retiredAt,
							ownerUserId: managedAsset.ownerUserId,
						})
						.from(managedAsset)
						.where(or(...requested.map(locatorWhere)))
						.orderBy(asc(managedAsset.provider), asc(managedAsset.key))
						.for("share"),
				);
				const assets = new Map(
					rows.map(
						(row) => [managedAssetLocatorKey({ key: row.key, type: row.provider }), row] as const,
					),
				);
				const rejected = recordLocators.some(({ locators, ownerUserId }) =>
					locators.some((locator) => {
						const asset = assets.get(managedAssetLocatorKey(locator));
						return (
							ownerUserId === null || asset?.retiredAt !== null || asset.ownerUserId !== ownerUserId
						);
					}),
				);
				return yield* rejected ? new ManagedAssetReferenceRejected() : Effect.void;
			});
			return { lock };
		}),
	},
) {}
