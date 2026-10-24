import type { ContractPayload, ContractSuccess } from "@ryot-app/contract/client";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { integrationProvidersRecipe } from "@ryot-app/ryotql-recipes/integration-providers";
import { Effect, Option } from "effect";
import getPort from "get-port";

import {
	type Client,
	collectRyotQLRecipeItems,
	createAuthenticatedClient,
	createIntegration,
	getIntegration,
	installTestIntegrationProvider,
	makeSession,
	pollImportRunUntilTerminal,
	postIntegrationWebhook,
	postIntegrationWebhookAndWait,
} from "~/fixtures/kernel";
import { assertTaggedError, requirePresent } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it, runPromise } from "~/support/effect-test";
import { startFakeHttpServerScoped } from "~/support/fake-http-server";
import {
	buildApiEnv,
	spawnApiProcess,
	startCoreTestInfrastructure,
	waitForHealthCheck,
} from "~/support/provisioning";
import { makeTestResourceScope } from "~/support/resource-scope";

const S3_BUCKET_NAME = "ryot-pro-gated-providers-test";
const PRO_KEY_ENV_VALUE = "e2e-pro-gated-key";

const settingsSchema = {
	unknownKeys: "strict",
	fields: { endpoint: { type: "string", label: "Endpoint", description: "Provider URL" } },
} satisfies PluginManifest["integrationProviders"][number]["settingsSchema"];

const providerSpecifics = { endpoint: "https://pro-gated.example.com" };

const listProviders = (client: Client) =>
	collectRyotQLRecipeItems(client, (after) => integrationProvidersRecipe({ after, limit: 100 }));

const unkeyEnvelope = (data: { valid: boolean; code: string; meta?: Record<string, unknown> }) =>
	Response.json({ data, meta: { requestId: crypto.randomUUID() } });

let keyedClient: Client;
let providerSlug: string;
let providerReference: ContractPayload<"integrations", "create">["provider"];
let existingIntegration: ContractSuccess<"integrations", "create">;

let keyedApiUrl: string;
let lapsedApiUrl: string;
let keylessApiUrl: string;
let keylessTarget: Effect.Success<ReturnType<typeof spawnApiProcess>>["target"];
let lapsedTarget: Effect.Success<ReturnType<typeof spawnApiProcess>>["target"];

const resources = makeTestResourceScope();

beforeAll(() =>
	runPromise(
		resources.run(
			Effect.gen(function* () {
				const infrastructure = yield* startCoreTestInfrastructure({ bucketName: S3_BUCKET_NAME });

				const [validUnkey, invalidUnkey] = yield* Effect.all(
					[
						startFakeHttpServerScoped(() =>
							unkeyEnvelope({ valid: true, code: "VALID", meta: { expiry: "2030-01-01" } }),
						),
						startFakeHttpServerScoped(() => unkeyEnvelope({ valid: false, code: "NOT_FOUND" })),
					],
					{ concurrency: "unbounded" },
				);

				const [keyedPort, keylessPort, lapsedPort] = yield* Effect.all(
					[
						Effect.promise(() => getPort()),
						Effect.promise(() => getPort()),
						Effect.promise(() => getPort()),
					],
					{ concurrency: "unbounded" },
				);
				keyedApiUrl = `http://127.0.0.1:${keyedPort}/api`;
				keylessApiUrl = `http://127.0.0.1:${keylessPort}/api`;
				lapsedApiUrl = `http://127.0.0.1:${lapsedPort}/api`;

				// Processes on one database share a FRONTEND_URL: the internal OAuth client and API resource
				// are provisioned from it, as they are for replicas of a single deployment.
				const sharedFrontendUrl = `http://127.0.0.1:${keyedPort}`;
				const startApi = (label: string, port: number, extraEnv: Record<string, string>) =>
					spawnApiProcess(
						buildApiEnv({
							port,
							extraEnv,
							label: `Pro-gated ${label}`,
							dbUrl: infrastructure.dbUrl,
							s3BucketName: S3_BUCKET_NAME,
							frontendUrl: sharedFrontendUrl,
							redisUrl: infrastructure.redisUrl,
							s3Endpoint: infrastructure.s3Endpoint,
						}),
					);

				// The keyed api boots first: the plugin catalog is a per-process, boot-time snapshot, so the
				// provider must be installed against a running API before the other API processes start and read
				// it from the shared database at their own boot.
				const keyedProcess = yield* startApi("keyed", keyedPort, {
					SERVER_PRO_KEY: PRO_KEY_ENV_VALUE,
					SERVER_PRO_KEY_VERIFICATION_URL: requirePresent(validUnkey, "Valid fake Unkey missing")
						.url,
				});
				yield* waitForHealthCheck(
					`${keyedApiUrl}/system/health`,
					"Pro-gated keyed setup",
					keyedProcess,
					90,
				);

				const { plugin, providerSlug: slug } = yield* installTestIntegrationProvider(
					settingsSchema,
					{ requiresProKey: true, target: keyedProcess.target },
				);
				const { client } = yield* createAuthenticatedClient(keyedProcess.target);
				providerReference = { slug, owner: { kind: "plugin", pluginId: plugin.pluginId } };
				const integration = yield* createIntegration(client, {
					providerSpecifics,
					provider: providerReference,
				});
				providerSlug = slug;
				keyedClient = client;
				existingIntegration = integration;

				const keylessProcess = yield* startApi("keyless", keylessPort, { SERVER_PRO_KEY: "" });
				keylessTarget = keylessProcess.target;
				const lapsedProcess = yield* startApi("lapsed", lapsedPort, {
					SERVER_PRO_KEY: PRO_KEY_ENV_VALUE,
					SERVER_PRO_KEY_VERIFICATION_URL: requirePresent(
						invalidUnkey,
						"Invalid fake Unkey missing",
					).url,
				});
				yield* waitForHealthCheck(
					`${keylessApiUrl}/system/health`,
					"Pro-gated keyless setup",
					keylessProcess,
					90,
				);
				lapsedTarget = lapsedProcess.target;
				yield* waitForHealthCheck(
					`${lapsedApiUrl}/system/health`,
					"Pro-gated lapsed setup",
					lapsedProcess,
					90,
				);
			}),
		),
	),
);

