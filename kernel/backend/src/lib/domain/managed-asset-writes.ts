import type { ManagedAssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import { and, asc, eq, or } from "drizzle-orm";
import { Effect } from "effect";

import {
	collectManagedAssetLocators,
	type ManagedAssetPropertyRecord,
} from "#lib/domain/managed-asset-locators";
import type { DatabaseSession } from "#platform/db/session";
import { managedAsset } from "#schema/tables/uploads";

const locatorWhere = (locator: ManagedAssetLocator) =>
	and(eq(managedAsset.provider, locator.type), eq(managedAsset.key, locator.key));

export const makeManagedAssetReferenceLocker = (session: DatabaseSession["Service"]) =>
	Effect.fn(function* (records: ReadonlyArray<ManagedAssetPropertyRecord>) {
		const locators = collectManagedAssetLocators(records, true);
		if (locators.length === 0) {
			return false;
		}
		yield* session.requireTransaction;
		const rows = yield* session.run((db) =>
			db
				.select({ retiredAt: managedAsset.retiredAt })
				.from(managedAsset)
				.where(or(...locators.map(locatorWhere)))
				.orderBy(asc(managedAsset.provider), asc(managedAsset.key))
				.for("share"),
		);
		return rows.some(({ retiredAt }) => retiredAt !== null);
	});

export type ManagedAssetReferenceLocker = ReturnType<typeof makeManagedAssetReferenceLocker>;
