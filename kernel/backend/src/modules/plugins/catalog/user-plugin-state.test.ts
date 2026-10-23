import { expect, layer } from "@effect/vitest";
import { and, asc, eq, sql } from "drizzle-orm";
import { Deferred, Effect, Fiber } from "effect";

import {
	fixtureManifest,
	insertPluginRevision,
	testPluginPackageId,
} from "#modules/plugins/test-support";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

type Scope = "system" | "user";

const epoch = new Date(0);

const createWorld = Effect.fn(function* (scope: Scope) {
	const session = yield* DatabaseSession;
	const key = crypto.randomUUID();
	const userId = `user-${key}`;
	const pluginId = `plugin-${key}`;
	const packageId = testPluginPackageId();
	const revisionIds = [`revision-a-${key}`, `revision-b-${key}`] as const;
	yield* session.run((db) =>
		Effect.gen(function* () {
			yield* db
				.insert(tables.user)
				.values({ id: userId, name: userId, email: `${key}@example.test` });
			yield* db
				.insert(tables.plugin)
				.values({
					packageId,
					id: pluginId,
					status: "inactive",
					ownerId: scope === "user" ? userId : null,
				});
			for (const id of revisionIds) {
				yield* insertPluginRevision(db, {
					id,
					pluginId,
					contentHash: id,
					manifest: fixtureManifest(packageId),
				});
			}
			yield* db
				.insert(tables.definitionEntitySchema)
				.values(
					revisionIds.map((pluginRevisionId) => ({
						icon: "box",
						position: 0,
						name: "Root",
						slug: "root",
						pluginRevisionId,
						mergeIdentityProperties: [],
						propertiesSchema: { fields: {} },
					})),
				);
			yield* db
				.insert(tables.definitionProvider)
				.values(
					revisionIds.map((pluginRevisionId) => ({
						position: 0,
						pluginRevisionId,
						slug: "provider",
						rootEntitySchemaSlug: "root",
					})),
				);
			yield* db
				.insert(tables.sandboxProvider)
				.values({
					pluginId,
					name: "Provider",
					slug: "provider",
					rootEntitySchemaSlug: "root",
					information: { source: "fixture" },
				});
			yield* db
				.update(tables.plugin)
				.set({ status: "active", activeRevisionId: revisionIds[0] })
				.where(eq(tables.plugin.id, pluginId));
		}),
	);
	return { key, userId, pluginId, revisionIds, ownerUserId: scope === "user" ? userId : null };
});

type World = Effect.Success<ReturnType<typeof createWorld>>;

const insertUser = Effect.fn(function* (id: string) {
	yield* (yield* DatabaseSession).run((db) =>
		db.insert(tables.user).values({ id, name: id, email: `${id}@example.test` }),
	);
});

const insertConfig = Effect.fn(function* (config: {
	readonly id: string;
	readonly ownerUserId: string | null;
	readonly pluginRevisionId: string;
	readonly pluginInstallationId: string | null;
}) {
	yield* (yield* DatabaseSession).run((db) =>
		db
			.insert(tables.pluginConfigRevision)
			.values({
				...config,
				configuredKeys: [],
				encryptionKeyId: "key",
				nonce: Buffer.alloc(12),
				payloadFingerprint: config.id,
				encryptedPayload: Buffer.alloc(16),
			}),
	);
});

const install = Effect.fn(function* (world: World, userId = world.userId) {
	const id = `installation-${crypto.randomUUID()}`;
	yield* (yield* DatabaseSession).run((db) =>
		db
			.insert(tables.pluginInstallation)
			.values({ id, userId, health: "ready", isHidden: false, pluginId: world.pluginId }),
	);
	return id;
});

const setPlugin = Effect.fn(function* (
	world: World,
	values: Partial<typeof tables.plugin.$inferInsert>,
) {
	yield* (yield* DatabaseSession).run((db) =>
		db.update(tables.plugin).set(values).where(eq(tables.plugin.id, world.pluginId)),
	);
});

