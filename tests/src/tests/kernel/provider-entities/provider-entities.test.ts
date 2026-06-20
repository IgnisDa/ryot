import { EntitySchemaSlug, SandboxProviderId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import {
	uninstallTestProvider,
	createAuthenticatedClient,
	enqueueProviderEntityImport,
	fakeProviderDetailsResult,
	fakeProviderSearchResult,
	findBuiltinSchemaBySlug,
	findBuiltinSchemaWithProviders,
	getBackendClient,
	providerSandboxSource,
	replaceSandboxScriptCompiledRepresentation,
	pollProviderEntityImportResult,
	queryInLibraryRelationship,
	searchProviderEntities,
	buildSavedViewLayouts,
	installTestProvider,
} from "~/fixtures";
import type { InstalledTestProvider } from "~/fixtures/sandbox-provider";
import { assertCompleted, assertPresent, assertTaggedError } from "~/support/assertions";
import { afterAll, assert, beforeAll, describe, expect, it } from "~/support/effect-test";

const IMPORT_EXTERNAL_ID = "e2e-audiobook-1";
const IMPORTED_NAME = "E2E Imported Audiobook";
const PLUGIN_SLUG = `provider-entities-${crypto.randomUUID()}`;
const VIEW_SLUG = `provider-entities-search-${crypto.randomUUID()}`;
const PROVIDER_SLUG = `audiobook.provider-entities-${crypto.randomUUID()}`;

let provider: InstalledTestProvider;

beforeAll(async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema } = yield* findBuiltinSchemaBySlug(client, "audiobook");
			provider = yield* installTestProvider({
				pluginSlug: PLUGIN_SLUG,
				slug: PROVIDER_SLUG,
				client,
				linkToEntitySchemaSlug: schema.id,
				search: fakeProviderSearchResult([
					{ externalId: IMPORT_EXTERNAL_ID, title: "E2E Audiobook One", subtitle: null },
					{ externalId: "e2e-audiobook-2", title: "E2E Audiobook Two", subtitle: 2 },
				]),
				details: fakeProviderDetailsResult({
					name: IMPORTED_NAME,
					properties: { description: "Imported by the e2e fake provider." },
				}),
				savedViews: [
					{
						pluginSlug: PLUGIN_SLUG,
						icon: "book",
						name: "Provider Entities Search",
						slug: VIEW_SLUG,
						sortOrder: 0,
						layouts: buildSavedViewLayouts({}, [schema.id]),
						sandboxScripts: { search: [`${PROVIDER_SLUG}.search`] },
					},
				],
			});
		}),
	);
});

afterAll(async () => {
	await Effect.runPromise(uninstallTestProvider(provider));
});

describe("provider entity search", () => {
	it.live("uses separate search and details scripts through one provider identity", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const search = yield* searchProviderEntities(client, {
				savedViewSlug: VIEW_SLUG,
				query: "test",
				page: 1,
				pageSize: 5,
			});
			const result = search.providers.find(({ providerId }) => providerId === provider.providerId);
			assertPresent(result, "Expected installed provider in search results");
			expect(result.status).toBe("success");
			if (result.status !== "success") {
				throw new Error("Expected installed provider search to succeed");
			}
			expect(result.items).toHaveLength(2);
			const firstItem = result.items[0];
			assertPresent(firstItem, "Expected the first search item");
			expect(firstItem.externalId).toBe(IMPORT_EXTERNAL_ID);

			const { jobId: importJobId } = yield* enqueueProviderEntityImport(client, {
				providerId: result.providerId,
				entitySchemaSlug: result.entitySchemaSlug,
				externalId: firstItem.externalId,
			});
			const imported = yield* pollProviderEntityImportResult(client, importJobId);
			assertCompleted(imported, "import job");
			expect(imported.data.name).toBe(IMPORTED_NAME);
		}),
	);
});

