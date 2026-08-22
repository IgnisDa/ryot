import type { ChildProcess } from "node:child_process";

import type { ListedIntegration } from "@ryot-app/contract/modules/integrations/schemas";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { Effect } from "effect";
import getPort from "get-port";

import {
	type Client,
	createAuthenticatedClient,
	createIntegration,
	installTestIntegrationProvider,
	makeSession,
	pollImportRunUntilTerminal,
	postIntegrationWebhook,
	postIntegrationWebhookAndWait,
} from "~/fixtures/kernel";
import { assertTaggedError, requirePresent } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it } from "~/support/effect-test";
import { type FakeHttpServer, startFakeHttpServer } from "~/support/fake-http-server";
import {
	buildApiEnv,
	startCoreTestInfrastructure,
	spawnApiProcess,
	stopApiProcess,
	stopCoreTestInfrastructure,
	waitForHealthCheck,
} from "~/support/provisioning";

const S3_BUCKET_NAME = "ryot-pro-gated-providers-test";
const PRO_KEY_ENV_VALUE = "e2e-pro-gated-key";

const settingsSchema = {
	unknownKeys: "strict",
	fields: { endpoint: { type: "string", label: "Endpoint", description: "Provider URL" } },
} satisfies PluginManifest["integrationProviders"][number]["settingsSchema"];

const providerSpecifics = { endpoint: "https://pro-gated.example.com" };

const unkeyEnvelope = (data: { valid: boolean; code: string; meta?: Record<string, unknown> }) =>
	Response.json({ data, meta: { requestId: crypto.randomUUID() } });

let keyedClient: Client;
let providerSlug: string;
let existingIntegration: ListedIntegration;

let keyedApiUrl: string;
let lapsedApiUrl: string;
let keylessApiUrl: string;

let keyedProcess: ChildProcess | undefined;
let lapsedProcess: ChildProcess | undefined;
let keylessProcess: ChildProcess | undefined;

let validUnkey: FakeHttpServer | undefined;
let invalidUnkey: FakeHttpServer | undefined;

let coreInfrastructure: Awaited<ReturnType<typeof startCoreTestInfrastructure>> | undefined;

beforeAll(async () => {
	coreInfrastructure = await startCoreTestInfrastructure({ bucketName: S3_BUCKET_NAME });
	const infrastructure = requirePresent(
		coreInfrastructure,
		"Pro-gated providers test infrastructure is not initialised",
	);

	[validUnkey, invalidUnkey] = await Promise.all([
		startFakeHttpServer(() =>
			unkeyEnvelope({ valid: true, code: "VALID", meta: { expiry: "2030-01-01" } }),
		),
		startFakeHttpServer(() => unkeyEnvelope({ valid: false, code: "NOT_FOUND" })),
	]);

	const [keyedPort, keylessPort, lapsedPort] = await Promise.all([getPort(), getPort(), getPort()]);
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
	keyedProcess = startApi("keyed", keyedPort, {
		SERVER_PRO_KEY: PRO_KEY_ENV_VALUE,
		SERVER_PRO_KEY_VERIFICATION_URL: requirePresent(validUnkey, "Valid fake Unkey missing").url,
	});
	await waitForHealthCheck(`${keyedApiUrl}/system/health`, "Pro-gated keyed setup", 90);

	const setup = await Effect.runPromise(
		Effect.gen(function* () {
			const { providerSlug: slug } = yield* installTestIntegrationProvider(settingsSchema, {
				requiresProKey: true,
				baseUrl: keyedApiUrl,
			});
			const { client } = yield* createAuthenticatedClient(keyedApiUrl);
			const integration = yield* createIntegration(client, { provider: slug, providerSpecifics });
			return { client, integration, providerSlug: slug };
		}),
	);
	providerSlug = setup.providerSlug;
	keyedClient = setup.client;
	existingIntegration = setup.integration;

	keylessProcess = startApi("keyless", keylessPort, { SERVER_PRO_KEY: "" });
	lapsedProcess = startApi("lapsed", lapsedPort, {
		SERVER_PRO_KEY: PRO_KEY_ENV_VALUE,
		SERVER_PRO_KEY_VERIFICATION_URL: requirePresent(invalidUnkey, "Invalid fake Unkey missing").url,
	});
	await waitForHealthCheck(`${keylessApiUrl}/system/health`, "Pro-gated keyless setup", 90);
	await waitForHealthCheck(`${lapsedApiUrl}/system/health`, "Pro-gated lapsed setup", 90);
}, 240_000);

afterAll(async () => {
	await Promise.all([
		stopApiProcess(keyedProcess),
		stopApiProcess(keylessProcess),
		stopApiProcess(lapsedProcess),
	]);
	validUnkey?.stop();
	invalidUnkey?.stop();
	await stopCoreTestInfrastructure(coreInfrastructure);
});

describe("Without a valid Pro Key", () => {
	it.live("lists the pro-gated provider as not creatable", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient(keylessApiUrl);
			const providers = yield* client.call((c) => c.integrations.listProviders());
			const provider = requirePresent(
				providers.find(({ slug }) => slug === providerSlug),
				"Expected the pro-gated test provider in the listing",
			);
			expect(provider.requiresProKey).toBe(true);
			expect(provider.isCreatable).toBe(false);
		}),
	);

	it.live("rejects creation with pro-key-required", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient(keylessApiUrl);
			const error = yield* Effect.flip(
				createIntegration(client, { providerSpecifics, provider: providerSlug }),
			);
			assertTaggedError(error, "IntegrationRequestError");
			expect(error.reason).toEqual({ provider: providerSlug, code: "pro-key-required" });
		}),
	);

	it.live(
		"fails an existing integration's webhook run with pro-key-required once the key has lapsed",
		() =>
			Effect.gen(function* () {
				const lapsedSession = makeSession(lapsedApiUrl);
				const { runId } = yield* postIntegrationWebhook(lapsedSession, existingIntegration, {});
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
			const providers = yield* keyedClient.call((c) => c.integrations.listProviders());
			const provider = requirePresent(
				providers.find(({ slug }) => slug === providerSlug),
				"Expected the pro-gated test provider in the listing",
			);
			expect(provider.requiresProKey).toBe(true);
			expect(provider.isCreatable).toBe(true);
		}),
	);

	it.live("creates the pro-gated integration", () =>
		Effect.gen(function* () {
			const integration = yield* createIntegration(keyedClient, {
				providerSpecifics,
				provider: providerSlug,
			});
			expect(integration.provider).toBe(providerSlug);
		}),
	);

	it.live("does not refuse the webhook run for pro-key-required", () =>
		Effect.gen(function* () {
			const { run } = yield* postIntegrationWebhookAndWait(keyedClient, existingIntegration, {});
			expect(run.failureReason).not.toEqual({ code: "pro-key-required" });
		}),
	);
});
