import { SandboxProviderId } from "@ryot-app/contract/schema/brands";
import { providerEntityLinksRecipe } from "@ryot-app/ryotql-recipes/provider-entity-links";
import { Effect } from "effect";

import type { Client } from "~/fixtures/kernel";
import {
	uninstallTestProvider,
	createAuthenticatedClient,
	enqueueProviderEntityImport,
	fakeProviderDetailsResult,
	fakeProviderSearchResult,
	findBuiltinSchemaBySlug,
	getApiClient,
	executeRyotQLRecipe,
	providerSandboxSource,
	replaceSandboxScriptCompiledRepresentation,
	pollProviderEntityImportResult,
	searchProviderEntities,
	installTestProvider,
} from "~/fixtures/kernel";
import type { InstalledTestProvider } from "~/fixtures/kernel/sandbox-provider";
import { queryInLibraryRelationship } from "~/fixtures/plugins/media";
import { assertCompleted, assertPresent, assertTaggedError } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it } from "~/support/effect-test";

const IMPORT_EXTERNAL_ID = "e2e-private-record-1";
const IMPORTED_NAME = "E2E Imported Private Record";
const PLUGIN_SLUG = `provider-entities-${crypto.randomUUID()}`;
const ENTITY_SCHEMA_SLUG = `private-record-${crypto.randomUUID()}`;
const PROVIDER_SLUG = `${ENTITY_SCHEMA_SLUG}.provider-entities`;

let providerClient: Client;
let provider: InstalledTestProvider;
let audiobookProvider: InstalledTestProvider;
let workoutProvider: InstalledTestProvider;

beforeAll(async () => {
	await Effect.runPromise(
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
			const { schema: audiobookSchema } = yield* findBuiltinSchemaBySlug(client, "audiobook");
			audiobookProvider = yield* installTestProvider({
				client,
				rootEntitySchemaSlug: audiobookSchema.id,
				details: fakeProviderDetailsResult({ properties: {}, name: "E2E Imported Audiobook" }),
			});
			const { schema: workoutSchema } = yield* findBuiltinSchemaBySlug(client, "workout");
			workoutProvider = yield* installTestProvider({
				client,
				rootEntitySchemaSlug: workoutSchema.id,
				details: fakeProviderDetailsResult({ properties: {}, name: "E2E Imported Workout" }),
			});
		}),
	);
});

afterAll(async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			yield* uninstallTestProvider(workoutProvider);
			yield* uninstallTestProvider(audiobookProvider);
			yield* uninstallTestProvider(provider);
		}),
	);
});

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

describe("POST /provider-entities/imports — provider entity import", () => {
	it.live("returns 404 when the provider does not exist", () =>
		Effect.gen(function* () {
			const missingProviderId = SandboxProviderId.make(crypto.randomUUID());
			const error = yield* Effect.flip(
				providerClient.call((c) =>
					c.providerEntities.import({
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
					c.providerEntities.getImportResult({ params: { jobId: crypto.randomUUID() } }),
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
					c.providerEntities.import({
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

describe("GET /provider-entities/imports/:jobId — provider entity import result", () => {
	it.live("adds imported media entities to the user's library", () =>
		Effect.gen(function* () {
			const { schema } = yield* findBuiltinSchemaBySlug(providerClient, "audiobook");
			const externalId = `e2e-library-link-${crypto.randomUUID()}`;

			const { jobId } = yield* enqueueProviderEntityImport(providerClient, {
				externalId,
				providerId: audiobookProvider.providerId,
			});
			const result = yield* pollProviderEntityImportResult(providerClient, jobId);
			assertCompleted(result, "entity import");

			const withMembership = yield* executeRyotQLRecipe(
				providerClient,
				providerEntityLinksRecipe({
					externalIds: [externalId],
					entitySchemaSlug: schema.id,
					providerId: audiobookProvider.providerId,
				}),
			);
			expect(withMembership).toHaveLength(1);
		}),
	);

	it.live("does not add schemas without a provider-import automation to the library", () =>
		Effect.gen(function* () {
			const { schema } = yield* findBuiltinSchemaBySlug(providerClient, "workout");

			const { jobId } = yield* enqueueProviderEntityImport(providerClient, {
				providerId: workoutProvider.providerId,
				externalId: `e2e-workout-${crypto.randomUUID()}`,
			});

			const result = yield* pollProviderEntityImportResult(providerClient, jobId);

			assertCompleted(result, "import job");
			expect(result.data.id).toBeDefined();
			expect(result.data.name).toBe("E2E Imported Workout");
			expect(result.data.entitySchemaSlug).toBe(schema.id);

			const inLibrary = yield* queryInLibraryRelationship(
				providerClient,
				result.data.id,
				schema.slug,
			);
			expect(
				inLibrary.data.entity?.type === "rows" ? inLibrary.data.entity.items : [],
			).toHaveLength(0);
		}),
	);

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
