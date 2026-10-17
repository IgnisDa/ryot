import { layer } from "@effect/vitest";
import type { ManagedAssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import { UserId } from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { Effect, Exit } from "effect";
import { assert } from "vitest";

import {
	makeManagedAssetReferenceLocker,
	ManagedAssetReferenceRejected,
	type OwnedManagedAssetPropertyRecord,
} from "#lib/domain/managed-asset-writes";
import {
	insertManagedAsset,
	managedAssetProperty,
} from "#lib/domain/managed-asset-writes.test-support";
import { DatabaseSession } from "#platform/db/session";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

const assetSchema: AppSchema = { fields: { image: managedAssetProperty } };

const newUserId = () => UserId.make(crypto.randomUUID());

const record = (
	ownerUserId: UserId | null,
	locator: ManagedAssetLocator,
): OwnedManagedAssetPropertyRecord => ({
	ownerUserId,
	propertiesSchema: assetSchema,
	properties: { image: locator },
});

const lock = (records: ReadonlyArray<OwnedManagedAssetPropertyRecord>) =>
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const lockAssetReferences = makeManagedAssetReferenceLocker(session);
		return yield* session.transaction(lockAssetReferences(records)).pipe(Effect.exit);
	});

layer(isolatedDatabaseLayer("managed_asset_writes"))((test) => {
	test.effect("accepts a locator owned by the record owner", () =>
		Effect.gen(function* () {
			const owner = newUserId();
			const locator = yield* insertManagedAsset(owner);
			assert(Exit.isSuccess(yield* lock([record(owner, locator)])));
		}),
	);

	test.effect("rejects a locator owned by another user", () =>
		Effect.gen(function* () {
			const owner = newUserId();
			const other = newUserId();
			const locator = yield* insertManagedAsset(other);
			assertExitFails(yield* lock([record(owner, locator)]), new ManagedAssetReferenceRejected());
		}),
	);

	test.effect("rejects a locator without a managed asset row", () =>
		Effect.gen(function* () {
			const owner = newUserId();
			assertExitFails(
				yield* lock([record(owner, { type: "local", key: `permanent/${owner}_missing.png` })]),
				new ManagedAssetReferenceRejected(),
			);
		}),
	);

	test.effect("rejects a retired locator", () =>
		Effect.gen(function* () {
			const owner = newUserId();
			const locator = yield* insertManagedAsset(owner, true);
			assertExitFails(yield* lock([record(owner, locator)]), new ManagedAssetReferenceRejected());
		}),
	);

	test.effect("rejects a managed locator on a record without an owner", () =>
		Effect.gen(function* () {
			const owner = newUserId();
			const locator = yield* insertManagedAsset(owner);
			assertExitFails(yield* lock([record(null, locator)]), new ManagedAssetReferenceRejected());
		}),
	);

	test.effect("rejects a mixed-owner batch when the unowned record carries a locator", () =>
		Effect.gen(function* () {
			const owner = newUserId();
			const owned = yield* insertManagedAsset(owner);
			const shared = yield* insertManagedAsset(owner);
			assertExitFails(
				yield* lock([record(owner, owned), record(null, shared)]),
				new ManagedAssetReferenceRejected(),
			);
		}),
	);

	test.effect("accepts a batch whose records all share the asset owner", () =>
		Effect.gen(function* () {
			const owner = newUserId();
			const first = yield* insertManagedAsset(owner);
			const second = yield* insertManagedAsset(owner);
			assert(Exit.isSuccess(yield* lock([record(owner, first), record(owner, second)])));
		}),
	);
});
