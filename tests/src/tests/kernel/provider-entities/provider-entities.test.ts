import { SandboxProviderId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import {
	uninstallTestProvider,
	createAuthenticatedClient,
	enqueueProviderEntityImport,
	fakeProviderDetailsResult,
	fakeProviderSearchResult,
	findBuiltinSchemaBySlug,
	getBackendClient,
	providerSandboxSource,
	replaceSandboxScriptCompiledRepresentation,
	pollProviderEntityImportResult,
	queryInLibraryRelationship,
	searchProviderEntities,
	installTestProvider,
} from "~/fixtures";
import type { InstalledTestProvider } from "~/fixtures/sandbox-provider";
import { assertCompleted, assertPresent, assertTaggedError } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it } from "~/support/effect-test";

const IMPORT_EXTERNAL_ID = "e2e-audiobook-1";
const IMPORTED_NAME = "E2E Imported Audiobook";
const PLUGIN_SLUG = `provider-entities-${crypto.randomUUID()}`;
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
				rootEntitySchemaSlug: schema.id,
				search: fakeProviderSearchResult([
					{ externalId: IMPORT_EXTERNAL_ID, title: "E2E Audiobook One", subtitle: null },
					{ externalId: "e2e-audiobook-2", title: "E2E Audiobook Two", subtitle: 2 },
				]),
				details: fakeProviderDetailsResult({
					name: IMPORTED_NAME,
					properties: { description: "Imported by the e2e fake provider." },
				}),
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
				providerId: provider.providerId,
				query: "test",
				page: 1,
				pageSize: 5,
			});
			expect(search.providerId).toBe(provider.providerId);
			expect(search.items).toHaveLength(2);
			const firstItem = search.items[0];
			assertPresent(firstItem, "Expected the first search item");
			expect(firstItem.externalId).toBe(IMPORT_EXTERNAL_ID);

			const { jobId: importJobId } = yield* enqueueProviderEntityImport(client, {
				providerId: search.providerId,
				externalId: firstItem.externalId,
			});
			const imported = yield* pollProviderEntityImportResult(client, importJobId);
			assertCompleted(imported, "import job");
			expect(imported.data.name).toBe(IMPORTED_NAME);
		}),
	);
});

describe("POST /provider-entities/imports — provider entity import", () => {
	it.live("returns 404 when the provider does not exist", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const missingProviderId = SandboxProviderId.make(crypto.randomUUID());
			const error = yield* Effect.flip(
				client.call((c) =>
					c.providerEntities.import({
						payload: { providerId: missingProviderId, externalId: "some-external-id" },
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
			const externalId = `e2e-reingestion-${crypto.randomUUID()}`;
			const firstJob = yield* enqueueProviderEntityImport(client, {
				externalId,
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
				providerId: provider.providerId,
			});
			const second = yield* pollProviderEntityImportResult(client, secondJob.jobId);
			assertCompleted(second, "second import job");
			expect(second.data.id).toBe(first.data.id);
		}),
	);
});
