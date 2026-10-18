import { assert, expect, layer } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import { DbError } from "@ryot-app/contract/errors";
import type { SavedViewReference } from "@ryot-app/contract/modules/plugins/references";
import { SavedViewBadRequest } from "@ryot-app/contract/modules/saved-views/schemas";
import { PluginId, PluginPackageId, SavedViewId, UserId } from "@ryot-app/contract/schema/brands";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { asc, eq, sql } from "drizzle-orm";
import { Context, Effect, Layer, Ref } from "effect";

import {
	recordingDatabaseLayer,
	StatementLog,
} from "#modules/entities/statement-recording.test-support";
import { PluginCatalogInvalidator } from "#modules/plugins/catalog/events";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import { PluginInstallationRepository } from "#modules/plugins/installations/repository";
import { lockPluginIngestionShared } from "#modules/plugins/packages/ingestion-fence";
import { PluginRepository } from "#modules/plugins/packages/repository";
import { fixtureManifest, insertPluginRevision } from "#modules/plugins/test-support";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { SavedViewsRepository } from "./repository";
import { SavedViewsService } from "./service";

const user = {
	image: null,
	name: "Owner",
	id: UserId.make("owner"),
	email: "owner@example.test",
	preferences: { language: null, disableIntegrations: false },
	accountGeneration: { token: "generation", userId: UserId.make("owner") },
} satisfies CurrentUserValue;
const foreignUser = UserId.make("foreign");
const kernel = (slug: string): SavedViewReference => ({ slug, kind: "kernel" });
const custom = (id: string): SavedViewReference => ({
	kind: "custom",
	savedViewId: SavedViewId.make(id),
});
const plugin = (owner: string, slug: string): SavedViewReference => ({
	slug,
	kind: "plugin",
	pluginId: PluginId.make(owner),
});
const renderer = { kind: "kernel", name: "calendar" } as const;
const definition = (slug: string, sortOrder: number, pluginRevisionId: null | string = null) => ({
	slug,
	renderer,
	sortOrder,
	name: slug,
	icon: "box",
	settings: {},
	pluginRevisionId,
	position: sortOrder,
});
const customView = (
	id: string,
	sortOrder: number,
	pluginInstallationId: null | string = null,
	owner = user.id,
) => ({
	id,
	slug: id,
	name: id,
	renderer,
	sortOrder,
	icon: "box",
	settings: {},
	userId: owner,
	pluginInstallationId,
	updatedAt: new Date("2026-01-01T00:00:00.000Z"),
});

class ReorderEvents extends Context.Service<
	ReorderEvents,
	{ readonly events: Effect.Effect<ReadonlyArray<string>> }
>()("test/ReorderEvents") {}

const database = recordingDatabaseLayer().pipe(
	Layer.provideMerge(isolatedDatabaseLayer("saved_view_reorder")),
);
const testLayer = Layer.unwrap(
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const events = yield* Ref.make<ReadonlyArray<string>>([]);
		const record = (event: string) => Ref.update(events, (all) => [...all, event]);
		return SavedViewsService.layer.pipe(
			Layer.provideMerge(
				Layer.mergeAll(
					SavedViewsRepository.layer,
					Layer.mock(PluginRepository)({
						lockIngestionShared: () => lockPluginIngestionShared(session),
					}),
					Layer.mock(PluginInstallationRepository)({}),
					Layer.mock(PluginRuntimeResolver)({
						listPluginsAvailableToUser: () =>
							Effect.succeed(
								["a", "b"].map((name) => ({
									scope: "system",
									health: "ready",
									isHidden: false,
									clientImports: [],
									ownerUserId: null,
									compiledHashes: {},
									id: `plugin-${name}`,
									contentHash: `hash-${name}`,
									manifest: fixtureManifest(),
									pluginConfigRevisionId: null,
									pluginRevisionId: `revision-${name}`,
									installationId: `installation-${name}`,
									packageId: PluginPackageId.make(`test/reorder-${name}`),
								})),
							),
					}),
					Layer.succeed(PluginCatalogInvalidator, {
						all: Effect.void,
						recordAll: Effect.void,
						user: () => record("invalidate"),
						deliverPending: () => Effect.void,
						recordUser: (userId) =>
							session
								.run((db) => db.insert(tables.pluginCatalogChange).values({ userId }))
								.pipe(Effect.asVoid, Effect.orDie),
					}),
					Layer.succeed(ReorderEvents, { events: Ref.get(events) }),
				),
			),
		);
	}),
).pipe(Layer.provideMerge(database));

