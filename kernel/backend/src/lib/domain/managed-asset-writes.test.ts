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
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

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

const createUser = Effect.fn(function* () {
	const session = yield* DatabaseSession;
	const id = UserId.make(crypto.randomUUID());
	yield* session.run((db) =>
		db.insert(tables.user).values({ id, name: "Asset owner", email: `${id}@example.test` }),
	);
	return id;
});

const createAsset = Effect.fn(function* (ownerUserId: UserId, retired = false) {
	const session = yield* DatabaseSession;
	const locator: ManagedAssetLocator = {
		type: "s3",
		key: `permanent/${ownerUserId}_${crypto.randomUUID()}.png`,
	};
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
				retiredAt: retired ? new Date() : null,
			}),
	);
	return locator;
});

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
			const owner = yield* createUser();
			const locator = yield* createAsset(owner);
			assert(Exit.isSuccess(yield* lock([record(owner, locator)])));
		}),
	);

	test.effect("rejects a locator owned by another user", () =>
		Effect.gen(function* () {
			const owner = yield* createUser();
			const other = yield* createUser();
			const locator = yield* createAsset(other);
			assertExitFails(yield* lock([record(owner, locator)]), new ManagedAssetReferenceRejected());
		}),
	);

	test.effect("rejects a locator without a managed asset row", () =>
		Effect.gen(function* () {
			const owner = yield* createUser();
			assertExitFails(
				yield* lock([record(owner, { type: "local", key: `permanent/${owner}_missing.png` })]),
				new ManagedAssetReferenceRejected(),
			);
		}),
	);

	test.effect("rejects a retired locator", () =>
		Effect.gen(function* () {
			const owner = yield* createUser();
			const locator = yield* createAsset(owner, true);
			assertExitFails(yield* lock([record(owner, locator)]), new ManagedAssetReferenceRejected());
		}),
	);

	test.effect("rejects a managed locator on a record without an owner", () =>
		Effect.gen(function* () {
			const owner = yield* createUser();
			const locator = yield* createAsset(owner);
			assertExitFails(yield* lock([record(null, locator)]), new ManagedAssetReferenceRejected());
		}),
	);

	test.effect("rejects a mixed-owner batch when the unowned record carries a locator", () =>
		Effect.gen(function* () {
			const owner = yield* createUser();
			const owned = yield* createAsset(owner);
			const shared = yield* createAsset(owner);
			assertExitFails(
				yield* lock([record(owner, owned), record(null, shared)]),
				new ManagedAssetReferenceRejected(),
			);
		}),
	);

	test.effect("accepts a batch whose records all share the asset owner", () =>
		Effect.gen(function* () {
			const owner = yield* createUser();
			const first = yield* createAsset(owner);
			const second = yield* createAsset(owner);
			assert(Exit.isSuccess(yield* lock([record(owner, first), record(owner, second)])));
		}),
	);
});
