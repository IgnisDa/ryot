import {
	type PluginId,
	type PluginPackageId,
	pluginPackageSegments,
} from "@ryot-app/contract/schema/brands";
import { and, column, document, eq, field, join, literal, rows, table } from "@ryot-app/ryotql";
import { pluginInstallationsRecipe } from "@ryot-app/ryotql-recipes/plugin-installations";
import { Effect } from "effect";
import getPort from "get-port";

import type { Client } from "~/fixtures/kernel";
import {
	collectRyotQLRecipeItems,
	createAuthenticatedClient,
	encodePluginSourceFiles,
	executeRyotQL,
	installPrivatePlugin,
	installTestSupportSystemPlugin,
	listSavedViews,
	literalSandboxSource,
	makeSession,
	pollUntil,
	PRIVATE_PLUGIN_CONFIG_KEY,
	PRIVATE_PLUGIN_SECRET_KEY,
	requireRows,
	requireRyotQLText,
	testPluginManifest,
	testPluginPackageId,
	testPluginSavedView,
	updatePrivatePlugin,
} from "~/fixtures/kernel";
import { requirePresent } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it, runPromise } from "~/support/effect-test";
import {
	buildApiEnv,
	spawnApiProcess,
	startCoreTestInfrastructure,
	waitForHealthCheck,
} from "~/support/provisioning";
import { makeTestResourceScope } from "~/support/resource-scope";

const S3_BUCKET_NAME = "ryot-plugin-reconciliation-test";
const API_LABEL = "Plugin Reconciliation API";

const privateConfig = {
	[PRIVATE_PLUGIN_CONFIG_KEY]: "alpha",
	[PRIVATE_PLUGIN_SECRET_KEY]: "token-alpha",
};

let apiPort: number;
let target: Effect.Success<ReturnType<typeof spawnApiProcess>>["target"];
const resources = makeTestResourceScope();

const adminSession = () => makeSession(target);

const listPlugins = (client: Client) =>
	collectRyotQLRecipeItems(client, (after) => pluginInstallationsRecipe({ after, limit: 100 }));

const reconcilePluginInstallations = () =>
	adminSession().adminCall((c) => c.testSupport.reconcilePluginInstallations());

const uninstallShippedPlugin = (pluginId: PluginId, activationId: string) =>
	adminSession().adminCall((c) =>
		c.testSupport.uninstallSystemPlugin({ params: { pluginId, activationId } }),
	);

const installShippedPlugin = (
	packageId: PluginPackageId,
	savedViews?: ReturnType<typeof testPluginManifest>["savedViews"],
) => {
	const name = "E2E Reconciliation Shipped";
	const slug = `e2e-reconciliation-${crypto.randomUUID()}`;
	const entry = "backend/scripts/script.sandbox.ts";
	const manifest = testPluginManifest({
		packageId,
		savedViews,
		pluginSlug: pluginPackageSegments(packageId).name,
		scripts: [
			{
				name,
				slug,
				entry,
				capabilities: [],
				kind: "script" as const,
				requiredPluginConfigKeys: [],
			},
		],
	});
	const files = encodePluginSourceFiles({
		[entry]: literalSandboxSource({ name, slug, value: true }),
	});
	return Effect.acquireRelease(
		installTestSupportSystemPlugin({ files, target, manifest }),
		(installed) =>
			uninstallShippedPlugin(installed.pluginId, installed.activationId).pipe(
				Effect.catch((error) =>
					Effect.logWarning(
						`[reconciliation] shipped cleanup failed for '${packageId}' (non-fatal)`,
						error,
					),
				),
			),
	);
};

const installationRows = (client: Client, packageId: PluginPackageId, scope: "system" | "user") =>
	Effect.gen(function* () {
		const plugin = table("plugin", "plugin");
		const installation = table("pluginInstallation", "installation");
		const result = yield* executeRyotQL(
			client,
			document({
				installations: rows(installation, {
					joins: [
						join("inner", plugin, eq(column(installation, "pluginId"), column(plugin, "id"))),
					],
					fields: [
						field("id", column(installation, "id")),
						field("health", column(installation, "health")),
					],
					where: and(
						eq(column(plugin, "scope"), literal(scope)),
						eq(column(plugin, "packageId"), literal(packageId)),
					),
				}),
			}),
		);
		return requireRows(result.data.installations, "installations").items;
	});

const settledInstallation = (
	client: Client,
	packageId: PluginPackageId,
	scope: "system" | "user",
) =>
	pollUntil(
		`${scope} installation of '${packageId}'`,
		listPlugins(client).pipe(
			Effect.map((installations) => {
				const entry = installations.find(
					(item) => item.packageId === packageId && item.scope === scope,
				);
				return entry && entry.health !== "installing" ? entry : null;
			}),
		),
	);

const ownedInstallation = (client: Client, packageId: PluginPackageId) =>
	listPlugins(client).pipe(
		Effect.map((installations) =>
			requirePresent(
				installations.find((entry) => entry.packageId === packageId && entry.scope === "user"),
				`Private installation of '${packageId}' was not listed`,
			),
		),
	);

