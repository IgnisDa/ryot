import type { ManagedAssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { and, asc, eq, or } from "drizzle-orm";
import { Context, Effect, Schema } from "effect";

import {
	collectManagedAssetLocators,
	managedAssetLocatorKey,
	type ManagedAssetPropertyRecord,
	sortedManagedAssetLocators,
} from "#lib/domain/managed-asset-locators";
import { DatabaseSession } from "#platform/db/session";
import { managedAsset } from "#schema/tables/uploads";

export type OwnedManagedAssetPropertyRecord = ManagedAssetPropertyRecord & {
	readonly ownerUserId: null | UserId;
};

export class ManagedAssetReferenceRejected extends Schema.TaggedError<
	ManagedAssetReferenceRejected,
	{ readonly brand: unique symbol }
>()("ManagedAssetReferenceRejected", {}) {}

const locatorWhere = (locator: ManagedAssetLocator) =>
	and(eq(managedAsset.provider, locator.type), eq(managedAsset.key, locator.key));

export class ManagedAssetReferenceLocker extends Context.Service<ManagedAssetReferenceLocker>()(
	"@ryot-app/kernel-backend/lib/domain/managed-asset-writes/ManagedAssetReferenceLocker",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			// Every locator is checked, not only newly added ones: managed_asset rows are removed only by
			// the owner-account cascade, and only rows owned by that same owner may reference them.
			const check = Effect.fnUntraced(function* (
				records: ReadonlyArray<OwnedManagedAssetPropertyRecord>,
				lock: boolean,
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
					return new Set<number>();
				}
				if (lock) {
					yield* session.requireTransaction;
				}
				const rows = yield* session.run((db) => {
					const query = db
						.select({
							key: managedAsset.key,
							provider: managedAsset.provider,
							retiredAt: managedAsset.retiredAt,
							ownerUserId: managedAsset.ownerUserId,
						})
						.from(managedAsset)
						.where(or(...requested.map(locatorWhere)))
						.orderBy(asc(managedAsset.provider), asc(managedAsset.key));
					return lock ? query.for("share") : query;
				});
				const assets = new Map(
					rows.map(
						(row) => [managedAssetLocatorKey({ key: row.key, type: row.provider }), row] as const,
					),
				);
				return new Set(
					recordLocators.flatMap(({ locators, ownerUserId }, index) =>
						locators.some((locator) => {
							const asset = assets.get(managedAssetLocatorKey(locator));
							return (
								ownerUserId === null ||
								asset?.retiredAt !== null ||
								asset.ownerUserId !== ownerUserId
							);
						})
							? [index]
							: [],
					),
				);
			});
			/** Share-locks every asset the records reference, failing when one may not be referenced. */
			const lock = Effect.fn("ManagedAssetReferenceLocker.lock")(function* (
				records: ReadonlyArray<OwnedManagedAssetPropertyRecord>,
			) {
				const rejected = yield* check(records, true);
				return yield* rejected.size > 0 ? new ManagedAssetReferenceRejected() : Effect.void;
			});
			/** The positions of the records referencing an asset they may not, without locking. */
			const rejected = Effect.fn("ManagedAssetReferenceLocker.rejected")(function* (
				records: ReadonlyArray<OwnedManagedAssetPropertyRecord>,
			) {
				const positions: ReadonlySet<number> = yield* check(records, false);
				return positions;
			});
			return { lock, rejected };
		}),
	},
) {}
