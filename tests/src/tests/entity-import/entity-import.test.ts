import { EntitySchemaSlug, SandboxScriptId } from "@ryot/contract/schema/brands";
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
	getFirstProviderScriptId,
	pollEntityImportResult,
	pollEntitySearchResult,
	queryInLibraryRelationship,
	installTestProvider,
	type InstalledProviderScript,
} from "~/fixtures";
import {
	assertCompleted,
	assertTaggedError,
	requireArray,
	requireObjectRecord,
} from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it } from "~/support/effect-test";

const IMPORT_EXTERNAL_ID = "e2e-audiobook-1";
const IMPORTED_NAME = "E2E Imported Audiobook";

let providerScript: InstalledProviderScript;

beforeAll(async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			providerScript = yield* installTestProvider({
				client,
				drivers: {
					search: fakeProviderSearchResult([
						{ externalId: IMPORT_EXTERNAL_ID, title: "E2E Audiobook One", subtitle: null },
						{ externalId: "e2e-audiobook-2", title: "E2E Audiobook Two", subtitle: 2 },
					]),
					details: fakeProviderDetailsResult({
						name: IMPORTED_NAME,
						properties: { description: "Imported by the e2e fake provider." },
					}),
				},
			});
		}),
	);
});

afterAll(async () => {
	await Effect.runPromise(uninstallTestProvider(providerScript));
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

	it.live("enqueues a provider search and completes with the seeded results", () =>
		Effect.gen(function* () {
			const { userId } = yield* createAuthenticatedClient();

			const { jobId } = yield* enqueueEntitySearch(userId, {
				context: { query: "test", page: 1, pageSize: 5 },
				scriptId: SandboxScriptId.make(providerScript.scriptId),
			});

			const result = yield* pollEntitySearchResult(userId, jobId);
			assertCompleted(result, "search job");
			const value = requireObjectRecord(result.value, "Expected search result to be an object");
			const items = requireArray(value.items, "Expected search result items to be an array");
			expect(items).toHaveLength(2);
		}),
	);
});

describe("POST /library/import — provider entity import", () => {
	it.live("returns 404 when the script does not exist", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema } = yield* findBuiltinSchemaWithProviders(client);

			const error = yield* Effect.flip(
				client.call((c) =>
					c.entityImport.import({
						payload: {
							entitySchemaSlug: schema.id,
							externalId: "some-external-id",
							scriptId: SandboxScriptId.make(crypto.randomUUID()),
						},
					}),
				),
			);

			assertTaggedError(error, "NotFound");
		}),
	);

	it.live("returns 404 when the entity schema does not exist", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema } = yield* findBuiltinSchemaWithProviders(client);
			const scriptId = getFirstProviderScriptId(schema);

			const error = yield* Effect.flip(
				client.call((c) =>
					c.entityImport.import({
						payload: {
							scriptId,
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
							scriptId: SandboxScriptId.make(crypto.randomUUID()),
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
				scriptId: SandboxScriptId.make(providerScript.scriptId),
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
});
