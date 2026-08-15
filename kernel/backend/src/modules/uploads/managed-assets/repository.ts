import { conflict, DbError } from "@ryot-app/contract/errors";
import type { ManagedAssetLocator } from "@ryot-app/contract/modules/uploads/schemas";
import { UserId } from "@ryot-app/contract/schema/brands";
import { and, eq, or } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/uploads";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";

type ManagedAssetRecord = Omit<typeof schema.managedAsset.$inferSelect, "ownerUserId"> & {
	ownerUserId: UserId;
};

export type RegisterManagedAssetInput = Omit<
	typeof schema.managedAsset.$inferInsert,
	"createdAt" | "ownerUserId"
> & { ownerUserId: UserId };

const locatorWhere = (locator: ManagedAssetLocator) =>
	and(eq(schema.managedAsset.provider, locator.type), eq(schema.managedAsset.key, locator.key));

const toRecord = (row: typeof schema.managedAsset.$inferSelect): ManagedAssetRecord => ({
	...row,
	ownerUserId: UserId.make(row.ownerUserId),
});

const isIdenticalRegistration = (existing: ManagedAssetRecord, input: RegisterManagedAssetInput) =>
	existing.key === input.key &&
	existing.size === input.size &&
	existing.sha256 === input.sha256 &&
	existing.contentType === input.contentType &&
	existing.ownerUserId === input.ownerUserId &&
	existing.provider === input.provider;

export class ManagedAssetsRepository extends Context.Service<ManagedAssetsRepository>()(
	"ManagedAssetsRepository",
	{
		make: Effect.sync(() => {
			const getByLocator = Effect.fn("ManagedAssetsRepository.getByLocator")(function* (
				locator: ManagedAssetLocator,
			) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db.select().from(schema.managedAsset).where(locatorWhere(locator)).limit(1),
				);
				return row ? toRecord(row) : null;
			});

			const registerPermanentOwnedObject = Effect.fn(
				"ManagedAssetsRepository.registerPermanentOwnedObject",
			)(function* (input: RegisterManagedAssetInput) {
				const db = yield* Database;
				const [inserted] = yield* mapDatabaseErrors(
					db
						.insert(schema.managedAsset)
						.values(input)
						.onConflictDoNothing({
							target: [schema.managedAsset.provider, schema.managedAsset.key],
						})
						.returning(),
				);
				if (inserted) {
					return toRecord(inserted);
				}
				const existing = yield* getByLocator({ key: input.key, type: input.provider });
				if (!existing) {
					return yield* new DbError({ message: "Managed asset insert conflict but not found" });
				}
				if (!isIdenticalRegistration(existing, input)) {
					return yield* conflict("Managed asset locator is already registered");
				}
				return existing;
			});

			const listByOwner = Effect.fn("ManagedAssetsRepository.listByOwner")(function* (
				ownerUserId: UserId,
			) {
				const db = yield* Database;
				const rows = yield* mapDatabaseErrors(
					db
						.select()
						.from(schema.managedAsset)
						.where(eq(schema.managedAsset.ownerUserId, ownerUserId)),
				);
				return rows.map(toRecord);
			});

			const listByOwnerAndLocators = Effect.fn("ManagedAssetsRepository.listByOwnerAndLocators")(
				function* (ownerUserId: UserId, locators: ReadonlyArray<ManagedAssetLocator>) {
					if (locators.length === 0) {
						return [];
					}
					const db = yield* Database;
					const rows = yield* mapDatabaseErrors(
						db
							.select()
							.from(schema.managedAsset)
							.where(
								and(
									eq(schema.managedAsset.ownerUserId, ownerUserId),
									or(...locators.map(locatorWhere)),
								),
							),
					);
					return rows.map(toRecord);
				},
			);

			return { listByOwner, getByLocator, listByOwnerAndLocators, registerPermanentOwnedObject };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
