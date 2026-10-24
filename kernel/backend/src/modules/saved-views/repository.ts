import {
	builtinSavedViewReference,
	type SavedViewReference,
} from "@ryot-app/contract/modules/plugins/references";
import type { ListedSavedView } from "@ryot-app/contract/modules/saved-views/schemas";
import { SavedViewId, type UserId } from "@ryot-app/contract/schema/brands";
import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { EffectPgDatabase } from "drizzle-orm/effect-postgres";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { Context, Effect, Layer } from "effect";

import { savedViewReferenceWhere } from "#platform/db/definition-owner";
import { mapDatabaseErrors } from "#platform/db/errors";
import { DatabaseSession } from "#platform/db/session";
import * as schema from "#schema/tables/combined";

import type { SavedViewReorderPlan } from "./reorder";

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

export const upsertSavedViewOverride = (
	db: EffectPgDatabase,
	values: typeof schema.savedViewOverride.$inferInsert,
	set: PgUpdateSetSource<typeof schema.savedViewOverride>,
) =>
	db
		.insert(schema.savedViewOverride)
		.values(values)
		.onConflictDoUpdate({
			set,
			targetWhere:
				values.pluginId == null
					? isNull(schema.savedViewOverride.pluginId)
					: isNotNull(schema.savedViewOverride.pluginId),
			target:
				values.pluginId == null
					? [schema.savedViewOverride.userId, schema.savedViewOverride.slug]
					: [
							schema.savedViewOverride.userId,
							schema.savedViewOverride.pluginId,
							schema.savedViewOverride.slug,
						],
		});

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
							and(
								eq(schema.userSavedViewEffective.userId, userId),
								savedViewReferenceWhere(reference),
							),
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
					upsertSavedViewOverride(
						db,
						{ userId, isHidden, sortOrder, slug: reference.slug, pluginId: current.pluginId },
						{
							isHidden,
							sortOrder,
							pluginId: current.pluginId,
							revision: sql`${schema.savedViewOverride.revision} + 1`,
						},
					),
				);
				return yield* findByReference(userId, reference);
			});

			const listReorderScope = Effect.fn("SavedViewsRepository.listReorderScope")(function* (
				userId: UserId,
				pluginInstallationId: string | null,
			) {
				const view = schema.userSavedViewEffective;
				const definition = schema.userSavedView;
				const rows = yield* session.run((db) =>
					db
						.select({
							id: view.id,
							slug: view.slug,
							pluginId: view.pluginId,
							isHidden: view.isHidden,
							isBuiltin: view.isBuiltin,
							sortOrder: view.sortOrder,
							defaultSortOrder: definition.sortOrder,
						})
						.from(view)
						.leftJoin(
							definition,
							and(
								eq(view.isBuiltin, true),
								eq(definition.userId, view.userId),
								eq(definition.slug, view.slug),
								sql`${definition.pluginId} is not distinct from ${view.pluginId}`,
							),
						)
						.where(
							and(
								eq(view.userId, userId),
								pluginInstallationId === null
									? isNull(view.pluginInstallationId)
									: eq(view.pluginInstallationId, pluginInstallationId),
							),
						)
						.orderBy(asc(view.packageId), asc(view.sortOrder), asc(view.slug)),
				);
				return rows.map((row) => ({
					isHidden: row.isHidden,
					sortOrder: row.sortOrder,
					reference: savedViewReference(row),
					defaultSortOrder: row.defaultSortOrder,
				}));
			});

			const persistReorder = Effect.fn("SavedViewsRepository.persistReorder")(function* (
				userId: UserId,
				pluginInstallationId: string | null,
				plan: SavedViewReorderPlan,
			) {
				const custom: Array<Pick<typeof schema.savedView.$inferSelect, "id" | "sortOrder">> = [];
				const defaults: Array<typeof schema.savedViewOverride.$inferInsert> = [];
				const overrides: Array<typeof schema.savedViewOverride.$inferInsert> = [];
				for (const entry of plan) {
					if (entry.currentSortOrder === entry.sortOrder) {
						continue;
					}
					if (entry.reference.kind === "custom") {
						custom.push({ sortOrder: entry.sortOrder, id: entry.reference.savedViewId });
					} else {
						const value = {
							userId,
							isHidden: entry.isHidden,
							slug: entry.reference.slug,
							sortOrder: entry.sortOrder,
							pluginId: entry.reference.kind === "kernel" ? null : entry.reference.pluginId,
						};
						if (!entry.isHidden && entry.sortOrder === entry.defaultSortOrder) {
							defaults.push(value);
						} else {
							overrides.push(value);
						}
					}
				}
				let updated = 0;
				if (custom.length > 0) {
					const rows = yield* session.run((db) =>
						db
							.update(schema.savedView)
							.set({
								revision: sql`${schema.savedView.revision} + 1`,
								sortOrder: sql`case ${schema.savedView.id} ${sql.join(
									custom.map((entry) => sql`when ${entry.id} then ${entry.sortOrder}::integer`),
									sql` `,
								)} end`,
							})
							.where(
								and(
									eq(schema.savedView.userId, userId),
									withSavedViewScope(pluginInstallationId ?? undefined),
									inArray(
										schema.savedView.id,
										custom.map((entry) => entry.id),
									),
								),
							)
							.returning({ id: schema.savedView.id }),
					);
					updated += rows.length;
				}
				if (defaults.length > 0) {
					const rows = yield* session.run((db) =>
						db
							.delete(schema.savedViewOverride)
							.where(
								and(
									eq(schema.savedViewOverride.userId, userId),
									or(
										...defaults.map((entry) =>
											and(
												eq(schema.savedViewOverride.slug, entry.slug),
												entry.pluginId == null
													? isNull(schema.savedViewOverride.pluginId)
													: eq(schema.savedViewOverride.pluginId, entry.pluginId),
											),
										),
									),
								),
							)
							.returning({ slug: schema.savedViewOverride.slug }),
					);
					updated += rows.length;
				}
				for (const kernel of [true, false]) {
					const values = overrides.filter((entry) => (entry.pluginId === null) === kernel);
					if (values.length === 0) {
						continue;
					}
					const rows = yield* session.run((db) =>
						db
							.insert(schema.savedViewOverride)
							.values(values)
							.onConflictDoUpdate({
								targetWhere: kernel
									? isNull(schema.savedViewOverride.pluginId)
									: isNotNull(schema.savedViewOverride.pluginId),
								set: {
									isHidden: sql`excluded.is_hidden`,
									sortOrder: sql`excluded.sort_order`,
									revision: sql`${schema.savedViewOverride.revision} + 1`,
								},
								target: kernel
									? [schema.savedViewOverride.userId, schema.savedViewOverride.slug]
									: [
											schema.savedViewOverride.userId,
											schema.savedViewOverride.pluginId,
											schema.savedViewOverride.slug,
										],
							})
							.returning({ slug: schema.savedViewOverride.slug }),
					);
					updated += rows.length;
				}
				return updated === custom.length + defaults.length + overrides.length;
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
				persistReorder,
				findByReference,
				setBuiltinState,
				customSlugExists,
				listReorderScope,
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
