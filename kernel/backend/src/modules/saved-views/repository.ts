import {
	builtinSavedViewReference,
	type SavedViewReference,
} from "@ryot-app/contract/modules/plugins/references";
import type { ListedSavedView } from "@ryot-app/contract/modules/saved-views/schemas";
import { SavedViewId, type UserId } from "@ryot-app/contract/schema/brands";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { EffectPgDatabase } from "drizzle-orm/effect-postgres";
import { Context, Effect, Layer } from "effect";

import { mapDatabaseErrors } from "#lib/infrastructure/db/errors";
import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";

type ListedSavedViewRow = typeof schema.userSavedViewEffective.$inferSelect;

type CreateSavedViewInput = {
	readonly slug: string;
	readonly name: string;
	readonly icon: string;
	readonly userId: UserId;
	readonly pluginInstallationId?: string | null | undefined;
	readonly dataSources?: (typeof schema.savedView.$inferSelect)["dataSources"];
	readonly renderer: (typeof schema.savedView.$inferSelect)["renderer"];
	readonly settings: (typeof schema.savedView.$inferSelect)["settings"];
};

type UpdateSavedViewData = {
	readonly icon: string;
	readonly name: string;
	readonly isHidden: boolean;
	readonly sortOrder?: number | undefined;
	readonly pluginInstallationId: string | null;
	readonly renderer: (typeof schema.savedView.$inferSelect)["renderer"];
	readonly settings: (typeof schema.savedView.$inferSelect)["settings"];
	readonly dataSources?: (typeof schema.savedView.$inferSelect)["dataSources"];
};

