import { EntitySchemaSlug, SandboxProviderId, SandboxScriptId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import {
	uninstallTestProvider,
	createAuthenticatedClient,
	enqueueEntityImport,
	enqueueEntitySearch,
	fakeProviderDetailsResult,
	fakeProviderSearchResult,
	findBuiltinSchemaBySlug,
	findBuiltinSchemaWithProviders,
	getBackendClient,
	providerSandboxSource,
	replaceSandboxScriptCompiledRepresentation,
	pollEntityImportResult,
	pollSandboxResult,
	queryInLibraryRelationship,
	installTestProvider,
	type InstalledTestProvider,
} from "~/fixtures";
import {
	assertCompleted,
	assertPresent,
	assertTaggedError,
	requireArray,
	requireObjectRecord,
} from "~/support/assertions";
import { afterAll, assert, beforeAll, describe, expect, it } from "~/support/effect-test";

const IMPORT_EXTERNAL_ID = "e2e-audiobook-1";
const IMPORTED_NAME = "E2E Imported Audiobook";

let provider: InstalledTestProvider;

beforeAll(async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			provider = yield* installTestProvider({
				client,
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
	it.live("returns 404 when the script does not exist", () =>
		Effect.gen(function* () {
			const { userId } = yield* createAuthenticatedClient();

			const error = yield* Effect.flip(
				enqueueEntitySearch(userId, { scriptId: SandboxScriptId.make(crypto.randomUUID()) }),
			);

			assertTaggedError(error, "NotFound");
		}),
	);

	it.live("uses separate search and details scripts through one provider identity", () =>
		Effect.gen(function* () {
			const { client, userId } = yield* createAuthenticatedClient();
			const searchScriptId = provider.searchScriptId;
			assertPresent(searchScriptId, "Installed provider search script not found");

			const { jobId } = yield* enqueueEntitySearch(userId, {
				context: { query: "test", page: 1, pageSize: 5 },
				scriptId: searchScriptId,
			});

			const result = yield* pollSandboxResult(userId, jobId);
			assertCompleted(result, "search job");
			const value = requireObjectRecord(result.value, "Expected search result to be an object");
			const items = requireArray(value.items, "Expected search result items to be an array");
			expect(items).toHaveLength(2);
			const firstItem = requireObjectRecord(
				items[0],
				"Expected the first search item to be an object",
			);
			expect(firstItem.externalId).toBe(IMPORT_EXTERNAL_ID);

			const { schema } = yield* findBuiltinSchemaBySlug(client, "audiobook");
			const { jobId: importJobId } = yield* enqueueEntityImport(client, {
				providerId: provider.providerId,
				entitySchemaSlug: schema.id,
				externalId: IMPORT_EXTERNAL_ID,
			});
			const imported = yield* pollEntityImportResult(client, importJobId);
			assertCompleted(imported, "import job");
			expect(imported.data.name).toBe(IMPORTED_NAME);
		}),
	);
});

describe("POST /library/import — provider entity import", () => {
	it.live("returns a failed import job when the provider does not exist", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema } = yield* findBuiltinSchemaWithProviders(client);

			const missingProviderId = SandboxProviderId.make(crypto.randomUUID());
			const { jobId } = yield* enqueueEntityImport(client, {
				providerId: missingProviderId,
				entitySchemaSlug: schema.id,
				externalId: "some-external-id",
			});
			expect(jobId).toBeTruthy();

			const result = yield* pollEntityImportResult(client, jobId);
			assert(result.status === "failed");
		}),
	);

	it.live("returns 404 when the entity schema does not exist", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const error = yield* Effect.flip(
				client.call((c) =>
					c.entityImport.import({
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
					c.entityImport.getImportResult({ path: { jobId: crypto.randomUUID() } }),
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
					c.entityImport.import({
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

describe("GET /library/import/:jobId — provider entity import result", () => {
	it.live("enqueues a provider import and adds entity to library when completed", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema } = yield* findBuiltinSchemaBySlug(client, "audiobook");

			const { jobId } = yield* enqueueEntityImport(client, {
				entitySchemaSlug: schema.id,
				externalId: IMPORT_EXTERNAL_ID,
				providerId: provider.providerId,
			});

			const result = yield* pollEntityImportResult(client, jobId);

			assertCompleted(result, "import job");
			expect(result.data.id).toBeDefined();
			expect(result.data.name).toBe(IMPORTED_NAME);
			expect(result.data.entitySchemaSlug).toBe(schema.id);

			const inLibrary = yield* queryInLibraryRelationship(client, result.data.id, schema.slug);
			expect(inLibrary.data.items.length).toBeGreaterThan(0);
		}),
	);

	it.live("preserves entity identity when the provider details script is reingested", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema } = yield* findBuiltinSchemaBySlug(client, "audiobook");
			const externalId = `e2e-reingestion-${crypto.randomUUID()}`;
			const firstJob = yield* enqueueEntityImport(client, {
				externalId,
				entitySchemaSlug: schema.id,
				providerId: provider.providerId,
			});
			const first = yield* pollEntityImportResult(client, firstJob.jobId);
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

			const secondJob = yield* enqueueEntityImport(client, {
				externalId,
				entitySchemaSlug: schema.id,
				providerId: provider.providerId,
			});
			const second = yield* pollEntityImportResult(client, secondJob.jobId);
			assertCompleted(second, "second import job");
			expect(second.data.id).toBe(first.data.id);
		}),
	);
});