afterAll(() => runPromise(resources.close));

describe("Without a valid Pro Key", () => {
	it.live("lists the pro-gated provider as not creatable", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient(keylessTarget);
			const providers = yield* listProviders(client);
			const provider = requirePresent(
				providers.find(({ slug }) => slug === providerSlug),
				"Expected the pro-gated test provider in the listing",
			);
			expect(provider.requiresProKey).toBe(true);
			expect(provider.hasScript).toBe(true);
			expect((yield* client.call((c) => c.system.config())).pro.isServerKeyValidated).toBe(false);
		}),
	);

	it.live("rejects creation with pro-key-required", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient(keylessTarget);
			const error = yield* Effect.flip(
				createIntegration(client, { providerSpecifics, provider: providerReference }),
			);
			assertTaggedError(error, "IntegrationRequestError");
			expect(error.reason).toEqual({ provider: providerSlug, code: "pro-key-required" });
		}),
	);

	it.live(
		"fails an existing integration's webhook run with pro-key-required once the key has lapsed",
		() =>
			Effect.gen(function* () {
				const lapsedSession = makeSession(lapsedTarget);
				const { runId } = yield* postIntegrationWebhook(
					lapsedSession,
					existingIntegration,
					{},
					keyedClient,
				);
				const run = yield* pollImportRunUntilTerminal(keyedClient, runId);
				expect(run).toMatchObject({
					status: "failed",
					failureReason: { code: "pro-key-required" },
				});
			}),
	);
});

describe("With a valid Pro Key", () => {
	it.live("lists the pro-gated provider as creatable", () =>
		Effect.gen(function* () {
			const providers = yield* listProviders(keyedClient);
			const provider = requirePresent(
				providers.find(({ slug }) => slug === providerSlug),
				"Expected the pro-gated test provider in the listing",
			);
			expect(provider.requiresProKey).toBe(true);
			expect(provider.hasScript).toBe(true);
			expect((yield* keyedClient.call((c) => c.system.config())).pro.isServerKeyValidated).toBe(
				true,
			);
		}),
	);

	it.live("creates the pro-gated integration", () =>
		Effect.gen(function* () {
			const integration = yield* createIntegration(keyedClient, {
				providerSpecifics,
				provider: providerReference,
			});
			const detail = requirePresent(
				Option.getOrUndefined(yield* getIntegration(keyedClient, integration.id)),
				"Expected pro-gated integration",
			);
			expect(detail.provider).toBe(providerSlug);
		}),
	);

	it.live("does not refuse the webhook run for pro-key-required", () =>
		Effect.gen(function* () {
			const { run } = yield* postIntegrationWebhookAndWait(keyedClient, existingIntegration, {});
			expect(run.failureReason).not.toEqual({ code: "pro-key-required" });
		}),
	);
});