const setInstallation = Effect.fn(function* (
	id: string,
	values: Partial<typeof tables.pluginInstallation.$inferInsert>,
) {
	yield* (yield* DatabaseSession).run((db) =>
		db.update(tables.pluginInstallation).set(values).where(eq(tables.pluginInstallation.id, id)),
	);
});

const installConfigured = Effect.fn(function* (world: World) {
	const installationId = yield* install(world);
	const configId = `config-${world.key}`;
	if (world.ownerUserId === null) {
		yield* insertConfig({
			id: configId,
			ownerUserId: null,
			pluginInstallationId: null,
			pluginRevisionId: world.revisionIds[0],
		});
		yield* setPlugin(world, { environmentConfigRevisionId: configId });
	} else {
		yield* insertConfig({
			id: configId,
			ownerUserId: world.userId,
			pluginInstallationId: installationId,
			pluginRevisionId: world.revisionIds[0],
		});
		yield* setInstallation(installationId, { activeConfigRevisionId: configId });
	}
	return { configId, installationId };
});

const pruneConfig = Effect.fn(function* (id: string) {
	yield* (yield* DatabaseSession).run((db) =>
		db
			.update(tables.pluginConfigRevision)
			.set({ encryptedPayload: null, payloadPrunedAt: epoch })
			.where(eq(tables.pluginConfigRevision.id, id)),
	);
});

const userPlugins = Effect.fn(function* (userId: string) {
	return yield* (yield* DatabaseSession).run((db) =>
		db
			.select({
				scope: tables.userPlugin.scope,
				health: tables.userPlugin.health,
				isHidden: tables.userPlugin.isHidden,
				isListed: tables.userPlugin.isListed,
				pluginId: tables.userPlugin.pluginId,
				isExecutable: tables.userPlugin.isExecutable,
				installationId: tables.userPlugin.installationId,
				configRevisionId: tables.userPlugin.configRevisionId,
				activeRevisionId: tables.userPlugin.activeRevisionId,
				isDefinitionEffective: tables.userPlugin.isDefinitionEffective,
			})
			.from(tables.userPlugin)
			.where(eq(tables.userPlugin.userId, userId))
			.orderBy(asc(tables.userPlugin.pluginId)),
	);
});

const sandboxProviderCount = Effect.fn(function* (world: World) {
	const rows = yield* (yield* DatabaseSession).run((db) =>
		db
			.select({ id: tables.userSandboxProvider.id })
			.from(tables.userSandboxProvider)
			.where(
				and(
					eq(tables.userSandboxProvider.userId, world.userId),
					eq(tables.userSandboxProvider.pluginId, world.pluginId),
				),
			),
	);
	return rows.length;
});

const pluginEntitySchemaCount = Effect.fn(function* (world: World) {
	const rows = yield* (yield* DatabaseSession).run((db) =>
		db
			.select({ id: tables.userEntitySchema.id })
			.from(tables.userEntitySchema)
			.where(
				and(
					eq(tables.userEntitySchema.userId, world.userId),
					eq(tables.userEntitySchema.pluginId, world.pluginId),
				),
			),
	);
	return rows.length;
});

const lockWaiter = Effect.gen(function* () {
	const session = yield* DatabaseSession;
	yield* session
		.run((db) =>
			db.execute<{ waiting: boolean }>(
				sql`select exists (select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock') as waiting from pg_sleep(0.01)`,
				"objects",
			),
		)
		.pipe(Effect.repeat({ until: (rows) => rows[0]?.waiting === true }));
});

// The contender runs while the holder's transaction is still open and must either block on one of
// its locks or finish; the holder then commits.
const contend = Effect.fn(function* <E1, R1, E2, R2>(
	holderWork: Effect.Effect<unknown, E1, R1>,
	contenderWork: Effect.Effect<unknown, E2, R2>,
) {
	const session = yield* DatabaseSession;
	const holding = yield* Deferred.make<void>();
	const release = yield* Deferred.make<void>();
	const holder = yield* Effect.forkChild(
		session.transaction(
			holderWork.pipe(
				Effect.andThen(Deferred.succeed(holding, undefined)),
				Effect.andThen(Deferred.await(release)),
			),
		),
	);
	yield* Deferred.await(holding);
	const contender = yield* Effect.forkChild(session.transaction(contenderWork));
	yield* Effect.race(Fiber.await(contender), lockWaiter);
	yield* Deferred.succeed(release, undefined);
	yield* Fiber.join(holder);
	yield* Fiber.join(contender);
});

