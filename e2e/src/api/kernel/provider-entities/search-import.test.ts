import { SandboxProviderId } from "@ryot-app/contract/schema/brands";
import { DateTime, Effect } from "effect";

import type { Client } from "~/fixtures/kernel";
import {
	uninstallTestProvider,
	createAuthenticatedClient,
	enqueueProviderEntityImport,
	fakeProviderDetailsResult,
	fakeProviderSearchResult,
	findBuiltinSchemaBySlug,
	getApiClient,
	pollProviderEntityImportResult,
	searchProviderEntities,
	installTestProvider,
} from "~/fixtures/kernel";
import type { InstalledTestProvider } from "~/fixtures/kernel/sandbox-provider";
import {
	getVisibleEntityByProvenance,
	getRelationshipBySchemaSlug,
	queryInMediaLibraryRelationship,
} from "~/fixtures/plugins/media";
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

let providerClient: Client;
let bookProvider: InstalledTestProvider;
let animeProvider: InstalledTestProvider;
let companyProvider: InstalledTestProvider;

beforeAll(async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			providerClient = client;
			const { schema: companySchema } = yield* findBuiltinSchemaBySlug(client, "company");
			const { schema: animeSchema } = yield* findBuiltinSchemaBySlug(client, "anime");
			const { schema: bookSchema } = yield* findBuiltinSchemaBySlug(client, "book");

			companyProvider = yield* installTestProvider({
				client,
				rootEntitySchemaSlug: companySchema.id,
				details: fakeProviderDetailsResult({ properties: {}, name: RELATED_COMPANY_NAME }),
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
									externalId: RELATED_COMPANY_EXTERNAL_ID,
									providerSlug: companyProvider.providerSlug,
									relationshipProperties: { roles: ["E2E Animation Studio"] },
								},
							],
						},
					],
				}),
			});

			bookProvider = yield* installTestProvider({
				client,
				pluginSlug: PLUGIN_SLUG,
				slug: BOOK_PROVIDER_SLUG,
				rootEntitySchemaSlug: bookSchema.id,
				details: fakeProviderDetailsResult({
					name: BOOK_IMPORT_NAME,
					properties: { description: "Imported book from the e2e fake provider." },
				}),
				search: fakeProviderSearchResult([
					{ title: "E2E Book One", externalId: "e2e-book-1" },
					{ metadata: [2], title: "E2E Book Two", externalId: "e2e-book-2" },
				]),
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
			const search = yield* searchProviderEntities(providerClient, {
				page: 1,
				pageSize: 5,
				query: "test",
				providerId: bookProvider.providerId,
			});
			expect(search.providerId).toBe(bookProvider.providerId);
			expect(search.items).toEqual([
				{ title: "E2E Book One", externalId: "e2e-book-1" },
				{ metadata: [2], title: "E2E Book Two", externalId: "e2e-book-2" },
			]);
		}),
	);
});

describe("POST /provider-entities/imports", () => {
	it.live("returns 401 when unauthenticated", () =>
		Effect.gen(function* () {
			const client = getApiClient();
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

			assertTaggedError(error, "AuthUnauthorized");
		}),
	);

	it.live("returns 200 with a jobId when given a valid provider", () =>
		Effect.gen(function* () {
			const { jobId } = yield* enqueueProviderEntityImport(providerClient, {
				externalId: "e2e-book-1",
				providerId: bookProvider.providerId,
			});

			expect(typeof jobId).toBe("string");
			expect(jobId.length).toBeGreaterThan(0);
			yield* pollProviderEntityImportResult(providerClient, jobId);
		}),
	);
});

describe("GET /provider-entities/imports/{jobId}", () => {
	it.live("returns 401 when unauthenticated", () =>
		Effect.gen(function* () {
			const client = getApiClient();
			const error = yield* Effect.flip(
				client.call((c) =>
					c.providerEntities.getImportResult({ params: { jobId: crypto.randomUUID() } }),
				),
			);

			assertTaggedError(error, "AuthUnauthorized");
		}),
	);

	it.live("returns 404 for a non-existent job id", () =>
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

	it.live("returns 404 when another user polls the import job", () =>
		Effect.gen(function* () {
			const { client: clientB } = yield* createAuthenticatedClient();

			const { jobId } = yield* enqueueProviderEntityImport(providerClient, {
				externalId: "e2e-book-crossuser",
				providerId: bookProvider.providerId,
			});

			const error = yield* Effect.flip(
				clientB.call((c) => c.providerEntities.getImportResult({ params: { jobId } })),
			);

			assertTaggedError(error, "ProviderEntityNotFound");
			expect(error.reason).toEqual({ jobId, code: "import-job-not-found" });
		}),
	);

	it.live("completes an import for a valid details script", () =>
		Effect.gen(function* () {
			const { jobId } = yield* enqueueProviderEntityImport(providerClient, {
				externalId: "e2e-book-terminal",
				providerId: bookProvider.providerId,
			});

			const result = yield* pollProviderEntityImportResult(providerClient, jobId);

			assertCompleted(result, "import job");
			expect(result.data.name).toBe(BOOK_IMPORT_NAME);
			const inMediaLibrary = yield* queryInMediaLibraryRelationship(
				providerClient,
				result.data.id,
				"book",
			);
			expect(
				inMediaLibrary.data.entity?.type === "rows" ? inMediaLibrary.data.entity.items : [],
			).toHaveLength(1);
		}),
	);

	it.live(
		"returns entity with populated properties and related entities in the completed result",
		() =>
			Effect.gen(function* () {
				const { schema: companySchema } = yield* findBuiltinSchemaBySlug(providerClient, "company");

				const { jobId } = yield* enqueueProviderEntityImport(providerClient, {
					externalId: "e2e-anime-1",
					providerId: animeProvider.providerId,
				});

				const result = yield* pollProviderEntityImportResult(providerClient, jobId);

				assertCompleted(result, "import job");

				const properties = requireObjectRecord(
					result.data.properties,
					"Expected imported entity properties to be an object",
				);
				expect(properties).not.toEqual({});
				expect(properties.populatedAt).toBeUndefined();

				const relatedEntity = yield* getVisibleEntityByProvenance(providerClient, {
					entitySchemaSlug: companySchema.slug,
					providerId: companyProvider.providerId,
					externalId: RELATED_COMPANY_EXTERNAL_ID,
				});
				expect(relatedEntity.name).toBe(RELATED_COMPANY_NAME);
				expect(relatedEntity.populatedAt).toBeNull();

				const relationship = yield* getRelationshipBySchemaSlug(providerClient, {
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
			const { jobId } = yield* enqueueProviderEntityImport(providerClient, {
				externalId: "e2e-book-populatedat",
				providerId: bookProvider.providerId,
			});

			const result = yield* pollProviderEntityImportResult(providerClient, jobId);

			assertCompleted(result, "import job");

			const populatedAt = result.data.populatedAt;

			assertPresent(populatedAt, "Expected populatedAt to be present on the imported entity");
			expect(typeof populatedAt).toBe("string");
			expect(DateTime.formatIso(DateTime.makeUnsafe(populatedAt))).toBe(populatedAt);
		}),
	);
});
