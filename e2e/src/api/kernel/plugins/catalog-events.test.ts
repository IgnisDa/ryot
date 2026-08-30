import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";

import { PluginSlug } from "@ryot-app/contract/schema/brands";
import { pluginClientCatalogRecipe } from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { Effect } from "effect";
import getPort from "get-port";

import {
	adminHeaders,
	createAuthenticatedClient,
	createApiKey,
	encodePluginSourceFiles,
	encodeTestSupportPluginFiles,
	executeRyotQLRecipe,
	fixtureClientPluginPackage,
	FIXTURE_CLIENT_PLUGIN_SLUG,
	installPrivatePluginPackage,
	literalSandboxSource,
	makeSession,
	openPluginCatalogEventsScoped,
	settledPrivateInstallation,
	testPluginManifest,
	updateFixtureClientPlugin,
	updateFixtureClientPluginWithCompileFailure,
} from "~/fixtures/kernel";
import { assertTaggedError, requirePresent } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it } from "~/support/effect-test";
import {
	buildApiEnv,
	spawnApiProcess,
	startCoreTestInfrastructure,
	stopApiProcess,
	stopCoreTestInfrastructure,
	waitForHealthCheck,
} from "~/support/provisioning";

const S3_BUCKET_NAME = "ryot-plugin-catalog-events-test";
const API_LABEL = "Plugin Catalog Events API";

let apiPort: number;
let apiProcess: ChildProcess | undefined;
let coreInfrastructure: Awaited<ReturnType<typeof startCoreTestInfrastructure>> | undefined;

const apiUrl = () => `http://127.0.0.1:${apiPort}/api`;
const adminSession = () => makeSession(apiUrl());

const fixtureCatalogEntry = (client: Parameters<typeof executeRyotQLRecipe>[0]) =>
	Effect.gen(function* () {
		const catalog = yield* executeRyotQLRecipe(client, pluginClientCatalogRecipe());
		return requirePresent(
			catalog.items.find((entry) => entry.slug === FIXTURE_CLIENT_PLUGIN_SLUG),
			"Fixture client plugin was not listed in the client catalog",
		);
	});

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

describe("plugin catalog events", () => {
	it.live("streams isolated private changes, reconnect state, and global reconciliation", () =>
		Effect.gen(function* () {
			const owner = yield* createAuthenticatedClient(apiUrl());
			const outsider = yield* createAuthenticatedClient(apiUrl());
			const ownerEvents = yield* openPluginCatalogEventsScoped(owner);
			const outsiderEvents = yield* openPluginCatalogEventsScoped(outsider);
			yield* ownerEvents.waitForConnected();
			yield* outsiderEvents.waitForConnected();

			const variant = randomUUID();
			const packageA = yield* fixtureClientPluginPackage("A", variant);
			const installing = yield* installPrivatePluginPackage({
				config: {},
				client: owner.client,
				baseUrl: apiUrl(),
				pluginPackage: packageA,
			});
			expect(installing).toMatchObject({
				health: "installing",
				slug: FIXTURE_CLIENT_PLUGIN_SLUG,
			});
			yield* ownerEvents.waitForCatalogInvalidated();
			yield* outsiderEvents.assertNoInvalidation();

			const revisionA = yield* settledPrivateInstallation(owner.client, FIXTURE_CLIENT_PLUGIN_SLUG);
			expect(revisionA.health).toBe("ready");
			yield* ownerEvents.waitForCatalogInvalidated();
			yield* outsiderEvents.assertNoInvalidation();
			yield* ownerEvents.drainQueuedEvents();
			yield* outsiderEvents.drainQueuedEvents();

			const before = yield* fixtureCatalogEntry(owner.client);
			expect(before).toMatchObject({ name: "Fixture", icon: "puzzle", sortOrder: 2 });
			const revisionB = yield* updateFixtureClientPlugin(owner.client, "B", variant, apiUrl());
			yield* ownerEvents.waitForCatalogInvalidated();
			yield* outsiderEvents.assertNoInvalidation();
			const after = yield* fixtureCatalogEntry(owner.client);
			expect(after.sourceHash).toBe(revisionB.sourceHash);
			expect(after.sourceHash).not.toBe(before.sourceHash);

			yield* ownerEvents.drainQueuedEvents();
			const failure = yield* Effect.flip(
				updateFixtureClientPluginWithCompileFailure(owner.client, apiUrl()),
			);
			assertTaggedError(failure, "PluginRequestError");
			expect(failure.reason.code).toBe("compilation-failed");
			yield* ownerEvents.assertNoInvalidation();
			expect(yield* fixtureCatalogEntry(owner.client)).toEqual(after);

			yield* ownerEvents.close();
			const missed = yield* updateFixtureClientPlugin(
				owner.client,
				"B",
				`${variant}-missed`,
				apiUrl(),
			);
			const reconnected = yield* openPluginCatalogEventsScoped(owner);
			yield* reconnected.waitForConnected();
			expect((yield* fixtureCatalogEntry(owner.client)).sourceHash).toBe(missed.sourceHash);

			const pluginSlug = PluginSlug.make(`e2e-catalog-system-${randomUUID()}`);
			const scriptSlug = `e2e-catalog-system-script-${randomUUID()}`;
			const entry = "scripts/catalog-events.sandbox.ts";
			const name = "E2E catalog events system plugin";
			const manifest = testPluginManifest({
				pluginSlug,
				scripts: [
					{
						name,
						entry,
						kind: "script",
						capabilities: [],
						slug: scriptSlug,
						requiredPluginConfigKeys: [],
						requiredSystemConfigKeys: [],
					},
				],
			});
			const files = { [entry]: literalSandboxSource({ name, slug: scriptSlug, value: true }) };
			yield* adminSession().call(
				(client) =>
					client.testSupport.installSystemPlugin({
						payload: {
							manifest,
							files: encodeTestSupportPluginFiles(encodePluginSourceFiles(files)),
						},
					}),
				adminHeaders,
			);
			yield* reconnected.drainQueuedEvents();
			yield* outsiderEvents.drainQueuedEvents();
			yield* adminSession().call(
				(client) => client.testSupport.reconcilePluginInstallations(),
				adminHeaders,
			);
			yield* reconnected.waitForCatalogInvalidated();
			yield* outsiderEvents.waitForCatalogInvalidated();
		}),
	);

	it.live("rejects an unauthenticated stream", () =>
		Effect.gen(function* () {
			const response = yield* makeSession(apiUrl()).call((client) =>
				client.plugins.events({ responseMode: "response-only" }),
			);
			expect(response.status).toBe(401);
		}),
	);

	it.live("authenticates the event stream with an API key", () =>
		Effect.gen(function* () {
			const auth = yield* createAuthenticatedClient(apiUrl());
			const apiKey = yield* createApiKey(
				auth.sessionCookie,
				"E2E catalog events API key",
				apiUrl(),
			);
			const events = yield* openPluginCatalogEventsScoped({
				client: makeSession(apiUrl(), { "X-Api-Key": apiKey }),
			});
			yield* events.waitForConnected();
		}),
	);
});