describe("POST /provider-entities/imports — provider entity import", () => {
	it.live("returns a failed import job when the provider does not exist", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema } = yield* findBuiltinSchemaWithProviders(client);

			const missingProviderId = SandboxProviderId.make(crypto.randomUUID());
			const { jobId } = yield* enqueueProviderEntityImport(client, {
				providerId: missingProviderId,
				entitySchemaSlug: schema.id,
				externalId: "some-external-id",
			});
			expect(jobId).toBeTruthy();

			const result = yield* pollProviderEntityImportResult(client, jobId);
			assert(result.status === "failed");
		}),
	);

	it.live("returns 404 when the entity schema does not exist", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const error = yield* Effect.flip(
				client.call((c) =>
					c.providerEntities.import({
						payload: {
							providerId: provider.providerId,
							externalId: "some-external-id",
							entitySchemaSlug: EntitySchemaSlug.make(crypto.randomUUID()),
						},
					}),
				),
			);

			assertTaggedError(error, "NotFound");
		}),
	);

	it.live("returns 404 for unknown import job id", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const error = yield* Effect.flip(
				client.call((c) =>
					c.providerEntities.getImportResult({ params: { jobId: crypto.randomUUID() } }),
				),
			);

			assertTaggedError(error, "NotFound");
			expect(error.message).toBe("Entity import job not found");
		}),
	);

	it.live("returns 401 for unauthenticated import requests", () =>
		Effect.gen(function* () {
			const client = getBackendClient();

			const error = yield* Effect.flip(
				client.call((c) =>
					c.providerEntities.import({
						payload: {
							externalId: "some-id",
							providerId: SandboxProviderId.make(crypto.randomUUID()),
							entitySchemaSlug: EntitySchemaSlug.make(crypto.randomUUID()),
						},
					}),
				),
			);

			assertTaggedError(error, "Unauthorized");
		}),
	);
});

describe("GET /provider-entities/imports/:jobId — provider entity import result", () => {
	it.live("populates an entity without adding it to the media library", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema } = yield* findBuiltinSchemaBySlug(client, "audiobook");

			const { jobId } = yield* enqueueProviderEntityImport(client, {
				entitySchemaSlug: schema.id,
				externalId: IMPORT_EXTERNAL_ID,
				providerId: provider.providerId,
			});

			const result = yield* pollProviderEntityImportResult(client, jobId);

			assertCompleted(result, "import job");
			expect(result.data.id).toBeDefined();
			expect(result.data.name).toBe(IMPORTED_NAME);
			expect(result.data.entitySchemaSlug).toBe(schema.id);

			const inLibrary = yield* queryInLibraryRelationship(client, result.data.id, schema.slug);
			expect(
				inLibrary.data.entity?.type === "rows" ? inLibrary.data.entity.items : [],
			).toHaveLength(0);
		}),
	);

	it.live("preserves entity identity when the provider details script is reingested", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema } = yield* findBuiltinSchemaBySlug(client, "audiobook");
			const externalId = `e2e-reingestion-${crypto.randomUUID()}`;
			const firstJob = yield* enqueueProviderEntityImport(client, {
				externalId,
				entitySchemaSlug: schema.id,
				providerId: provider.providerId,
			});
			const first = yield* pollProviderEntityImportResult(client, firstJob.jobId);
			assertCompleted(first, "first import job");

			yield* replaceSandboxScriptCompiledRepresentation(
				client,
				provider.detailsScriptId,
				providerSandboxSource({
					operation: "details",
					name: "Reingested E2E Provider details",
					slug: `${provider.providerSlug}.details`,
					result: fakeProviderDetailsResult({ name: "Reingested Entity", properties: {} }),
				}),
			);

			const secondJob = yield* enqueueProviderEntityImport(client, {
				externalId,
				entitySchemaSlug: schema.id,
				providerId: provider.providerId,
			});
			const second = yield* pollProviderEntityImportResult(client, secondJob.jobId);
			assertCompleted(second, "second import job");
			expect(second.data.id).toBe(first.data.id);
		}),
	);
});
