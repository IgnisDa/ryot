import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";

import { PluginSlug } from "@ryot-app/contract/schema/brands";
import { and, column, document, eq, field, join, literal, rows, table } from "@ryot-app/ryotql";
import { Effect } from "effect";
import getPort from "get-port";

import type { Client } from "~/fixtures/kernel";
import {
	adminHeaders,
	createAuthenticatedClient,
	encodePluginSourceFiles,
	encodeTestSupportPluginFiles,
	executeRyotQL,
	installPrivatePlugin,
	listSavedViews,
	literalSandboxSource,
	makeSession,
	pollUntil,
	PRIVATE_PLUGIN_CONFIG_KEY,
	PRIVATE_PLUGIN_SECRET_KEY,
	releasePrivatePlugin,
	requireRows,
	requireRyotQLText,
	testPluginManifest,
	testPluginSavedView,
} from "~/fixtures/kernel";
import { requirePresent } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it } from "~/support/effect-test";
import {
	buildApiEnv,
	spawnApiProcess,
	startCoreTestInfrastructure,
	stopApiProcess,
	stopCoreTestInfrastructure,
	waitForHealthCheck,
} from "~/support/provisioning";

const S3_BUCKET_NAME = "ryot-plugin-reconciliation-test";
const API_LABEL = "Plugin Reconciliation API";

const privateConfig = {
	[PRIVATE_PLUGIN_CONFIG_KEY]: "alpha",
	[PRIVATE_PLUGIN_SECRET_KEY]: "token-alpha",
};

let apiPort: number;
let apiProcess: ChildProcess | undefined;
let coreInfrastructure: Awaited<ReturnType<typeof startCoreTestInfrastructure>> | undefined;

const apiUrl = () => `http://127.0.0.1:${apiPort}/api`;

const adminSession = () => makeSession(apiUrl());

const reconcilePluginInstallations = () =>
	adminSession().call((c) => c.testSupport.reconcilePluginInstallations(), adminHeaders());

const uninstallShippedPlugin = (pluginSlug: PluginSlug) =>
	adminSession().call(
		(c) => c.testSupport.uninstallSystemPlugin({ params: { pluginSlug } }),
		adminHeaders(),
	);

const installShippedPlugin = (
	pluginSlug: PluginSlug,
	savedViews?: ReturnType<typeof testPluginManifest>["savedViews"],
) => {
	const name = "E2E Reconciliation Shipped";
	const slug = `e2e-reconciliation-${randomUUID()}`;
	const entry = "scripts/script.sandbox.ts";
	const manifest = testPluginManifest({
		pluginSlug,
		savedViews,
		scripts: [
			{
				name,
				slug,
				entry,
				capabilities: [],
				kind: "script" as const,
				requiredPluginConfigKeys: [],
				requiredSystemConfigKeys: [],
			},
		],
	});
	const files = encodeTestSupportPluginFiles(
		encodePluginSourceFiles({ [entry]: literalSandboxSource({ name, slug, value: true }) }),
	);
	return Effect.acquireRelease(
		adminSession()
			.call(
				(c) => c.testSupport.installSystemPlugin({ payload: { files, manifest } }),
				adminHeaders(),
			)
			.pipe(Effect.as(pluginSlug)),
		() =>
			uninstallShippedPlugin(pluginSlug).pipe(
				Effect.catch((error) =>
					Effect.logWarning(
						`[reconciliation] shipped cleanup failed for '${pluginSlug}' (non-fatal)`,
						error,
					),
				),
			),
	);
};

const installationRows = (client: Client, pluginSlug: string, scope: "system" | "user") =>
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
						eq(column(plugin, "slug"), literal(pluginSlug)),
					),
				}),
			}),
		);
		return requireRows(result.data.installations, "installations").items;
	});

const settledInstallation = (client: Client, pluginSlug: string, scope: "system" | "user") =>
	pollUntil(
		`${scope} installation of '${pluginSlug}'`,
		client
			.call((c) => c.plugins.list())
			.pipe(
				Effect.map((installations) => {
					const entry = installations.find(
						(item) => item.slug === pluginSlug && item.scope === scope,
					);
					return entry && entry.health !== "installing" ? entry : null;
				}),
			),
	);

const ownedInstallation = (client: Client, pluginSlug: string) =>
	client
		.call((c) => c.plugins.list())
		.pipe(
			Effect.map((installations) =>
				requirePresent(
					installations.find((entry) => entry.slug === pluginSlug && entry.scope === "user"),
					`Private installation of '${pluginSlug}' was not listed`,
				),
			),
		);

