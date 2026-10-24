import { pluginClientCatalogRecipe } from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { Effect } from "effect";
import getPort from "get-port";

import {
	createApiKey,
	createAuthenticatedClient,
	encodePluginSourceFiles,
	executeRyotQLRecipe,
	fixtureClientPluginPackage,
	installPrivatePluginPackage,
	installTestSupportSystemPlugin,
	literalSandboxSource,
	makeSession,
	openPluginCatalogEventsScoped,
	settledPrivateInstallation,
	testPluginManifest,
	updateFixtureClientPlugin,
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

const S3_BUCKET_NAME = "ryot-plugin-catalog-events-test";
const API_LABEL = "Plugin Catalog Events API";

let apiPort: number;
let target: Effect.Success<ReturnType<typeof spawnApiProcess>>["target"];
const resources = makeTestResourceScope();

const apiUrl = () => `http://127.0.0.1:${apiPort}/api`;
const adminSession = () => makeSession(target);

const fixtureCatalogEntry = (client: Parameters<typeof executeRyotQLRecipe>[0]) =>
	Effect.gen(function* () {
		const catalog = yield* executeRyotQLRecipe(client, pluginClientCatalogRecipe());
		return requirePresent(
			catalog.items.find((entry) => entry.scope === "user"),
			"Fixture client plugin was not listed in the client catalog",
		);
	});

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

describe("plugin catalog events", () => {
	it.live("streams isolated private changes, reconnect state, and global reconciliation", () =>
		Effect.gen(function* () {
			const owner = yield* createAuthenticatedClient(target);
			const outsider = yield* createAuthenticatedClient(target);
			const ownerEvents = yield* openPluginCatalogEventsScoped(owner);
			const outsiderEvents = yield* openPluginCatalogEventsScoped(outsider);
			yield* ownerEvents.waitForConnected();
			yield* outsiderEvents.waitForConnected();

			const variant = crypto.randomUUID();
			const packageA = yield* fixtureClientPluginPackage("A", variant);
			const installed = yield* installPrivatePluginPackage({
				config: {},
				client: owner.client,
				pluginPackage: packageA,
			});
			yield* ownerEvents.waitForCatalogInvalidated();
			yield* outsiderEvents.assertNoInvalidation();

			const revisionA = yield* settledPrivateInstallation(owner.client, installed.id);
			expect(revisionA.health).toBe("ready");
			yield* ownerEvents.waitForCatalogInvalidated();
			yield* outsiderEvents.assertNoInvalidation();
			yield* ownerEvents.drainQueuedEvents();
			yield* outsiderEvents.drainQueuedEvents();

			const before = yield* fixtureCatalogEntry(owner.client);
			expect(before).toMatchObject({ sortOrder: 2, icon: "puzzle", name: "Fixture" });
			yield* updateFixtureClientPlugin(owner.client, "B", variant);
			yield* ownerEvents.waitForCatalogInvalidated();
			yield* outsiderEvents.assertNoInvalidation();
			const after = yield* fixtureCatalogEntry(owner.client);
			expect(after.contentHash).not.toBe(before.contentHash);

			yield* ownerEvents.drainQueuedEvents();
			yield* ownerEvents.close();
			yield* updateFixtureClientPlugin(owner.client, "B", `${variant}-missed`);
			const reconnected = yield* openPluginCatalogEventsScoped(owner);
			yield* reconnected.waitForConnected();
			expect((yield* fixtureCatalogEntry(owner.client)).contentHash).not.toBe(after.contentHash);

			const pluginSlug = `e2e-catalog-system-${crypto.randomUUID()}`;
			const scriptSlug = `e2e-catalog-system-script-${crypto.randomUUID()}`;
			const entry = "backend/scripts/catalog-events.sandbox.ts";
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
					},
				],
			});
			const files = { [entry]: literalSandboxSource({ name, value: true, slug: scriptSlug }) };
			yield* installTestSupportSystemPlugin({
				target,
				manifest,
				files: encodePluginSourceFiles(files),
			});
			yield* reconnected.drainQueuedEvents();
			yield* outsiderEvents.drainQueuedEvents();
			yield* adminSession().adminCall((client) =>
				client.testSupport.reconcilePluginInstallations(),
			);
			yield* reconnected.waitForCatalogInvalidated();
			yield* outsiderEvents.waitForCatalogInvalidated();
		}),
	);

	it.live("rejects an unauthenticated stream", () =>
		Effect.gen(function* () {
			const response = yield* makeSession(target).call((client) =>
				client.plugins.events({ responseMode: "response-only" }),
			);
			expect(response.status).toBe(401);
		}),
	);

	it.live("authenticates the event stream with an API key", () =>
		Effect.gen(function* () {
			const auth = yield* createAuthenticatedClient(target);
			const apiKey = yield* createApiKey(
				auth.sessionCookie,
				"E2E catalog events API key",
				apiUrl(),
			);
			const events = yield* openPluginCatalogEventsScoped({
				client: makeSession(target, { "X-Api-Key": apiKey }),
			});
			yield* events.waitForConnected();
		}),
	);
});
