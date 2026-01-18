import { EntitySchemaSlug, SandboxScriptId } from "@ryot/contract/schema/brands";
import { DateTime, Effect } from "effect";

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
	getGlobalEntityByProvenance,
	getRelationshipBySchemaSlug,
	pollEntityImportResult,
	pollEntitySearchResult,
	installTestProvider,
	type InstalledProviderScript,
} from "~/fixtures";
import {
	assertCompleted,
	assertPresent,
	assertTaggedError,
	requireArray,
	requireObjectRecord,
} from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it } from "~/support/effect-test";

const BOOK_IMPORT_NAME = "E2E Imported Book";
const ANIME_IMPORT_NAME = "E2E Imported Anime";
const RELATED_COMPANY_NAME = "E2E Studio";
const RELATED_COMPANY_EXTERNAL_ID = "e2e-company-1";

let bookProvider: InstalledProviderScript;
let animeProvider: InstalledProviderScript;
let companyProvider: InstalledProviderScript;

const bookScriptId = () => SandboxScriptId.make(bookProvider.scriptId);

beforeAll(async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema: companySchema } = yield* findBuiltinSchemaBySlug(client, "company");

			companyProvider = yield* installTestProvider({
				client,
				linkToEntitySchemaSlug: companySchema.id,
				drivers: {
					details: fakeProviderDetailsResult({ name: RELATED_COMPANY_NAME, properties: {} }),
				},
			});

			animeProvider = yield* installTestProvider({
				client,
				drivers: {
					details: fakeProviderDetailsResult({
						name: ANIME_IMPORT_NAME,
						properties: { description: "Imported anime from the e2e fake provider." },
						relatedEntityGroups: [
							{
								direction: "incoming",
								synchronization: "additive",
								relationshipSchemaSlug: "company-to-anime",
								entities: [
									{
										name: RELATED_COMPANY_NAME,
										scriptSlug: companyProvider.slug,
										externalId: RELATED_COMPANY_EXTERNAL_ID,
										relationshipProperties: { roles: ["E2E Animation Studio"] },
									},
								],
							},
						],
					}),
				},
			});

			bookProvider = yield* installTestProvider({
				client,
				drivers: {
					search: fakeProviderSearchResult([
						{ externalId: "e2e-book-1", title: "E2E Book One", subtitle: null },
						{ externalId: "e2e-book-2", title: "E2E Book Two", subtitle: 2 },
					]),
					details: fakeProviderDetailsResult({
						name: BOOK_IMPORT_NAME,
						properties: { description: "Imported book from the e2e fake provider." },
					}),
				},
			});
		}),
	);
});

afterAll(async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			yield* uninstallTestProvider(animeProvider);
			yield* uninstallTestProvider(companyProvider);
			yield* uninstallTestProvider(bookProvider);
		}),
	);
});

describe("provider entity search enqueue", () => {
	it.live("returns 404 when the scriptId does not exist", () =>
		Effect.gen(function* () {
			const { userId } = yield* createAuthenticatedClient();

			const error = yield* Effect.flip(
				enqueueEntitySearch(userId, {
					scriptId: SandboxScriptId.make(crypto.randomUUID()),
				}),
			);

			assertTaggedError(error, "NotFound");
			expect(error.message).toBe("Sandbox script not found");
		}),
	);

	it.live("returns 200 with a jobId when given a valid script", () =>
		Effect.gen(function* () {
			const { userId } = yield* createAuthenticatedClient();

			const { jobId } = yield* enqueueEntitySearch(userId, {
				scriptId: bookScriptId(),
				context: { page: 1, pageSize: 5, query: "test" },
			});

			expect(typeof jobId).toBe("string");
			expect(jobId.length).toBeGreaterThan(0);
		}),
	);
});

describe("provider entity search result", () => {
	it.live("completes a search and returns the seeded results", () =>
		Effect.gen(function* () {
			const { userId } = yield* createAuthenticatedClient();

			const { jobId } = yield* enqueueEntitySearch(userId, {
				scriptId: bookScriptId(),
				context: { page: 1, pageSize: 5, query: "test" },
			});

			const result = yield* pollEntitySearchResult(userId, jobId, { timeoutMs: 30_000 });
			assertCompleted(result, "search job");
			const value = requireObjectRecord(result.value, "Expected search result to be an object");
			const items = requireArray(value.items, "Expected search result items to be an array");
			expect(items).toHaveLength(2);
		}),
	);
});

