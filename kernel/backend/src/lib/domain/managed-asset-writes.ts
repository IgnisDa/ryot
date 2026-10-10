import type { ManagedAssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { and, asc, eq, or } from "drizzle-orm";
import { Data, Effect } from "effect";

import {
	collectManagedAssetLocators,
	type ManagedAssetPropertyRecord,
} from "#lib/domain/managed-asset-locators";
import type { DatabaseSession } from "#platform/db/session";
import { managedAsset } from "#schema/tables/uploads";

export class ManagedAssetReferenceRejected extends Data.TaggedError(
	"ManagedAssetReferenceRejected",
)<{}> {}

export type OwnedManagedAssetPropertyRecord = ManagedAssetPropertyRecord & {
	readonly ownerUserId: UserId | null;
};

const locatorWhere = (locator: ManagedAssetLocator) =>
	and(eq(managedAsset.provider, locator.type), eq(managedAsset.key, locator.key));

const locatorKey = (locator: ManagedAssetLocator) => `${locator.type}\0${locator.key}`;

// Every locator is checked, not only newly added ones: managed_asset rows are removed only by the
// owner-account cascade, and only rows owned by that same owner may reference them.
export const makeManagedAssetReferenceLocker = (session: DatabaseSession["Service"]) =>
	Effect.fn(function* (records: ReadonlyArray<OwnedManagedAssetPropertyRecord>) {
		const locators = collectManagedAssetLocators(records, true);
		if (locators.length === 0) {
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
				.where(or(...locators.map(locatorWhere)))
				.orderBy(asc(managedAsset.provider), asc(managedAsset.key))
				.for("share"),
		);
		const assets = new Map(
			rows.map((row) => [locatorKey({ key: row.key, type: row.provider }), row] as const),
		);
		const rejected = records.some((record) =>
			collectManagedAssetLocators([record], true).some((locator) => {
				const asset = assets.get(locatorKey(locator));
				return (
					record.ownerUserId === null ||
					asset?.retiredAt !== null ||
					asset.ownerUserId !== record.ownerUserId
				);
			}),
		);
		return yield* rejected ? new ManagedAssetReferenceRejected() : Effect.void;
	});

export type ManagedAssetReferenceLocker = ReturnType<typeof makeManagedAssetReferenceLocker>;