const seed = Effect.gen(function* () {
	const session = yield* DatabaseSession;
	yield* session.run((db) =>
		Effect.gen(function* () {
			yield* db.delete(tables.savedViewOverride);
			yield* db.delete(tables.savedView);
			yield* db.delete(tables.definitionSavedView);
			yield* db.delete(tables.pluginCatalogChange);
			yield* db.delete(tables.pluginInstallation);
			yield* db.delete(tables.plugin);
			yield* db
				.insert(tables.user)
				.values([
					{ id: user.id, name: user.name, email: user.email, accountGeneration: "generation" },
					{
						id: foreignUser,
						name: "Foreign",
						email: "foreign@example.test",
						accountGeneration: "generation",
					},
				])
				.onConflictDoNothing();
			for (const name of ["a", "b"]) {
				const packageId = PluginPackageId.make(`test/reorder-${name}`);
				yield* db
					.insert(tables.plugin)
					.values({ packageId, status: "inactive", id: `plugin-${name}` });
				yield* insertPluginRevision(db, {
					id: `revision-${name}`,
					pluginId: `plugin-${name}`,
					contentHash: `hash-${name}`,
					manifest: fixtureManifest(packageId),
				});
				yield* db
					.update(tables.plugin)
					.set({ status: "active", activeRevisionId: `revision-${name}` })
					.where(eq(tables.plugin.id, `plugin-${name}`));
				yield* db
					.insert(tables.pluginInstallation)
					.values({
						userId: user.id,
						isInitialized: true,
						id: `installation-${name}`,
						pluginId: `plugin-${name}`,
					});
			}
		}),
	);
});

const stored = Effect.gen(function* () {
	const session = yield* DatabaseSession;
	return yield* session.run((db) =>
		Effect.gen(function* () {
			return {
				changes: yield* db.select().from(tables.pluginCatalogChange),
				custom: yield* db.select().from(tables.savedView).orderBy(asc(tables.savedView.id)),
				overrides: yield* db
					.select()
					.from(tables.savedViewOverride)
					.orderBy(asc(tables.savedViewOverride.pluginId), asc(tables.savedViewOverride.slug)),
			};
		}),
	);
});