const toListedSavedView = (row: ListedSavedViewRow): ListedSavedView => {
	const base = {
		slug: row.slug,
		name: row.name,
		icon: row.icon,
		renderer: row.renderer,
		settings: row.settings,
		isHidden: row.isHidden,
		sortOrder: row.sortOrder,
		id: SavedViewId.make(row.id),
		dataSources: row.dataSources,
		reference: savedViewReference(row),
		pluginInstallationId: row.pluginInstallationId,
	};
	if (row.isBuiltin) {
		return { ...base, isBuiltin: true, createdAt: null, updatedAt: null };
	}
	if (row.createdAt === null || row.updatedAt === null) {
		throw new Error("Custom saved view has no creation or update timestamp");
	}
	return {
		...base,
		isBuiltin: false,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
};

const savedViewReference = (
	row: Pick<ListedSavedViewRow, "id" | "isBuiltin" | "pluginId" | "slug">,
): SavedViewReference => {
	if (!row.isBuiltin) {
		return { kind: "custom", savedViewId: SavedViewId.make(row.id) };
	}
	return builtinSavedViewReference(row.pluginId, row.slug);
};

const referencePredicate = (reference: SavedViewReference) =>
	reference.kind === "custom"
		? and(
				eq(schema.userSavedViewEffective.isBuiltin, false),
				eq(schema.userSavedViewEffective.id, reference.savedViewId),
			)
		: and(
				eq(schema.userSavedViewEffective.isBuiltin, true),
				eq(schema.userSavedViewEffective.slug, reference.slug),
				reference.kind === "kernel"
					? isNull(schema.userSavedViewEffective.pluginId)
					: eq(schema.userSavedViewEffective.pluginId, reference.pluginId),
			);

const withSavedViewScope = (pluginInstallationId?: string) =>
	pluginInstallationId
		? eq(schema.savedView.pluginInstallationId, pluginInstallationId)
		: isNull(schema.savedView.pluginInstallationId);

export class SavedViewsRepository extends Context.Service<SavedViewsRepository>()(
	"SavedViewsRepository",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const hasCustomInstallationReferences = Effect.fn(
				"SavedViewsRepository.hasCustomInstallationReferences",
			)(function* (userId: UserId, pluginInstallationId: string) {
				const [row] = yield* session.run((db) =>
					db
						.select({ id: schema.savedView.id })
						.from(schema.savedView)
						.where(
							and(
								eq(schema.savedView.userId, userId),
								eq(schema.savedView.pluginInstallationId, pluginInstallationId),
							),
						)
						.limit(1),
				);
				return row !== undefined;
			});

			const listForBackup = Effect.fn("SavedViewsRepository.listForBackup")(function* (
				userId: UserId,
			) {
				const rows = yield* session.run((db) =>
					db
						.select()
						.from(schema.userSavedViewEffective)
						.where(eq(schema.userSavedViewEffective.userId, userId))
						.orderBy(asc(schema.userSavedViewEffective.id)),
				);
				return rows.map((row) =>
					Object.assign(toListedSavedView(row), { pluginInstallationId: row.pluginInstallationId }),
				);
			});

			const listByUser = Effect.fn("SavedViewsRepository.listByUser")(function* (
				userId: UserId,
				input: { pluginInstallationId?: string | undefined; includeHidden: boolean },
			) {
				const clauses = [eq(schema.userSavedViewEffective.userId, userId)];

				if (!input.includeHidden) {
					clauses.push(eq(schema.userSavedViewEffective.isHidden, false));
				}

				if (input.pluginInstallationId) {
					clauses.push(
						eq(schema.userSavedViewEffective.pluginInstallationId, input.pluginInstallationId),
					);
				}

				const rows = yield* session.run((db) =>
					db
						.select()
						.from(schema.userSavedViewEffective)
						.where(and(...clauses))
						.orderBy(
							asc(schema.userSavedViewEffective.packageId),
							asc(schema.userSavedViewEffective.sortOrder),
							asc(schema.userSavedViewEffective.slug),
						),
				);

				return rows.map(toListedSavedView);
			});

			const findByReference = Effect.fn("SavedViewsRepository.findByReference")(function* (
				userId: UserId,
				reference: SavedViewReference,
			) {
				const [row] = yield* session.run((db) =>
					db
						.select()
						.from(schema.userSavedViewEffective)
						.where(
							and(eq(schema.userSavedViewEffective.userId, userId), referencePredicate(reference)),
						)
						.limit(1),
				);

				return row
					? Object.assign(toListedSavedView(row), {
							pluginId: row.pluginId,
							pluginInstallationId: row.pluginInstallationId,
						})
					: null;
			});

			const lockCustom = Effect.fn("SavedViewsRepository.lockCustom")(function* (
				userId: UserId,
				savedViewId: SavedViewId,
			) {
				const [row] = yield* session.run((db) =>
					db
						.select({ id: schema.savedView.id })
						.from(schema.savedView)
						.where(and(eq(schema.savedView.userId, userId), eq(schema.savedView.id, savedViewId)))
						.for("update", { of: schema.savedView })
						.limit(1),
				);

				return row ? yield* findByReference(userId, { savedViewId, kind: "custom" }) : null;
			});
			const customSlugExists = Effect.fn("SavedViewsRepository.customSlugExists")(function* (
				userId: UserId,
				slug: string,
			) {
				const [row] = yield* session.run((db) =>
					db
						.select({ id: schema.savedView.id })
						.from(schema.savedView)
						.where(and(eq(schema.savedView.userId, userId), eq(schema.savedView.slug, slug)))
						.limit(1),
				);
				return row !== undefined;
			});

			const create = Effect.fn("SavedViewsRepository.create")(function* (
				userId: UserId,
				input: CreateSavedViewInput,
			) {
				const [orderRow] = yield* session.run((db) =>
					db
						.select({ maxSortOrder: sql<number>`coalesce(max(${schema.savedView.sortOrder}), -1)` })
						.from(schema.savedView)
						.where(
							and(
								eq(schema.savedView.userId, userId),
								withSavedViewScope(input.pluginInstallationId ?? undefined),
							),
						),
				);

				const rows = yield* session.run((db) =>
					db
						.insert(schema.savedView)
						.values({
							userId,
							slug: input.slug,
							name: input.name,
							icon: input.icon,
							renderer: input.renderer,
							settings: input.settings,
							dataSources: input.dataSources,
							sortOrder: (orderRow?.maxSortOrder ?? -1) + 1,
							pluginInstallationId: input.pluginInstallationId ?? null,
						})
						.onConflictDoNothing({ target: [schema.savedView.userId, schema.savedView.slug] })
						.returning({ id: schema.savedView.id }),
				);

				return rows[0] ? { id: SavedViewId.make(rows[0].id) } : null;
			});

			const updateCustom = Effect.fn("SavedViewsRepository.updateCustom")(function* (
				userId: UserId,
				savedViewId: SavedViewId,
				data: UpdateSavedViewData,
				currentPluginInstallationId: string | null,
			) {
				return yield* session.run((db) =>
					Effect.gen(function* () {
						let sortOrder = data.sortOrder;
						if (
							sortOrder === undefined &&
							currentPluginInstallationId !== data.pluginInstallationId
						) {
							sortOrder = yield* getNextSortOrder(db, userId, data.pluginInstallationId);
						}

						const [row] = yield* db
							.update(schema.savedView)
							.set({
								icon: data.icon,
								name: data.name,
								renderer: data.renderer,
								settings: data.settings,
								isHidden: data.isHidden,
								dataSources: data.dataSources,
								revision: sql`${schema.savedView.revision} + 1`,
								pluginInstallationId: data.pluginInstallationId,
								...(sortOrder === undefined ? {} : { sortOrder }),
							})
							.where(and(eq(schema.savedView.id, savedViewId), eq(schema.savedView.userId, userId)))
							.returning({ id: schema.savedView.id });

						return row ? { id: SavedViewId.make(row.id) } : null;
					}),
				);
			});

			const setBuiltinState = Effect.fn("SavedViewsRepository.setBuiltinState")(function* (
				userId: UserId,
				reference: Exclude<SavedViewReference, { kind: "custom" }>,
				isHidden: boolean,
				sortOrder: number,
			) {
				const current = yield* findByReference(userId, reference);
				if (!current?.isBuiltin) {
					return null;
				}
				if (current.isHidden === isHidden && current.sortOrder === sortOrder) {
					return current;
				}
				const [definition] = yield* session.run((db) =>
					db
						.select({ sortOrder: schema.userSavedView.sortOrder })
						.from(schema.userSavedView)
						.where(
							and(
								eq(schema.userSavedView.userId, userId),
								eq(schema.userSavedView.slug, reference.slug),
								reference.kind === "kernel"
									? isNull(schema.userSavedView.pluginId)
									: eq(schema.userSavedView.pluginId, reference.pluginId),
							),
						)
						.limit(1),
				);
				if (!definition) {
					return null;
				}
				if (!isHidden && sortOrder === definition.sortOrder) {
					yield* session.run((db) =>
						db
							.delete(schema.savedViewOverride)
							.where(
								and(
									eq(schema.savedViewOverride.userId, userId),
									eq(schema.savedViewOverride.slug, reference.slug),
									reference.kind === "kernel"
										? isNull(schema.savedViewOverride.pluginId)
										: eq(schema.savedViewOverride.pluginId, reference.pluginId),
								),
							),
					);
					return yield* findByReference(userId, reference);
				}
				yield* session.run((db) =>
					db
						.insert(schema.savedViewOverride)
						.values({
							userId,
							isHidden,
							sortOrder,
							slug: reference.slug,
							pluginId: current.pluginId,
						})
						.onConflictDoUpdate({
							set: {
								isHidden,
								sortOrder,
								pluginId: current.pluginId,
								revision: sql`${schema.savedViewOverride.revision} + 1`,
							},
							targetWhere:
								reference.kind === "kernel"
									? sql`${schema.savedViewOverride.pluginId} is null`
									: sql`${schema.savedViewOverride.pluginId} is not null`,
							target:
								reference.kind === "kernel"
									? [schema.savedViewOverride.userId, schema.savedViewOverride.slug]
									: [
											schema.savedViewOverride.userId,
											schema.savedViewOverride.pluginId,
											schema.savedViewOverride.slug,
										],
						}),
				);
				return yield* findByReference(userId, reference);
			});

			const reorderByReferences = Effect.fn("SavedViewsRepository.reorderByReferences")(function* (
				userId: UserId,
				pluginInstallationId: string | null,
				references: ReadonlyArray<SavedViewReference>,
			) {
				let updated = 0;
				for (const [sortOrder, reference] of references.entries()) {
					const view = yield* findByReference(userId, reference);
					if (!view || view.pluginInstallationId !== pluginInstallationId) {
						continue;
					}
					if (reference.kind !== "custom") {
						if (yield* setBuiltinState(userId, reference, view.isHidden, sortOrder)) {
							updated++;
						}
					} else {
						if (view.sortOrder === sortOrder) {
							updated++;
							continue;
						}
						const [row] = yield* session.run((db) =>
							db
								.update(schema.savedView)
								.set({ sortOrder, revision: sql`${schema.savedView.revision} + 1` })
								.where(
									and(
										eq(schema.savedView.userId, userId),
										eq(schema.savedView.id, reference.savedViewId),
									),
								)
								.returning({ slug: schema.savedView.slug }),
						);
						if (row) {
							updated++;
						}
					}
				}
				return updated;
			});

			const deleteCustom = Effect.fn("SavedViewsRepository.deleteCustom")(function* (
				userId: UserId,
				savedViewId: SavedViewId,
			) {
				const [row] = yield* session.run((db) =>
					db
						.delete(schema.savedView)
						.where(and(eq(schema.savedView.id, savedViewId), eq(schema.savedView.userId, userId)))
						.returning({ id: schema.savedView.id }),
				);

				return row ? { id: SavedViewId.make(row.id) } : null;
			});

			return {
				create,
				lockCustom,
				listByUser,
				updateCustom,
				deleteCustom,
				listForBackup,
				findByReference,
				setBuiltinState,
				customSlugExists,
				reorderByReferences,
				hasCustomInstallationReferences,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}

const getNextSortOrder = Effect.fn(function* (
	db: EffectPgDatabase,
	userId: UserId,
	pluginInstallationId: string | null,
) {
	const [orderRow] = yield* mapDatabaseErrors(
		db
			.select({
				maxSortOrder: sql<number>`coalesce(max(${schema.userSavedViewEffective.sortOrder}), -1)`,
			})
			.from(schema.userSavedViewEffective)
			.where(
				and(
					eq(schema.userSavedViewEffective.userId, userId),
					pluginInstallationId
						? eq(schema.userSavedViewEffective.pluginInstallationId, pluginInstallationId)
						: isNull(schema.userSavedViewEffective.pluginInstallationId),
				),
			),
	);

	return (orderRow?.maxSortOrder ?? -1) + 1;
});