describe("POST /library/import", () => {
	it.live("returns 401 when unauthenticated", () =>
		Effect.gen(function* () {
			const client = getBackendClient();
			const error = yield* Effect.flip(
				client.call((c) =>
					c.entityImport.import({
						payload: {
							externalId: "test-id",
							scriptId: SandboxScriptId.make(crypto.randomUUID()),
							entitySchemaSlug: EntitySchemaSlug.make(crypto.randomUUID()),
						},
					}),
				),
			);

			assertTaggedError(error, "Unauthorized");
		}),
	);

	it.live("returns 200 with a jobId when given a valid script and schema", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema } = yield* findBuiltinSchemaWithProviders(client);

			const { jobId } = yield* enqueueEntityImport(client, {
				scriptId: bookScriptId(),
				externalId: "e2e-book-1",
				entitySchemaSlug: schema.id,
			});

			expect(typeof jobId).toBe("string");
			expect(jobId.length).toBeGreaterThan(0);
		}),
	);
});

describe("GET /library/import/{jobId}", () => {
	it.live("returns 401 when unauthenticated", () =>
		Effect.gen(function* () {
			const client = getBackendClient();
			const error = yield* Effect.flip(
				client.call((c) =>
					c.entityImport.getImportResult({ path: { jobId: crypto.randomUUID() } }),
				),
			);

			assertTaggedError(error, "Unauthorized");
		}),
	);

	it.live("returns 404 for a non-existent job id", () =>
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

	it.live("returns 404 when another user polls the import job", () =>
		Effect.gen(function* () {
			const { client: clientA } = yield* createAuthenticatedClient();
			const { client: clientB } = yield* createAuthenticatedClient();

			const { schema } = yield* findBuiltinSchemaWithProviders(clientA);

			const { jobId } = yield* enqueueEntityImport(clientA, {
				scriptId: bookScriptId(),
				externalId: "e2e-book-crossuser",
				entitySchemaSlug: schema.id,
			});

			const error = yield* Effect.flip(
				clientB.call((c) => c.entityImport.getImportResult({ path: { jobId } })),
			);

			assertTaggedError(error, "NotFound");
			expect(error.message).toBe("Entity import job not found");
		}),
	);

	it.live("completes an import for a valid details script", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema } = yield* findBuiltinSchemaWithProviders(client);

			const { jobId } = yield* enqueueEntityImport(client, {
				scriptId: bookScriptId(),
				externalId: "e2e-book-terminal",
				entitySchemaSlug: schema.id,
			});

			const result = yield* pollEntityImportResult(client, jobId, { timeoutMs: 30_000 });

			assertCompleted(result, "import job");
			expect(result.data.name).toBe(BOOK_IMPORT_NAME);
		}),
	);

	it.live(
		"returns entity with populated properties and related entities in the completed result",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const { schema } = yield* findBuiltinSchemaBySlug(client, "anime");
				const { schema: companySchema } = yield* findBuiltinSchemaBySlug(client, "company");

				const { jobId } = yield* enqueueEntityImport(client, {
					externalId: "e2e-anime-1",
					scriptId: SandboxScriptId.make(animeProvider.scriptId),
					entitySchemaSlug: schema.id,
				});

				const result = yield* pollEntityImportResult(client, jobId, { timeoutMs: 30_000 });

				assertCompleted(result, "import job");

				const properties = requireObjectRecord(
					result.data.properties,
					"Expected imported entity properties to be an object",
				);
				expect(properties).not.toEqual({});
				expect(properties.populatedAt).toBeUndefined();

				const relatedEntity = yield* getGlobalEntityByProvenance(client, {
					entitySchemaSlug: companySchema.slug,
					externalId: RELATED_COMPANY_EXTERNAL_ID,
					sandboxScriptId: companyProvider.scriptId,
				});
				expect(relatedEntity.name).toBe(RELATED_COMPANY_NAME);
				expect(relatedEntity.populatedAt).toBeNull();

				const relationship = yield* getRelationshipBySchemaSlug(client, {
					targetEntityId: result.data.id,
					sourceEntityId: relatedEntity.id,
					relationshipSchemaSlug: "company-to-anime",
				});
				expect(relationship.sourceEntityId).toBe(relatedEntity.id);
				expect(relationship.targetEntityId).toBe(result.data.id);
				expect(relationship.properties).toMatchObject({ roles: ["E2E Animation Studio"] });
			}),
	);

	it.live("sets populatedAt as a UTC ISO timestamp column on the imported entity", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema } = yield* findBuiltinSchemaWithProviders(client);

			const { jobId } = yield* enqueueEntityImport(client, {
				scriptId: bookScriptId(),
				entitySchemaSlug: schema.id,
				externalId: "e2e-book-populatedat",
			});

			const result = yield* pollEntityImportResult(client, jobId, { timeoutMs: 30_000 });

			assertCompleted(result, "import job");

			const populatedAt = result.data.populatedAt;

			assertPresent(populatedAt, "Expected populatedAt to be present on the imported entity");
			expect(typeof populatedAt).toBe("string");
			expect(DateTime.formatIso(DateTime.unsafeMake(populatedAt))).toBe(populatedAt);
		}),
	);
});