layer(isolatedDatabaseLayer("user_plugin_state_test"))((test) => {
	test.effect("lists an installed system plugin and follows uninstall and reinstall", () =>
		Effect.gen(function* () {
			const world = yield* createWorld("system");
			const { configId, installationId } = yield* installConfigured(world);
			expect(yield* userPlugins(world.userId)).toEqual([
				{
					installationId,
					isListed: true,
					health: "ready",
					isHidden: false,
					scope: "system",
					isExecutable: true,
					pluginId: world.pluginId,
					configRevisionId: configId,
					isDefinitionEffective: true,
					activeRevisionId: world.revisionIds[0],
				},
			]);
			expect(yield* sandboxProviderCount(world)).toBe(1);

			yield* setInstallation(installationId, { uninstalledAt: epoch });
			expect(yield* userPlugins(world.userId)).toEqual([]);
			expect(yield* pluginEntitySchemaCount(world)).toBe(0);

			yield* setInstallation(installationId, { uninstalledAt: null });
			expect(yield* userPlugins(world.userId)).toMatchObject([
				{ installationId, isExecutable: true },
			]);
			expect(yield* pluginEntitySchemaCount(world)).toBe(1);
		}),
	);

	test.effect("follows visibility and health", () =>
		Effect.gen(function* () {
			const world = yield* createWorld("system");
			const { installationId } = yield* installConfigured(world);

			yield* setInstallation(installationId, { isHidden: true });
			expect(yield* userPlugins(world.userId)).toMatchObject([
				{ isHidden: true, isListed: true, isExecutable: false, isDefinitionEffective: false },
			]);

			yield* setInstallation(installationId, { isHidden: false, health: "installing" });
			expect(yield* userPlugins(world.userId)).toMatchObject([
				{ isListed: true, isExecutable: false, health: "installing", isDefinitionEffective: true },
			]);

			yield* setInstallation(installationId, {
				health: "incompatible",
				incompatibilityReason: "package-identity-conflict",
			});
			expect(yield* userPlugins(world.userId)).toMatchObject([
				{ isListed: false, isExecutable: false, health: "incompatible" },
			]);
			expect(yield* pluginEntitySchemaCount(world)).toBe(0);
			expect(yield* sandboxProviderCount(world)).toBe(0);
		}),
	);

	test.effect("follows revision and installation configuration activation for a user plugin", () =>
		Effect.gen(function* () {
			const world = yield* createWorld("user");
			const { configId, installationId } = yield* installConfigured(world);
			expect(yield* userPlugins(world.userId)).toMatchObject([
				{ scope: "user", isExecutable: true, configRevisionId: configId },
			]);

			yield* setPlugin(world, { activeRevisionId: world.revisionIds[1] });
			expect(yield* userPlugins(world.userId)).toMatchObject([
				{ isExecutable: false, configRevisionId: configId, activeRevisionId: world.revisionIds[1] },
			]);
			expect(yield* sandboxProviderCount(world)).toBe(0);

			const nextConfigId = `config-next-${world.key}`;
			yield* insertConfig({
				id: nextConfigId,
				ownerUserId: world.userId,
				pluginInstallationId: installationId,
				pluginRevisionId: world.revisionIds[1],
			});
			yield* setInstallation(installationId, { activeConfigRevisionId: nextConfigId });
			expect(yield* userPlugins(world.userId)).toMatchObject([
				{ isExecutable: true, configRevisionId: nextConfigId },
			]);
			expect(yield* sandboxProviderCount(world)).toBe(1);
		}),
	);

	test.effect("follows environment configuration activation for a system plugin", () =>
		Effect.gen(function* () {
			const world = yield* createWorld("system");
			yield* install(world);
			expect(yield* userPlugins(world.userId)).toMatchObject([
				{ isExecutable: false, configRevisionId: null },
			]);

			const configId = `config-${world.key}`;
			yield* insertConfig({
				id: configId,
				ownerUserId: null,
				pluginInstallationId: null,
				pluginRevisionId: world.revisionIds[1],
			});
			yield* setPlugin(world, {
				environmentConfigRevisionId: configId,
				activeRevisionId: world.revisionIds[1],
			});
			expect(yield* userPlugins(world.userId)).toMatchObject([
				{ isExecutable: true, configRevisionId: configId, activeRevisionId: world.revisionIds[1] },
			]);

			yield* setPlugin(world, { environmentConfigRevisionId: null });
			expect(yield* userPlugins(world.userId)).toMatchObject([
				{ isExecutable: false, configRevisionId: null },
			]);
		}),
	);

	test.effect("drops the row while the plugin is not active", () =>
		Effect.gen(function* () {
			const world = yield* createWorld("system");
			yield* installConfigured(world);
			yield* setPlugin(world, { status: "inactive" });
			expect(yield* userPlugins(world.userId)).toEqual([]);
			expect(yield* sandboxProviderCount(world)).toBe(0);
			yield* setPlugin(world, { status: "active" });
			expect(yield* userPlugins(world.userId)).toMatchObject([{ isExecutable: true }]);
		}),
	);

	for (const scope of ["user", "system"] as const) {
		test.effect(`stops executing a ${scope} plugin whose configuration payload is pruned`, () =>
			Effect.gen(function* () {
				const world = yield* createWorld(scope);
				const { configId } = yield* installConfigured(world);
				expect(yield* sandboxProviderCount(world)).toBe(1);
				yield* pruneConfig(configId);
				expect(yield* userPlugins(world.userId)).toMatchObject([
					{ isExecutable: false, configRevisionId: configId },
				]);
				expect(yield* sandboxProviderCount(world)).toBe(0);
			}),
		);
	}

	test.effect("never lists another user's private plugin", () =>
		Effect.gen(function* () {
			const world = yield* createWorld("user");
			const intruder = `intruder-${world.key}`;
			yield* insertUser(intruder);
			yield* install(world, intruder);
			expect(yield* userPlugins(intruder)).toEqual([]);
		}),
	);

	test.effect("merges a concurrent plugin update and installation update", () =>
		Effect.gen(function* () {
			const world = yield* createWorld("user");
			const { configId, installationId } = yield* installConfigured(world);
			yield* contend(
				setPlugin(world, { activeRevisionId: world.revisionIds[1] }),
				setInstallation(installationId, { isHidden: true }),
			);
			expect(yield* userPlugins(world.userId)).toMatchObject([
				{
					isHidden: true,
					isExecutable: false,
					configRevisionId: configId,
					activeRevisionId: world.revisionIds[1],
				},
			]);
		}),
	);

	test.effect("does not list an installation inserted while the plugin is being deactivated", () =>
		Effect.gen(function* () {
			const world = yield* createWorld("system");
			yield* contend(setPlugin(world, { status: "inactive" }), install(world));
			expect(yield* userPlugins(world.userId)).toEqual([]);
		}),
	);

	test.effect("does not execute with a configuration pruned while the installation adopts it", () =>
		Effect.gen(function* () {
			const world = yield* createWorld("user");
			const { installationId } = yield* installConfigured(world);
			const prunedId = `config-pruned-${world.key}`;
			yield* insertConfig({
				id: prunedId,
				ownerUserId: world.userId,
				pluginInstallationId: installationId,
				pluginRevisionId: world.revisionIds[0],
			});
			yield* contend(
				pruneConfig(prunedId),
				setInstallation(installationId, { activeConfigRevisionId: prunedId }),
			);
			expect(yield* userPlugins(world.userId)).toMatchObject([
				{ isExecutable: false, configRevisionId: prunedId },
			]);
		}),
	);
});
