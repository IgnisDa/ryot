import { conflict, DbError } from "@ryot-app/contract/errors";
import {
	type ManagedAssetLocator,
	UploadBadRequest,
} from "@ryot-app/contract/modules/assets/schemas";
import { UserId } from "@ryot-app/contract/schema/brands";
import { and, eq, isNull, or } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { DatabaseSession } from "#platform/db/session";
import * as schema from "#schema/tables/uploads";

export type RegisterManagedAssetInput = { ownerUserId: UserId } & Omit<
	typeof schema.managedAsset.$inferInsert,
	"createdAt" | "retiredAt" | "ownerUserId"
>;

type ManagedAssetRecord = { ownerUserId: UserId } & Omit<
	typeof schema.managedAsset.$inferSelect,
	"ownerUserId"
>;

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
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const getByLocator = Effect.fn("ManagedAssetsRepository.getByLocator")(function* (
				locator: ManagedAssetLocator,
			) {
				const [row] = yield* session.run((db) =>
					db.select().from(schema.managedAsset).where(locatorWhere(locator)).limit(1),
				);
				return row ? toRecord(row) : null;
			});
			const lockByLocator = Effect.fn("ManagedAssetsRepository.lockByLocator")(function* (
				locator: ManagedAssetLocator,
			) {
				yield* session.requireTransaction;
				const [row] = yield* session.run((db) =>
					db.select().from(schema.managedAsset).where(locatorWhere(locator)).limit(1).for("update"),
				);
				return row ? toRecord(row) : null;
			});

			const retireOwned = Effect.fn("ManagedAssetsRepository.retireOwned")(function* (
				ownerUserId: UserId,
				locator: ManagedAssetLocator,
			) {
				yield* session.requireTransaction;
				const [row] = yield* session.run((db) =>
					db
						.update(schema.managedAsset)
						.set({ retiredAt: new Date() })
						.where(
							and(
								locatorWhere(locator),
								eq(schema.managedAsset.ownerUserId, ownerUserId),
								isNull(schema.managedAsset.retiredAt),
							),
						)
						.returning({ key: schema.managedAsset.key }),
				);
				return row !== undefined;
			});

			const registerPermanentOwnedObject = Effect.fn(
				"ManagedAssetsRepository.registerPermanentOwnedObject",
			)(function* (input: RegisterManagedAssetInput) {
				const [inserted] = yield* session.run((db) =>
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
				const existing = yield* lockByLocator({ key: input.key, type: input.provider });
				if (!existing) {
					return yield* new DbError({ message: "Managed asset insert conflict but not found" });
				}
				if (existing.retiredAt !== null) {
					return yield* new UploadBadRequest({ reason: { code: "asset-forbidden" } });
				}
				if (!isIdenticalRegistration(existing, input)) {
					return yield* conflict("Managed asset locator is already registered");
				}
				return existing;
			});

			const listByOwner = Effect.fn("ManagedAssetsRepository.listByOwner")(function* (
				ownerUserId: UserId,
			) {
				const rows = yield* session.run((db) =>
					db
						.select()
						.from(schema.managedAsset)
						.where(
							and(
								eq(schema.managedAsset.ownerUserId, ownerUserId),
								isNull(schema.managedAsset.retiredAt),
							),
						),
				);
				return rows.map(toRecord);
			});

			const listByOwnerAndLocators = Effect.fn("ManagedAssetsRepository.listByOwnerAndLocators")(
				function* (ownerUserId: UserId, locators: ReadonlyArray<ManagedAssetLocator>) {
					if (locators.length === 0) {
						return [];
					}
					const rows = yield* session.run((db) =>
						db
							.select()
							.from(schema.managedAsset)
							.where(
								and(
									eq(schema.managedAsset.ownerUserId, ownerUserId),
									isNull(schema.managedAsset.retiredAt),
									or(...locators.map(locatorWhere)),
								),
							),
					);
					return rows.map(toRecord);
				},
			);

			return {
				listByOwner,
				retireOwned,
				getByLocator,
				lockByLocator,
				listByOwnerAndLocators,
				registerPermanentOwnedObject,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
