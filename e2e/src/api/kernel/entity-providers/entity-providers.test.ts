import { SandboxProviderId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import type { Client } from "~/fixtures/kernel";
import {
	createAuthenticatedClient,
	enqueueProviderEntityImport,
	fakeProviderDetailsResult,
	fakeProviderSearchResult,
	getApiClient,
	installTestProvider,
	pollProviderEntityImportResult,
	providerSandboxSource,
	replaceSandboxScriptCompiledRepresentation,
	searchProviderEntities,
	uninstallTestProvider,
} from "~/fixtures/kernel";
import type { InstalledTestProvider } from "~/fixtures/kernel/sandbox-provider";
import { assertCompleted, assertPresent, assertTaggedError } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it, runPromise } from "~/support/effect-test";

const IMPORT_EXTERNAL_ID = "e2e-private-record-1";
const IMPORTED_NAME = "E2E Imported Private Record";
const PLUGIN_SLUG = `entity-providers-${crypto.randomUUID()}`;
const ENTITY_SCHEMA_SLUG = `private-record-${crypto.randomUUID()}`;
const PROVIDER_SLUG = `${ENTITY_SCHEMA_SLUG}.entity-providers`;

let providerClient: Client;
let provider: InstalledTestProvider;

beforeAll(() =>
	runPromise(
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			providerClient = client;
			provider = yield* installTestProvider({
				client,
				slug: PROVIDER_SLUG,
				pluginSlug: PLUGIN_SLUG,
				rootEntitySchemaSlug: ENTITY_SCHEMA_SLUG,
				details: fakeProviderDetailsResult({
					name: IMPORTED_NAME,
					properties: { description: "Imported by the e2e fake provider." },
				}),
				search: fakeProviderSearchResult([
					{ externalId: IMPORT_EXTERNAL_ID, title: "E2E Private Record One" },
					{ metadata: [2], title: "E2E Private Record Two", externalId: "e2e-private-record-2" },
				]),
				entitySchemas: [
					{
						icon: "file",
						eventSchemas: [],
						name: "Private Record",
						slug: ENTITY_SCHEMA_SLUG,
						propertiesSchema: {
							fields: {
								description: {
									type: "string",
									label: "Description",
									description: "Private record description",
								},
							},
						},
					},
				],
			});
		}),
	),
);

afterAll(() => runPromise(uninstallTestProvider(provider)));

describe("provider entity search", () => {
	it.live("uses separate search and details scripts through one provider identity", () =>
		Effect.gen(function* () {
			const search = yield* searchProviderEntities(providerClient, {
				page: 1,
				pageSize: 5,
				query: "test",
				providerId: provider.providerId,
			});
			expect(search.providerId).toBe(provider.providerId);
			expect(search.items).toEqual([
				{ externalId: IMPORT_EXTERNAL_ID, title: "E2E Private Record One" },
				{ metadata: [2], title: "E2E Private Record Two", externalId: "e2e-private-record-2" },
			]);
			const firstItem = search.items[0];
			assertPresent(firstItem, "Expected the first search item");
			expect(firstItem.externalId).toBe(IMPORT_EXTERNAL_ID);

			const { jobId: importJobId } = yield* enqueueProviderEntityImport(providerClient, {
				providerId: search.providerId,
				externalId: firstItem.externalId,
			});
			const imported = yield* pollProviderEntityImportResult(providerClient, importJobId);
			assertCompleted(imported, "import job");
			expect(imported.data.name).toBe(IMPORTED_NAME);
		}),
	);
});

describe("POST /entity-providers/imports — provider entity import", () => {
	it.live("returns 404 when the provider does not exist", () =>
		Effect.gen(function* () {
			const missingProviderId = SandboxProviderId.make(crypto.randomUUID());
			const error = yield* Effect.flip(
				providerClient.call((c) =>
					c.entityProviders.import({
						payload: { providerId: missingProviderId, externalId: "some-external-id" },
					}),
				),
			);
			assertTaggedError(error, "ProviderEntityNotFound");
			expect(error.reason).toEqual({ code: "provider-not-found", providerId: missingProviderId });
		}),
	);

	it.live("returns 404 for unknown import job id", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				providerClient.call((c) =>
					c.entityProviders.getImportResult({ params: { jobId: crypto.randomUUID() } }),
				),
			);

			assertTaggedError(error, "ProviderEntityNotFound");
			expect(error.reason.code).toBe("import-job-not-found");
		}),
	);

	it.live("returns 401 for unauthenticated import requests", () =>
		Effect.gen(function* () {
			const client = getApiClient();

			const error = yield* Effect.flip(
				client.call((c) =>
					c.entityProviders.import({
						payload: {
							externalId: "some-id",
							providerId: SandboxProviderId.make(crypto.randomUUID()),
						},
					}),
				),
			);

			assertTaggedError(error, "AuthUnauthorized");
		}),
	);
});

describe("GET /entity-providers/imports/:jobId — provider entity import result", () => {
	it.live("preserves entity identity when the provider details script is reingested", () =>
		Effect.gen(function* () {
			const externalId = `e2e-reingestion-${crypto.randomUUID()}`;
			const firstJob = yield* enqueueProviderEntityImport(providerClient, {
				externalId,
				providerId: provider.providerId,
			});
			const first = yield* pollProviderEntityImportResult(providerClient, firstJob.jobId);
			assertCompleted(first, "first import job");

			yield* replaceSandboxScriptCompiledRepresentation(
				providerClient,
				provider.detailsScriptId,
				providerSandboxSource({
					operation: "details",
					name: "Reingested E2E Provider details",
					slug: `${provider.providerSlug}.details`,
					result: fakeProviderDetailsResult({ properties: {}, name: "Reingested Entity" }),
				}),
			);

			const secondJob = yield* enqueueProviderEntityImport(providerClient, {
				externalId,
				providerId: provider.providerId,
			});
			const second = yield* pollProviderEntityImportResult(providerClient, secondJob.jobId);
			assertCompleted(second, "second import job");
			expect(second.data.id).toBe(first.data.id);
		}),
	);
});
