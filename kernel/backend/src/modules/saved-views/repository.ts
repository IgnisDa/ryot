import {
	builtinSavedViewId,
	builtinSavedViewReference,
	definitionOwner,
	type SavedViewReference,
} from "@ryot-app/contract/modules/plugins/references";
import type { ListedSavedView } from "@ryot-app/contract/modules/saved-views/schemas";
import { SavedViewId, type UserId } from "@ryot-app/contract/schema/brands";
import { and, eq, getTableColumns, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { EffectPgDatabase } from "drizzle-orm/effect-postgres";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { Context, Effect, Layer } from "effect";

import { DefinitionCatalog } from "#modules/definitions/catalog";
import { builtinSavedViewRevision } from "#modules/definitions/catalog-relations";
import { DatabaseSession } from "#platform/db/session";
import * as schema from "#schema/tables/combined";

import type { SavedViewReorderPlan } from "./reorder";

type OverrideInsert = typeof schema.savedViewOverride.$inferInsert;

type ListedSavedViewRow = Omit<typeof schema.savedView.$inferSelect, "createdAt" | "updatedAt"> & {
	readonly isBuiltin: boolean;
	readonly createdAt: null | Date;
	readonly updatedAt: null | Date;
	readonly pluginId: null | string;
	readonly packageId: null | string;
	readonly defaultSortOrder: null | number;
};

const compareText = (left: null | string, right: null | string) => {
	if (left === right) {
		return 0;
	}
	if (left === null) {
		return 1;
	}
	if (right === null) {
		return -1;
	}
	return left < right ? -1 : 1;
};

const listedOrder = (left: ListedSavedViewRow, right: ListedSavedViewRow) =>
	compareText(left.packageId, right.packageId) ||
	left.sortOrder - right.sortOrder ||
	compareText(left.slug, right.slug);

const matchesReference = (reference: SavedViewReference) => (row: ListedSavedViewRow) =>
	reference.kind === "custom"
		? !row.isBuiltin && row.id === reference.savedViewId
		: row.isBuiltin &&
			row.slug === reference.slug &&
			row.pluginId === (reference.kind === "plugin" ? reference.pluginId : null);

const inScope = (pluginInstallationId: null | string) => (row: ListedSavedViewRow) =>
	row.pluginInstallationId === pluginInstallationId;

const nextSortOrder = (rows: ReadonlyArray<ListedSavedViewRow>) =>
	Math.max(-1, ...rows.map(({ sortOrder }) => sortOrder)) + 1;

type CreateSavedViewInput = {
	readonly slug: string;
	readonly name: string;
	readonly icon: string;
	readonly userId: UserId;
	readonly pluginInstallationId?: null | string | undefined;
	readonly sort?: (typeof schema.savedView.$inferSelect)["sort"];
	readonly filter?: (typeof schema.savedView.$inferSelect)["filter"];
	readonly renderer: (typeof schema.savedView.$inferSelect)["renderer"];
	readonly settings: (typeof schema.savedView.$inferSelect)["settings"];
	readonly arguments?: (typeof schema.savedView.$inferSelect)["arguments"];
	readonly dataSources?: (typeof schema.savedView.$inferSelect)["dataSources"];
};

type UpdateSavedViewData = {
	readonly icon: string;
	readonly name: string;
	readonly isHidden: boolean;
	readonly sortOrder?: number | undefined;
	readonly pluginInstallationId: null | string;
	readonly sort?: (typeof schema.savedView.$inferSelect)["sort"];
	readonly filter?: (typeof schema.savedView.$inferSelect)["filter"];
	readonly renderer: (typeof schema.savedView.$inferSelect)["renderer"];
	readonly settings: (typeof schema.savedView.$inferSelect)["settings"];
	readonly arguments?: (typeof schema.savedView.$inferSelect)["arguments"];
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
		arguments: row.arguments,
		id: SavedViewId.make(row.id),
		dataSources: row.dataSources,
		...(row.filter === null ? {} : { filter: row.filter }),
		...(row.sort === null ? {} : { sort: row.sort }),
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
	row: Pick<ListedSavedViewRow, "id" | "slug" | "pluginId" | "isBuiltin">,
): SavedViewReference => {
	if (!row.isBuiltin) {
		return { kind: "custom", savedViewId: SavedViewId.make(row.id) };
	}
	return builtinSavedViewReference(row.pluginId, row.slug);
};

export const upsertSavedViewOverride = (
	db: EffectPgDatabase,
	values: readonly [OverrideInsert, ...OverrideInsert[]],
	set: PgUpdateSetSource<typeof schema.savedViewOverride>,
) =>
	db
		.insert(schema.savedViewOverride)
		.values([...values])
		.onConflictDoUpdate({
			set,
			targetWhere:
				values[0].pluginId == null
					? isNull(schema.savedViewOverride.pluginId)
					: isNotNull(schema.savedViewOverride.pluginId),
			target:
				values[0].pluginId == null
					? [schema.savedViewOverride.userId, schema.savedViewOverride.slug]
					: [
							schema.savedViewOverride.userId,
							schema.savedViewOverride.pluginId,
							schema.savedViewOverride.slug,
						],
		});

const overriddenFieldsSet = {
	isHidden: sql`excluded.is_hidden`,
	sortOrder: sql`excluded.sort_order`,
	revision: sql`${schema.savedViewOverride.revision} + 1`,
};

const overrideKeyMatches = (entry: Pick<OverrideInsert, "slug" | "pluginId">) =>
	and(
		eq(schema.savedViewOverride.slug, entry.slug),
		entry.pluginId == null
			? isNull(schema.savedViewOverride.pluginId)
			: eq(schema.savedViewOverride.pluginId, entry.pluginId),
	);

const isDefaultOverride = (entry: {
	isHidden: boolean;
	sortOrder: number;
	defaultSortOrder: null | number;
}) => !entry.isHidden && entry.sortOrder === entry.defaultSortOrder;

const withSavedViewScope = (pluginInstallationId?: string) =>
	pluginInstallationId
		? eq(schema.savedView.pluginInstallationId, pluginInstallationId)
		: isNull(schema.savedView.pluginInstallationId);

export class SavedViewsRepository extends Context.Service<SavedViewsRepository>()(
	"@ryot-app/kernel-backend/modules/saved-views/repository/SavedViewsRepository",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const catalogs = yield* DefinitionCatalog;

			const listEffective = Effect.fn("SavedViewsRepository.listEffective")(function* (
				userId: UserId,
			) {
				const catalog = yield* catalogs.forUser(userId);
				const custom = yield* session.run((db) =>
					db
						.select({ ...getTableColumns(schema.savedView), packageId: schema.plugin.packageId })
						.from(schema.savedView)
						.leftJoin(
							schema.pluginInstallation,
							eq(schema.pluginInstallation.id, schema.savedView.pluginInstallationId),
						)
						.leftJoin(schema.plugin, eq(schema.plugin.id, schema.pluginInstallation.pluginId))
						.where(eq(schema.savedView.userId, userId)),
				);
				const overrides = yield* session.run((db) =>
					db
						.select()
						.from(schema.savedViewOverride)
						.where(eq(schema.savedViewOverride.userId, userId)),
				);
				const installations = new Map(
					catalog.plugins.map((plugin) => [plugin.pluginId, plugin.installationId]),
				);
				const rows: Array<ListedSavedViewRow> = [
					...custom.map((row) =>
						Object.assign(row, { pluginId: null, isBuiltin: false, defaultSortOrder: null }),
					),
					...catalog.savedViews.map((view) => {
						const override = overrides.find(
							(entry) => entry.slug === view.slug && entry.pluginId === view.pluginId,
						);
						return {
							userId,
							createdAt: null,
							updatedAt: null,
							isBuiltin: true,
							slug: view.slug,
							name: view.name,
							icon: view.icon,
							sort: view.sort,
							filter: view.filter,
							pluginId: view.pluginId,
							renderer: view.renderer,
							settings: view.settings,
							packageId: view.packageId,
							arguments: view.arguments,
							dataSources: view.dataSources,
							defaultSortOrder: view.sortOrder,
							isHidden: override?.isHidden ?? false,
							sortOrder: override?.sortOrder ?? view.sortOrder,
							revision: builtinSavedViewRevision(view.id, override?.revision ?? 0),
							id: builtinSavedViewId(userId, definitionOwner(view.pluginId), view.slug),
							pluginInstallationId:
								view.pluginId === null ? null : (installations.get(view.pluginId) ?? null),
						};
					}),
				];
				return rows;
			});

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
				page?: { readonly limit: number; readonly afterId?: string | undefined },
			) {
				const rows = (yield* listEffective(userId))
					.filter(({ id }) => page?.afterId === undefined || compareText(id, page.afterId) > 0)
					.sort((left, right) => compareText(left.id, right.id))
					.slice(0, page?.limit);
				return rows.map((row) =>
					Object.assign(toListedSavedView(row), { pluginInstallationId: row.pluginInstallationId }),
				);
			});

			const listByUser = Effect.fn("SavedViewsRepository.listByUser")(function* (
				userId: UserId,
				input: { includeHidden: boolean; pluginInstallationId?: string | undefined },
			) {
				return (yield* listEffective(userId))
					.filter(
						(row) =>
							(input.includeHidden || !row.isHidden) &&
							(!input.pluginInstallationId ||
								row.pluginInstallationId === input.pluginInstallationId),
					)
					.sort(listedOrder)
					.map(toListedSavedView);
			});

			const findByReference = Effect.fn("SavedViewsRepository.findByReference")(function* (
				userId: UserId,
				reference: SavedViewReference,
			) {
				const row = (yield* listEffective(userId)).find(matchesReference(reference));
				return row
					? Object.assign(toListedSavedView(row), {
							revision: row.revision,
							pluginId: row.pluginId,
							defaultSortOrder: row.defaultSortOrder,
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
							sort: input.sort,
							filter: input.filter,
							renderer: input.renderer,
							settings: input.settings,
							arguments: input.arguments,
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
				currentPluginInstallationId: null | string,
			) {
				const sortOrder =
					data.sortOrder === undefined && currentPluginInstallationId !== data.pluginInstallationId
						? nextSortOrder(
								(yield* listEffective(userId)).filter(inScope(data.pluginInstallationId)),
							)
						: data.sortOrder;
				return yield* session.run((db) =>
					Effect.gen(function* () {
						const [row] = yield* db
							.update(schema.savedView)
							.set({
								icon: data.icon,
								name: data.name,
								sort: data.sort,
								filter: data.filter,
								renderer: data.renderer,
								settings: data.settings,
								isHidden: data.isHidden,
								arguments: data.arguments,
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
				const defaultSortOrder = current.defaultSortOrder;
				if (defaultSortOrder === null) {
					return null;
				}
				if (isDefaultOverride({ isHidden, sortOrder, defaultSortOrder })) {
					yield* session.run((db) =>
						db
							.delete(schema.savedViewOverride)
							.where(
								and(
									eq(schema.savedViewOverride.userId, userId),
									overrideKeyMatches({
										slug: reference.slug,
										pluginId: reference.kind === "kernel" ? null : reference.pluginId,
									}),
								),
							),
					);
					return yield* findByReference(userId, reference);
				}
				yield* session.run((db) =>
					upsertSavedViewOverride(
						db,
						[{ userId, isHidden, sortOrder, slug: reference.slug, pluginId: current.pluginId }],
						overriddenFieldsSet,
					),
				);
				return yield* findByReference(userId, reference);
			});

			const listReorderScope = Effect.fn("SavedViewsRepository.listReorderScope")(function* (
				userId: UserId,
				pluginInstallationId: null | string,
			) {
				return (yield* listEffective(userId))
					.filter(inScope(pluginInstallationId))
					.sort(listedOrder)
					.map((row) => ({
						isHidden: row.isHidden,
						sortOrder: row.sortOrder,
						reference: savedViewReference(row),
						defaultSortOrder: row.defaultSortOrder,
					}));
			});

			const persistReorder = Effect.fn("SavedViewsRepository.persistReorder")(function* (
				userId: UserId,
				pluginInstallationId: null | string,
				plan: SavedViewReorderPlan,
			) {
				const custom: Array<Pick<typeof schema.savedView.$inferSelect, "id" | "sortOrder">> = [];
				const defaults: OverrideInsert[] = [];
				const overrides: OverrideInsert[] = [];
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
						if (isDefaultOverride(entry)) {
							defaults.push(value);
						} else {
							overrides.push(value);
						}
					}
				}
				if (custom.length > 0) {
					yield* session.run((db) =>
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
							),
					);
				}
				if (defaults.length > 0) {
					yield* session.run((db) =>
						db
							.delete(schema.savedViewOverride)
							.where(
								and(
									eq(schema.savedViewOverride.userId, userId),
									or(...defaults.map(overrideKeyMatches)),
								),
							),
					);
				}
				for (const kernel of [true, false]) {
					const [first, ...rest] = overrides.filter(
						(entry) => (entry.pluginId === null) === kernel,
					);
					if (first === undefined) {
						continue;
					}
					yield* session.run((db) =>
						upsertSavedViewOverride(db, [first, ...rest], overriddenFieldsSet),
					);
				}
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
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(DefinitionCatalog.layer),
	);
}