beforeAll(() =>
	runPromise(
		resources.run(
			Effect.gen(function* () {
				const [infrastructure, port] = yield* Effect.all(
					[
						startCoreTestInfrastructure({ bucketName: S3_BUCKET_NAME }),
						Effect.promise(() => getPort()),
					],
					{ concurrency: "unbounded" },
				);
				apiPort = port;
				const apiOrigin = `http://127.0.0.1:${apiPort}`;
				const apiProcess = yield* spawnApiProcess(
					buildApiEnv({
						port: apiPort,
						label: API_LABEL,
						frontendUrl: apiOrigin,
						dbUrl: infrastructure.dbUrl,
						s3BucketName: S3_BUCKET_NAME,
						redisUrl: infrastructure.redisUrl,
						s3Endpoint: infrastructure.s3Endpoint,
					}),
				);
				yield* waitForHealthCheck(`${apiOrigin}/api/system/health`, API_LABEL, apiProcess, 90);
				target = apiProcess.target;
			}),
		),
	),
);

afterAll(() => runPromise(resources.close));

describe("system plugin reconciliation", () => {
	it.live("keeps a shadowed private installation quarantined until it is explicitly updated", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient(target);
			const packageId = testPluginPackageId();
			const plugin = yield* installPrivatePlugin({ client, packageId, config: privateConfig });
			expect(plugin.installation).toMatchObject({ health: "ready", healthReason: null });

			const [owned] = yield* installationRows(client, packageId, "user");
			const installationId = requireRyotQLText(
				requirePresent(owned, "Private installation row was not found"),
				"id",
			);

			const shipped = yield* installShippedPlugin(packageId);
			yield* reconcilePluginInstallations();

			const conflicted = yield* ownedInstallation(client, packageId);
			expect(conflicted.health).toBe("incompatible");
			expect(conflicted.healthReason).not.toBeNull();
			expect(yield* settledInstallation(client, packageId, "system")).toMatchObject({
				health: "ready",
			});

			yield* uninstallShippedPlugin(shipped.pluginId, shipped.activationId);
			yield* reconcilePluginInstallations();

			const quarantined = yield* ownedInstallation(client, packageId);
			expect(quarantined.health).toBe("incompatible");
			yield* updatePrivatePlugin({
				client,
				installationId: plugin.installationId,
				expectedContentHash: quarantined.contentHash,
				payload: { files: plugin.files, manifest: plugin.manifest },
			});

			const restored = yield* settledInstallation(client, packageId, "user");
			expect(restored).toMatchObject({ health: "ready", healthReason: null });
			const [recovered] = yield* installationRows(client, packageId, "user");
			expect(
				requireRyotQLText(requirePresent(recovered, "Private installation row disappeared"), "id"),
			).toBe(installationId);
		}),
	);

	it.live("uninstalls a private installation shadowed by a shipped plugin", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient(target);
			const packageId = testPluginPackageId();
			const privatePlugin = yield* installPrivatePlugin({
				client,
				packageId,
				config: privateConfig,
			});
			yield* installShippedPlugin(packageId);
			yield* reconcilePluginInstallations();
			expect((yield* ownedInstallation(client, packageId)).health).toBe("incompatible");

			const [before] = yield* installationRows(client, packageId, "user");
			const removed = yield* client.call((c) =>
				c.plugins.uninstall({
					params: {
						activationId: privatePlugin.activationId,
						installationId: privatePlugin.installationId,
					},
				}),
			);
			expect(removed.id).toBe(
				requireRyotQLText(
					requirePresent(before, "Shadowed private installation was not found"),
					"id",
				),
			);
			const listed = yield* listPlugins(client);
			expect(
				listed.filter((entry) => entry.scope === "user").map((entry) => entry.packageId),
			).not.toContain(packageId);
		}),
	);

	it.live(
		"keeps a private installation ready when a shipped plugin declares the same view slug",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient(target);
				const viewSlug = `e2e-shared-view-${crypto.randomUUID()}`;
				const savedViews = [testPluginSavedView({ slug: viewSlug })];
				const packageId = testPluginPackageId();
				const shippedPackageId = testPluginPackageId();
				const plugin = yield* installPrivatePlugin({
					client,
					packageId,
					savedViews,
					config: privateConfig,
				});
				expect(plugin.installation).toMatchObject({ health: "ready", healthReason: null });

				yield* installShippedPlugin(shippedPackageId, savedViews);
				yield* reconcilePluginInstallations();

				expect(yield* ownedInstallation(client, packageId)).toMatchObject({
					health: "ready",
					healthReason: null,
				});
				expect(yield* settledInstallation(client, shippedPackageId, "system")).toMatchObject({
					health: "ready",
				});
				expect(
					(yield* listSavedViews(client))
						.filter((view) => view.slug === viewSlug)
						.map(({ packageId: owner }) => owner),
				).toEqual(expect.arrayContaining([packageId, shippedPackageId]));
			}),
	);

	it.live("provisions an installation for an existing user when a shipped plugin appears", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient(target);
			const packageId = testPluginPackageId();
			expect(yield* installationRows(client, packageId, "system")).toEqual([]);

			yield* installShippedPlugin(packageId);
			yield* reconcilePluginInstallations();

			const settled = yield* pollUntil(
				`system installation of '${packageId}'`,
				installationRows(client, packageId, "system").pipe(
					Effect.map((items) => {
						const [item] = items;
						return item && requireRyotQLText(item, "health") !== "installing" ? item : null;
					}),
				),
			);
			expect(requireRyotQLText(settled, "health")).toBe("ready");
		}),
	);
});
