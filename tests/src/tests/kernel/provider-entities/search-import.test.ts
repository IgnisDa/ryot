import { SandboxProviderId } from "@ryot/contract/schema/brands";
import { DateTime, Effect } from "effect";

import {
	uninstallTestProvider,
	createAuthenticatedClient,
	enqueueProviderEntityImport,
	fakeProviderDetailsResult,
	fakeProviderSearchResult,
	findBuiltinSchemaBySlug,
	getBackendClient,
	getGlobalEntityByProvenance,
	getRelationshipBySchemaSlug,
	pollProviderEntityImportResult,
	queryInLibraryRelationship,
	searchProviderEntities,
	installTestProvider,
} from "~/fixtures";
import type { InstalledTestProvider } from "~/fixtures/sandbox-provider";
import {
	assertCompleted,
	assertPresent,
	assertTaggedError,
	requireObjectRecord,
} from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it } from "~/support/effect-test";

const BOOK_IMPORT_NAME = "E2E Imported Book";
const ANIME_IMPORT_NAME = "E2E Imported Anime";
const RELATED_COMPANY_NAME = "E2E Studio";
const RELATED_COMPANY_EXTERNAL_ID = "e2e-company-1";
const PLUGIN_SLUG = `provider-entities-search-${crypto.randomUUID()}`;
const BOOK_PROVIDER_SLUG = `book.provider-entities-search-${crypto.randomUUID()}`;

let bookProvider: InstalledTestProvider;
let animeProvider: InstalledTestProvider;
let companyProvider: InstalledTestProvider;

beforeAll(async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema: companySchema } = yield* findBuiltinSchemaBySlug(client, "company");
			const { schema: animeSchema } = yield* findBuiltinSchemaBySlug(client, "anime");
			const { schema: bookSchema } = yield* findBuiltinSchemaBySlug(client, "book");

			companyProvider = yield* installTestProvider({
				client,
				rootEntitySchemaSlug: companySchema.id,
				details: fakeProviderDetailsResult({ name: RELATED_COMPANY_NAME, properties: {} }),
			});

			animeProvider = yield* installTestProvider({
				client,
				rootEntitySchemaSlug: animeSchema.id,
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
									providerSlug: companyProvider.providerSlug,
									externalId: RELATED_COMPANY_EXTERNAL_ID,
									relationshipProperties: { roles: ["E2E Animation Studio"] },
								},
							],
						},
					],
				}),
			});

			bookProvider = yield* installTestProvider({
				pluginSlug: PLUGIN_SLUG,
				slug: BOOK_PROVIDER_SLUG,
				client,
				rootEntitySchemaSlug: bookSchema.id,
				search: fakeProviderSearchResult([
					{ externalId: "e2e-book-1", title: "E2E Book One", subtitle: null },
					{ externalId: "e2e-book-2", title: "E2E Book Two", subtitle: 2 },
				]),
				details: fakeProviderDetailsResult({
					name: BOOK_IMPORT_NAME,
					properties: { description: "Imported book from the e2e fake provider." },
				}),
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

describe("provider entity search result", () => {
	it.live("returns the result from the configured provider", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const search = yield* searchProviderEntities(client, {
				providerId: bookProvider.providerId,
				query: "test",
				page: 1,
				pageSize: 5,
			});
			expect(search.providerId).toBe(bookProvider.providerId);
			expect(search.items).toHaveLength(2);
		}),
	);
});

describe("POST /provider-entities/imports", () => {
	it.live("returns 401 when unauthenticated", () =>
		Effect.gen(function* () {
			const client = getBackendClient();
			const error = yield* Effect.flip(
				client.call((c) =>
					c.providerEntities.import({
						payload: {
							externalId: "test-id",
							providerId: SandboxProviderId.make(crypto.randomUUID()),
						},
					}),
				),
			);

			assertTaggedError(error, "Unauthorized");
		}),
	);

	it.live("returns 200 with a jobId when given a valid provider", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { jobId } = yield* enqueueProviderEntityImport(client, {
				providerId: bookProvider.providerId,
				externalId: "e2e-book-1",
			});

			expect(typeof jobId).toBe("string");
			expect(jobId.length).toBeGreaterThan(0);
			yield* pollProviderEntityImportResult(client, jobId);
		}),
	);
});

describe("GET /provider-entities/imports/{jobId}", () => {
	it.live("returns 401 when unauthenticated", () =>
		Effect.gen(function* () {
			const client = getBackendClient();
			const error = yield* Effect.flip(
				client.call((c) =>
					c.providerEntities.getImportResult({ params: { jobId: crypto.randomUUID() } }),
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
					c.providerEntities.getImportResult({ params: { jobId: crypto.randomUUID() } }),
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

			const { jobId } = yield* enqueueProviderEntityImport(clientA, {
				providerId: bookProvider.providerId,
				externalId: "e2e-book-crossuser",
			});

			const error = yield* Effect.flip(
				clientB.call((c) => c.providerEntities.getImportResult({ params: { jobId } })),
			);

			assertTaggedError(error, "NotFound");
			expect(error.message).toBe("Entity import job not found");
		}),
	);

	it.live("completes an import for a valid details script", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { jobId } = yield* enqueueProviderEntityImport(client, {
				providerId: bookProvider.providerId,
				externalId: "e2e-book-terminal",
			});

			const result = yield* pollProviderEntityImportResult(client, jobId);

			assertCompleted(result, "import job");
			expect(result.data.name).toBe(BOOK_IMPORT_NAME);
			const inLibrary = yield* queryInLibraryRelationship(client, result.data.id, "book");
			expect(
				inLibrary.data.entity?.type === "rows" ? inLibrary.data.entity.items : [],
			).toHaveLength(1);
		}),
	);

	it.live(
		"returns entity with populated properties and related entities in the completed result",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const { schema: companySchema } = yield* findBuiltinSchemaBySlug(client, "company");

				const { jobId } = yield* enqueueProviderEntityImport(client, {
					externalId: "e2e-anime-1",
					providerId: animeProvider.providerId,
				});

				const result = yield* pollProviderEntityImportResult(client, jobId);

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
					providerId: companyProvider.providerId,
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

			const { jobId } = yield* enqueueProviderEntityImport(client, {
				providerId: bookProvider.providerId,
				externalId: "e2e-book-populatedat",
			});

			const result = yield* pollProviderEntityImportResult(client, jobId);

			assertCompleted(result, "import job");

			const populatedAt = result.data.populatedAt;

			assertPresent(populatedAt, "Expected populatedAt to be present on the imported entity");
			expect(typeof populatedAt).toBe("string");
			expect(DateTime.formatIso(DateTime.makeUnsafe(populatedAt))).toBe(populatedAt);
		}),
	);
});
