import { conflict, DbError } from "@ryot-app/contract/errors";
import {
	type ManagedAssetLocator,
	UploadBadRequest,
} from "@ryot-app/contract/modules/assets/schemas";
import { UserId } from "@ryot-app/contract/schema/brands";
import { and, asc, eq, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { DatabaseSession } from "#platform/db/session";
import * as schema from "#schema/tables/uploads";

export type RegisterManagedAssetInput = { ownerUserId: UserId } & Omit<
	typeof schema.managedAsset.$inferInsert,
	"createdAt" | "retiredAt" | "checkAfter" | "ownerUserId"
>;

type ManagedAssetRecord = { ownerUserId: UserId } & Omit<
	typeof schema.managedAsset.$inferSelect,
	"checkAfter" | "ownerUserId"
>;

const locatorWhere = (locator: ManagedAssetLocator) =>
	and(eq(schema.managedAsset.provider, locator.type), eq(schema.managedAsset.key, locator.key));

const toRecord = ({
	checkAfter: _checkAfter,
	...row
}: typeof schema.managedAsset.$inferSelect): ManagedAssetRecord => ({
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

			const listDue = Effect.fn("ManagedAssetsRepository.listDue")(function* (limit: number) {
				const rows = yield* session.run((db) =>
					db
						.select({
							key: schema.managedAsset.key,
							type: schema.managedAsset.provider,
							ownerUserId: schema.managedAsset.ownerUserId,
						})
						.from(schema.managedAsset)
						.where(
							and(
								isNull(schema.managedAsset.retiredAt),
								lte(schema.managedAsset.checkAfter, sql`now()`),
							),
						)
						.orderBy(asc(schema.managedAsset.checkAfter))
						.limit(limit),
				);
				return rows.map((row) => ({
					ownerUserId: UserId.make(row.ownerUserId),
					locator: { key: row.key, type: row.type } satisfies ManagedAssetLocator,
				}));
			});

			const lockDue = Effect.fn("ManagedAssetsRepository.lockDue")(function* (
				ownerUserId: UserId,
				locators: ReadonlyArray<ManagedAssetLocator>,
			) {
				yield* session.requireTransaction;
				if (locators.length === 0) {
					return [];
				}
				const rows = yield* session.run((db) =>
					db
						.select({ key: schema.managedAsset.key, type: schema.managedAsset.provider })
						.from(schema.managedAsset)
						.where(
							and(
								or(...locators.map(locatorWhere)),
								eq(schema.managedAsset.ownerUserId, ownerUserId),
								isNull(schema.managedAsset.retiredAt),
								lte(schema.managedAsset.checkAfter, sql`now()`),
							),
						)
						.orderBy(asc(schema.managedAsset.provider), asc(schema.managedAsset.key))
						.for("update", { skipLocked: true }),
				);
				return rows satisfies ReadonlyArray<ManagedAssetLocator>;
			});

			const deferChecks = Effect.fn("ManagedAssetsRepository.deferChecks")(function* (
				locators: ReadonlyArray<ManagedAssetLocator>,
			) {
				if (locators.length === 0) {
					return;
				}
				yield* session.run((db) =>
					db
						.update(schema.managedAsset)
						.set({ checkAfter: sql`now() + interval '24 hours'` })
						.where(or(...locators.map(locatorWhere))),
				);
			});

			const retire = Effect.fn("ManagedAssetsRepository.retire")(function* (
				locators: ReadonlyArray<ManagedAssetLocator>,
			) {
				if (locators.length === 0) {
					return;
				}
				yield* session.run((db) =>
					db
						.update(schema.managedAsset)
						.set({ retiredAt: sql`now()` })
						.where(and(or(...locators.map(locatorWhere)), isNull(schema.managedAsset.retiredAt))),
				);
			});

			const listRetired = Effect.fn("ManagedAssetsRepository.listRetired")(function* (
				limit: number,
			) {
				return yield* session.run((db) =>
					db
						.select({ key: schema.managedAsset.key, type: schema.managedAsset.provider })
						.from(schema.managedAsset)
						.where(isNotNull(schema.managedAsset.retiredAt))
						.orderBy(asc(schema.managedAsset.retiredAt))
						.limit(limit),
				);
			});

			const deleteRetired = Effect.fn("ManagedAssetsRepository.deleteRetired")(function* (
				locator: ManagedAssetLocator,
			) {
				yield* session.run((db) =>
					db
						.delete(schema.managedAsset)
						.where(and(locatorWhere(locator), isNotNull(schema.managedAsset.retiredAt))),
				);
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
				retire,
				listDue,
				lockDue,
				listByOwner,
				deferChecks,
				listRetired,
				getByLocator,
				deleteRetired,
				listByOwnerAndLocators,
				registerPermanentOwnedObject,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