beforeAll(async () => {
	try {
		const [infrastructure, port] = await Promise.all([
			startCoreTestInfrastructure({ bucketName: S3_BUCKET_NAME }),
			getPort(),
		]);
		apiPort = port;
		coreInfrastructure = infrastructure;
		const apiOrigin = `http://127.0.0.1:${apiPort}`;
		apiProcess = spawnApiProcess(
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
		await waitForHealthCheck(`${apiOrigin}/api/system/health`, API_LABEL, 90);
	} catch (error) {
		await stopApiProcess(apiProcess);
		await stopCoreTestInfrastructure(coreInfrastructure).catch(() => undefined);
		throw error;
	}
}, 180_000);

afterAll(async () => {
	await stopApiProcess(apiProcess);
	await stopCoreTestInfrastructure(coreInfrastructure).catch(() => undefined);
});

describe("system plugin reconciliation", () => {
	it.live("marks a shadowed private installation incompatible and restores it when clear", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient(apiUrl());
			const pluginSlug = PluginSlug.make(`e2e-shadowed-${randomUUID()}`);
			const plugin = yield* installPrivatePlugin({
				client,
				pluginSlug,
				config: privateConfig,
				baseUrl: apiUrl(),
			});
			expect(plugin.installation).toMatchObject({ health: "ready", healthReason: null });

			const [owned] = yield* installationRows(client, pluginSlug, "user");
			const installationId = requireRyotQLText(
				requirePresent(owned, "Private installation row was not found"),
				"id",
			);

			yield* installShippedPlugin(pluginSlug);
			yield* reconcilePluginInstallations();

			const conflicted = yield* ownedInstallation(client, pluginSlug);
			expect(conflicted.health).toBe("incompatible");
			expect(conflicted.healthReason).not.toBeNull();
			expect(yield* settledInstallation(client, pluginSlug, "system")).toMatchObject({
				health: "ready",
			});

			yield* uninstallShippedPlugin(pluginSlug);
			yield* reconcilePluginInstallations();

			const restored = yield* ownedInstallation(client, pluginSlug);
			expect(restored).toMatchObject({ health: "ready", healthReason: null });
			const [recovered] = yield* installationRows(client, pluginSlug, "user");
			expect(
				requireRyotQLText(requirePresent(recovered, "Private installation row disappeared"), "id"),
			).toBe(installationId);
		}),
	);

	it.live("uninstalls a private installation shadowed by a shipped plugin", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient(apiUrl());
			const pluginSlug = PluginSlug.make(`e2e-shadowed-removable-${randomUUID()}`);
			yield* installPrivatePlugin({ client, pluginSlug, config: privateConfig, baseUrl: apiUrl() });
			yield* installShippedPlugin(pluginSlug);
			yield* reconcilePluginInstallations();
			expect((yield* ownedInstallation(client, pluginSlug)).health).toBe("incompatible");

			const removed = yield* client.call((c) => c.plugins.uninstall({ params: { pluginSlug } }));
			expect(removed.slug).toBe(pluginSlug);
			const listed = yield* client.call((c) => c.plugins.list());
			expect(
				listed.filter((entry) => entry.scope === "user").map(({ slug }) => slug),
			).not.toContain(pluginSlug);
		}),
	);

	it.live("marks a private installation incompatible when a shipped plugin claims its view", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient(apiUrl());
			const viewSlug = `e2e-shared-view-${randomUUID()}`;
			const savedViews = [testPluginSavedView({ slug: viewSlug })];
			const pluginSlug = PluginSlug.make(`e2e-view-owner-${randomUUID()}`);
			const shippedSlug = PluginSlug.make(`e2e-view-claimer-${randomUUID()}`);
			const plugin = yield* installPrivatePlugin({
				client,
				savedViews,
				pluginSlug,
				config: privateConfig,
				baseUrl: apiUrl(),
			});
			expect(plugin.installation).toMatchObject({ health: "ready", healthReason: null });
			expect(
				(yield* listSavedViews(client))
					.filter((view) => view.slug === viewSlug)
					.map(({ pluginSlug: owner }) => owner),
			).toEqual([pluginSlug]);

			yield* installShippedPlugin(shippedSlug, savedViews);
			yield* reconcilePluginInstallations();

			const conflicted = yield* ownedInstallation(client, pluginSlug);
			expect(conflicted.health).toBe("incompatible");
			expect(conflicted.healthReason).not.toBeNull();
			expect(yield* settledInstallation(client, shippedSlug, "system")).toMatchObject({
				health: "ready",
			});
			expect(
				(yield* listSavedViews(client))
					.filter((view) => view.slug === viewSlug)
					.map(({ pluginSlug: owner }) => owner),
			).toEqual([shippedSlug]);
			// The shipped plugin is uninstalled when this test's scope closes, which would otherwise
			// return the private installation to `ready` inside a later reconcile while the shipped
			// plugin's generated view row still owns the shared slug.
			yield* releasePrivatePlugin(client, pluginSlug);
		}),
	);

	it.live("provisions an installation for an existing user when a shipped plugin appears", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient(apiUrl());
			const pluginSlug = PluginSlug.make(`e2e-provisioned-${randomUUID()}`);
			expect(yield* installationRows(client, pluginSlug, "system")).toEqual([]);

			yield* installShippedPlugin(pluginSlug);
			yield* reconcilePluginInstallations();

			const settled = yield* pollUntil(
				`system installation of '${pluginSlug}'`,
				installationRows(client, pluginSlug, "system").pipe(
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