layer(testLayer)((test) => {
	test.effect(
		"persists mixed hidden custom/kernel positions once, leaving other users and workspaces unchanged",
		() =>
			Effect.gen(function* () {
				yield* seed;
				const session = yield* DatabaseSession;
				yield* session.run((db) =>
					Effect.gen(function* () {
						yield* db
							.insert(tables.definitionSavedView)
							.values([definition("same", 0), definition("trailing", 1)]);
						yield* db
							.insert(tables.savedView)
							.values([
								{ ...customView("same", 0), isHidden: true },
								customView("workspace", 7, "installation-a"),
								customView("foreign", 9, null, foreignUser),
							]);
						yield* db
							.insert(tables.savedViewOverride)
							.values({ sortOrder: 1, isHidden: true, userId: user.id, slug: "trailing" });
					}),
				);
				const before = yield* stored;
				const events = yield* ReorderEvents;
				const beforeEvents = yield* events.events;
				expect(
					yield* (yield* SavedViewsService).reorder(user, { references: [custom("same")] }),
				).toEqual({ references: [custom("same"), kernel("same"), kernel("trailing")] });
				const after = yield* stored;
				expect(after.custom).toEqual(before.custom);
				expect(after.overrides).toMatchObject([
					{ revision: 1, slug: "same", sortOrder: 1, pluginId: null, isHidden: false },
					{ revision: 2, sortOrder: 2, pluginId: null, isHidden: true, slug: "trailing" },
				]);
				expect(after.changes).toHaveLength(1);
				expect((yield* events.events).slice(beforeEvents.length)).toEqual(["invalidate"]);
			}),
	);

	test.effect(
		"uses one position sequence for plugin builtins and custom views in the exact installation",
		() =>
			Effect.gen(function* () {
				yield* seed;
				const session = yield* DatabaseSession;
				yield* session.run((db) =>
					Effect.gen(function* () {
						yield* db
							.insert(tables.definitionSavedView)
							.values([
								definition("same", 0),
								definition("same", 0, "revision-a"),
								definition("same", 0, "revision-b"),
							]);
						yield* db
							.insert(tables.savedView)
							.values([
								{ ...customView("same", 4, "installation-a"), isHidden: true },
								customView("other", 8, "installation-b"),
							]);
					}),
				);
				expect(
					yield* (yield* SavedViewsService).reorder(user, {
						references: [custom("same")],
						installationId: "installation-a",
					}),
				).toEqual({ references: [custom("same"), plugin("plugin-a", "same")] });
				const state = yield* stored;
				expect(state.custom.find(({ id }) => id === "same")?.isHidden).toBe(true);
				expect(
					state.custom.map(({ id, revision, sortOrder }) => ({ id, revision, sortOrder })),
				).toEqual([
					{ id: "other", revision: 1, sortOrder: 8 },
					{ id: "same", revision: 2, sortOrder: 0 },
				]);
				expect(state.overrides).toEqual([
					{
						revision: 1,
						slug: "same",
						sortOrder: 1,
						userId: user.id,
						isHidden: false,
						pluginId: "plugin-a",
					},
				]);
			}),
	);

	test.effect(
		"restores plugin defaults and upserts hidden state without changing another exact owner",
		() =>
			Effect.gen(function* () {
				yield* seed;
				const session = yield* DatabaseSession;
				yield* session.run((db) =>
					Effect.gen(function* () {
						yield* db
							.insert(tables.definitionSavedView)
							.values([
								definition("visible", 0, "revision-a"),
								definition("hidden", 1, "revision-a"),
								definition("hidden", 0, "revision-b"),
								definition("visible", 0),
							]);
						yield* db.insert(tables.savedViewOverride).values([
							{ revision: 3, sortOrder: 5, userId: user.id, slug: "visible", pluginId: "plugin-a" },
							{
								revision: 4,
								sortOrder: 6,
								slug: "hidden",
								isHidden: true,
								userId: user.id,
								pluginId: "plugin-a",
							},
							{
								revision: 5,
								sortOrder: 7,
								slug: "hidden",
								isHidden: true,
								userId: user.id,
								pluginId: "plugin-b",
							},
							{ revision: 6, sortOrder: 8, userId: user.id, slug: "visible" },
						]);
					}),
				);
				yield* (yield* SavedViewsService).reorder(user, {
					installationId: "installation-a",
					references: [plugin("plugin-a", "visible")],
				});
				expect((yield* stored).overrides).toEqual([
					{
						revision: 5,
						sortOrder: 1,
						slug: "hidden",
						isHidden: true,
						userId: user.id,
						pluginId: "plugin-a",
					},
					{
						revision: 5,
						sortOrder: 7,
						slug: "hidden",
						isHidden: true,
						userId: user.id,
						pluginId: "plugin-b",
					},
					{
						revision: 6,
						sortOrder: 8,
						pluginId: null,
						userId: user.id,
						slug: "visible",
						isHidden: false,
					},
				]);
			}),
	);

	test.effect(
		"deletes visible default-restoring overrides but keeps hidden overrides and unchanged revisions",
		() =>
			Effect.gen(function* () {
				yield* seed;
				const session = yield* DatabaseSession;
				yield* session.run((db) =>
					Effect.gen(function* () {
						yield* db
							.insert(tables.definitionSavedView)
							.values([
								definition("visible", 0),
								definition("hidden", 1),
								definition("unchanged", 2),
								definition("redundant", 3),
							]);
						yield* db.insert(tables.savedViewOverride).values([
							{ revision: 4, sortOrder: 5, userId: user.id, slug: "visible" },
							{ revision: 5, sortOrder: 6, slug: "hidden", isHidden: true, userId: user.id },
							{ revision: 6, sortOrder: 2, isHidden: true, userId: user.id, slug: "unchanged" },
							{ revision: 7, sortOrder: 9, slug: "visible", userId: foreignUser },
							{ revision: 8, sortOrder: 3, userId: user.id, slug: "redundant" },
						]);
					}),
				);
				yield* (yield* SavedViewsService).reorder(user, {
					references: [
						kernel("visible"),
						kernel("hidden"),
						kernel("unchanged"),
						kernel("redundant"),
					],
				});
				expect((yield* stored).overrides).toEqual([
					{
						revision: 6,
						sortOrder: 1,
						pluginId: null,
						slug: "hidden",
						isHidden: true,
						userId: user.id,
					},
					{
						revision: 8,
						sortOrder: 3,
						pluginId: null,
						isHidden: false,
						userId: user.id,
						slug: "redundant",
					},
					{
						revision: 6,
						sortOrder: 2,
						pluginId: null,
						isHidden: true,
						userId: user.id,
						slug: "unchanged",
					},
					{
						revision: 7,
						sortOrder: 9,
						pluginId: null,
						slug: "visible",
						isHidden: false,
						userId: foreignUser,
					},
				]);
			}),
	);

	for (const [issue, installationId, references] of [
		["empty", undefined, []],
		["duplicate", undefined, [custom("global"), custom("global")]],
		["duplicate", undefined, [custom("missing"), custom("missing")]],
		["unknown-view", undefined, [custom("missing")]],
		["unknown-view", undefined, [custom("foreign")]],
		["unknown-view", undefined, [custom("workspace")]],
		["unknown-view", "installation-a", [custom("global")]],
		["unknown-view", "installation-a", [plugin("plugin-b", "same")]],
		["unknown-view", "installation-a", [kernel("same")]],
	] satisfies ReadonlyArray<
		readonly [
			"empty" | "duplicate" | "unknown-view",
			string | undefined,
			ReadonlyArray<SavedViewReference>,
		]
	>) {
		test.effect(
			`rejects ${issue} ${installationId ?? "global"} ${JSON.stringify(references)} without writes`,
			() =>
				Effect.gen(function* () {
					yield* seed;
					yield* (yield* DatabaseSession).run((db) =>
						Effect.gen(function* () {
							yield* db
								.insert(tables.savedView)
								.values([
									customView("global", 0),
									customView("workspace", 1, "installation-a"),
									customView("foreign", 0, null, foreignUser),
								]);
							yield* db
								.insert(tables.definitionSavedView)
								.values([definition("same", 0), definition("same", 0, "revision-b")]);
						}),
					);
					const before = yield* stored;
					const events = yield* (yield* ReorderEvents).events;
					assertExitFails(
						yield* Effect.exit(
							(yield* SavedViewsService).reorder(user, { references, installationId }),
						),
						new SavedViewBadRequest({ reason: { issue, references, code: "invalid-reorder" } }),
					);
					expect(yield* stored).toEqual(before);
					expect(yield* (yield* ReorderEvents).events).toEqual(events);
				}),
		);
	}

	test.effect("preserves installation validation before reorder errors", () =>
		Effect.gen(function* () {
			yield* seed;
			const before = yield* stored;
			assertExitFails(
				yield* Effect.exit(
					(yield* SavedViewsService).reorder(user, {
						references: [],
						installationId: "unknown-installation",
					}),
				),
				new SavedViewBadRequest({
					reason: { code: "plugin-not-found", installationId: "unknown-installation" },
				}),
			);
			expect(yield* stored).toEqual(before);
		}),
	);

	test.effect("rolls back earlier custom writes when builtin persistence fails", () =>
		Effect.scoped(
			Effect.gen(function* () {
				yield* seed;
				const session = yield* DatabaseSession;
				yield* session.run((db) =>
					Effect.gen(function* () {
						yield* db.insert(tables.savedView).values(customView("custom", 4));
						yield* db.insert(tables.definitionSavedView).values(definition("builtin", 0));
					}),
				);
				yield* Effect.acquireRelease(
					session.run((db) =>
						db.execute(
							sql`alter table saved_view_override add constraint reject_reorder check (sort_order <> 1)`,
						),
					),
					() =>
						session
							.run((db) =>
								db.execute(sql`alter table saved_view_override drop constraint reject_reorder`),
							)
							.pipe(Effect.orDie),
				);
				const before = yield* stored;
				const events = yield* (yield* ReorderEvents).events;
				const exit = yield* Effect.exit(
					(yield* SavedViewsService).reorder(user, { references: [custom("custom")] }),
				);
				assertExitFails(
					exit,
					new DbError({
						code: "23514",
						table: "saved_view_override",
						constraint: "reject_reorder",
						message:
							'new row for relation "saved_view_override" violates check constraint "reject_reorder"',
					}),
				);
				expect(yield* stored).toEqual(before);
				expect(yield* (yield* ReorderEvents).events).toEqual(events);
			}),
		),
	);

	test.effect(
		"keeps read/write statement counts constant as mixed scopes grow and writes nothing for unchanged plans",
		() =>
			Effect.gen(function* () {
				for (const [size, installationId] of [
					[2, undefined],
					[40, undefined],
					[2, "installation-a"],
					[40, "installation-a"],
				] as const) {
					yield* seed;
					const session = yield* DatabaseSession;
					yield* session.run((db) =>
						Effect.gen(function* () {
							yield* db
								.insert(tables.definitionSavedView)
								.values(
									Array.from({ length: size }, (_, index) =>
										definition(
											`builtin-${index.toString().padStart(2, "0")}`,
											index,
											installationId ? "revision-a" : null,
										),
									),
								);
							yield* db
								.insert(tables.savedView)
								.values(
									Array.from({ length: size }, (_, index) =>
										customView(
											`custom-${index.toString().padStart(2, "0")}`,
											size + index,
											installationId ?? null,
										),
									),
								);
						}),
					);
					const service = yield* SavedViewsService;
					const result = yield* service.reorder(user, {
						installationId,
						references: [custom(`custom-${(size - 1).toString().padStart(2, "0")}`)],
					});
					const statements = yield* (yield* StatementLog).lastTransaction;
					expect(statements).toHaveLength(6);
					expect(statements[0]).toContain("pg_advisory_xact_lock_shared");
					expect(statements[1]).toContain("pg_advisory_xact_lock(hashtext(");
					expect(
						statements.filter(
							(statement) =>
								statement.startsWith("select") &&
								statement.includes('from "user_saved_view_effective"'),
						),
					).toHaveLength(1);
					expect(
						statements.filter((statement) => statement.startsWith('update "saved_view"')),
					).toHaveLength(1);
					expect(
						statements.filter((statement) =>
							statement.startsWith('insert into "saved_view_override"'),
						),
					).toHaveLength(1);
					const before = yield* stored;
					yield* service.reorder(user, { installationId, references: result.references });
					const unchangedStatements = yield* (yield* StatementLog).lastTransaction;
					expect(unchangedStatements).toHaveLength(4);
					expect(
						unchangedStatements.filter((statement) =>
							/^(insert into "saved_view_override"|update "saved_view"|delete from "saved_view_override")/.test(
								statement,
							),
						),
					).toEqual([]);
					const after = yield* stored;
					expect(after.custom).toEqual(before.custom);
					expect(after.overrides).toEqual(before.overrides);
					expect(after.changes).toHaveLength(2);
					const current = yield* (yield* SavedViewsRepository).listReorderScope(
						user.id,
						installationId ?? null,
					);
					expect(current.map(({ sortOrder }) => sortOrder)).toEqual(
						Array.from({ length: size * 2 }, (_, index) => index),
					);
					assert(result.references.length === size * 2);
				}
			}),
	);
});
