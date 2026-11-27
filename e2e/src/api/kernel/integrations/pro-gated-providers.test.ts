import type { ContractPayload, ContractSuccess } from "@ryot-app/contract/client";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import {
	entitlementRequired,
	entitlementRequiredReason,
} from "@ryot-app/contract/schema/entitlement";
import { integrationProvidersRecipe } from "@ryot-app/ryotql-recipes/integration-providers";
import { startFakeHttpServerScoped } from "@ryot-app/testing/fake-http-server";
import { makeTestResourceScope } from "@ryot-app/testing/resource-scope";
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
import { manifestText } from "~/fixtures/kernel/manifest-text";
import { requirePresent } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it, runPromise } from "~/support/effect-test";
import { buildApiEnv, startApiProcess, startCoreTestInfrastructure } from "~/support/provisioning";

const S3_BUCKET_NAME = "ryot-pro-gated-providers-test";
const PRO_KEY_ENV_VALUE = "e2e-pro-gated-key";

const settingsSchema = {
	unknownKeys: "strict",
	fields: {
		endpoint: { type: "string", description: "Provider URL", label: manifestText("Endpoint") },
	},
} satisfies PluginManifest["integrationProviders"][number]["settingsSchema"];

const providerSpecifics = { endpoint: "https://pro-gated.example.com" };

const listProviders = (client: Client) =>
	collectRyotQLRecipeItems(client, integrationProvidersRecipe, {}, "providers");

type ApiTarget = Effect.Success<ReturnType<typeof startApiProcess>>["target"];
type Infrastructure = Effect.Success<ReturnType<typeof startCoreTestInfrastructure>>;

let apiPort: number;
let validVerifierUrl: string;
let invalidVerifierUrl: string;
let infrastructure: undefined | Infrastructure;

let ownerToken: string;
let ownerClient: Client;
let providerSlug: string;
let providerReference: ContractPayload<"integrations", "create">["provider"];
let existingIntegration: ContractSuccess<"integrations", "create">;

const resources = makeTestResourceScope();

const keyedEnv = () => ({
	SERVER_PRO_KEY: PRO_KEY_ENV_VALUE,
	SERVER_PRO_KEY_VERIFICATION_URL: validVerifierUrl,
});

// One backend may own a database at a time, so each API process reuses one origin and runs alone.
const startApi = (label: string, extraEnv: Record<string, string>) =>
	Effect.gen(function* () {
		const shared = requirePresent(infrastructure, "Pro-gated infrastructure is not initialised");
		const process = yield* startApiProcess(
			buildApiEnv({
				extraEnv,
				port: apiPort,
				dbUrl: shared.dbUrl,
				label: `Pro-gated ${label}`,
				s3BucketName: S3_BUCKET_NAME,
				s3Endpoint: shared.s3Endpoint,
				frontendUrl: `http://127.0.0.1:${apiPort}`,
			}),
			`Pro-gated ${label}`,
		);
		return process.target;
	});

const ownerSession = (target: ApiTarget) =>
	makeSession(target, { Authorization: `Bearer ${ownerToken}` }, ownerClient.userId);

const useApi = (label: string, extraEnv: () => Record<string, string>) => {
	const scope = makeTestResourceScope();
	let target: undefined | ApiTarget;
	beforeAll(() =>
		runPromise(
			scope.run(
				Effect.gen(function* () {
					target = yield* startApi(label, extraEnv());
				}),
			),
		),
	);
	afterAll(() => runPromise(scope.close));
	return () => requirePresent(target, `Pro-gated ${label} API is not running`);
};

beforeAll(() =>
	runPromise(
		resources.run(
			Effect.gen(function* () {
				infrastructure = yield* startCoreTestInfrastructure({ bucketName: S3_BUCKET_NAME });
				const [validVerifier, invalidVerifier] = yield* Effect.all(
					[
						startFakeHttpServerScoped(() => Response.json({ valid: true, expiry: "2030-01-01" })),
						startFakeHttpServerScoped(() => Response.json({ valid: false })),
					],
					{ concurrency: "unbounded" },
				);
				validVerifierUrl = requirePresent(validVerifier, "Valid fake Verifier missing").url;
				invalidVerifierUrl = requirePresent(invalidVerifier, "Invalid fake Verifier missing").url;
				apiPort = yield* Effect.promise(() => getPort());

				// The plugin catalog is a per-process, boot-time snapshot, so the provider is installed and
				// the shared fixtures are created before any suite boots its own API process.
				yield* Effect.scoped(
					Effect.gen(function* () {
						const target = yield* startApi("setup", keyedEnv());
						const { plugin, providerSlug: slug } = yield* installTestIntegrationProvider(
							settingsSchema,
							{ target, entitlement: "pro" },
						);
						const { token, client } = yield* createAuthenticatedClient(target);
						providerReference = { slug, owner: { kind: "plugin", pluginId: plugin.pluginId } };
						existingIntegration = yield* createIntegration(client, {
							providerSpecifics,
							provider: providerReference,
						});
						providerSlug = slug;
						ownerToken = token;
						ownerClient = client;
					}),
				);
			}),
		),
	),
);

afterAll(() => runPromise(resources.close));

describe("Without a Pro Key", () => {
	const target = useApi("keyless", () => ({ SERVER_PRO_KEY: "" }));

	it.live("lists the pro-gated provider as not creatable", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient(target());
			const providers = yield* listProviders(client);
			const provider = requirePresent(
				providers.find(({ slug }) => slug === providerSlug),
				"Expected the pro-gated test provider in the listing",
			);
			expect(provider.entitlement).toBe("pro");
			expect(provider.hasScript).toBe(true);
			expect((yield* client.call((c) => c.system.config())).entitlements).toEqual([]);
		}),
	);

	it.live("rejects creation with EntitlementRequired", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient(target());
			const error = yield* Effect.flip(
				createIntegration(client, { providerSpecifics, provider: providerReference }),
			);
			expect(error).toEqual(entitlementRequired("pro"));
		}),
	);
});

describe("With a lapsed Pro Key", () => {
	const target = useApi("lapsed", () => ({
		SERVER_PRO_KEY: PRO_KEY_ENV_VALUE,
		SERVER_PRO_KEY_VERIFICATION_URL: invalidVerifierUrl,
	}));

	it.live("fails an existing integration's webhook run with entitlement-required", () =>
		Effect.gen(function* () {
			const owner = ownerSession(target());
			const { runId } = yield* postIntegrationWebhook(owner, existingIntegration, {});
			const run = yield* pollImportRunUntilTerminal(owner, runId);
			expect(run).toMatchObject({
				status: "failed",
				failureReason: entitlementRequiredReason("pro"),
			});
		}),
	);
});

describe("With a valid Pro Key", () => {
	const target = useApi("keyed", keyedEnv);

	it.live("lists the pro-gated provider as creatable", () =>
		Effect.gen(function* () {
			const owner = ownerSession(target());
			const providers = yield* listProviders(owner);
			const provider = requirePresent(
				providers.find(({ slug }) => slug === providerSlug),
				"Expected the pro-gated test provider in the listing",
			);
			expect(provider.entitlement).toBe("pro");
			expect(provider.hasScript).toBe(true);
			expect((yield* owner.call((c) => c.system.config())).entitlements).toEqual(["pro"]);
		}),
	);

	it.live("creates the pro-gated integration", () =>
		Effect.gen(function* () {
			const owner = ownerSession(target());
			const integration = yield* createIntegration(owner, {
				providerSpecifics,
				provider: providerReference,
			});
			const detail = requirePresent(
				Option.getOrUndefined(yield* getIntegration(owner, integration.id)),
				"Expected pro-gated integration",
			);
			expect(detail.provider).toBe(providerSlug);
		}),
	);

	it.live("does not refuse the webhook run for entitlement-required", () =>
		Effect.gen(function* () {
			const owner = ownerSession(target());
			const { run } = yield* postIntegrationWebhookAndWait(owner, existingIntegration, {});
			expect(run.failureReason).not.toEqual(entitlementRequiredReason("pro"));
		}),
	);
});
