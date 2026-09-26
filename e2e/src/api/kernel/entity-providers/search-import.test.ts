import { SandboxProviderId } from "@ryot-app/contract/schema/brands";
import { DateTime, Effect } from "effect";

import type { Client } from "~/fixtures/kernel";
import {
	uninstallTestProvider,
	createAuthenticatedClient,
	enqueueProviderEntityImport,
	fakeProviderDetailsResult,
	fakeProviderSearchResult,
	findRelationshipBySchema,
	getApiClient,
	getVisibleEntityByProvenance,
	installTestProviders,
	pollProviderEntityImportResult,
	searchProviderEntities,
	testProviderEntitySchema,
} from "~/fixtures/kernel";
import type { InstalledTestProvider } from "~/fixtures/kernel/sandbox-provider";
import {
	assertCompleted,
	assertPresent,
	assertTaggedError,
	requireObjectRecord,
} from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it, runPromise } from "~/support/effect-test";

const BOOK_IMPORT_NAME = "E2E Imported Book";
const ANIME_IMPORT_NAME = "E2E Imported Anime";
const RELATED_COMPANY_NAME = "E2E Studio";
const RELATED_COMPANY_EXTERNAL_ID = "e2e-company-1";
const COMPANY_TO_ANIME = "company-to-anime";

let providerClient: Client;
let bookProvider: InstalledTestProvider;
let animeProvider: InstalledTestProvider;
let companyProvider: InstalledTestProvider;

beforeAll(() =>
	runPromise(
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			providerClient = client;
			const companyProviderSlug = `company-${crypto.randomUUID()}`;
			({
				book: bookProvider,
				anime: animeProvider,
				company: companyProvider,
			} = yield* installTestProviders({
				client,
				relationshipSchemas: [
					{
						slug: COMPANY_TO_ANIME,
						name: "Company to anime",
						targetEntitySchemaSlug: "anime",
						sourceEntitySchemaSlug: "company",
						propertiesSchema: {
							fields: {
								roles: {
									type: "array",
									label: "Roles",
									description: "Roles",
									items: { label: "Role", type: "string", description: "Role" },
								},
							},
						},
					},
				],
				providers: {
					company: {
						slug: companyProviderSlug,
						rootEntitySchemaSlug: "company",
						details: fakeProviderDetailsResult({ properties: {}, name: RELATED_COMPANY_NAME }),
					},
					book: {
						rootEntitySchemaSlug: "book",
						details: fakeProviderDetailsResult({
							name: BOOK_IMPORT_NAME,
							properties: { description: "Imported book from the e2e fake provider." },
						}),
						search: fakeProviderSearchResult([
							{ title: "E2E Book One", externalId: "e2e-book-1" },
							{ metadata: [2], title: "E2E Book Two", externalId: "e2e-book-2" },
						]),
					},
					anime: {
						rootEntitySchemaSlug: "anime",
						details: fakeProviderDetailsResult({
							name: ANIME_IMPORT_NAME,
							properties: { description: "Imported anime from the e2e fake provider." },
							relatedEntityGroups: [
								{
									direction: "incoming",
									synchronization: "additive",
									relationshipSchemaSlug: COMPANY_TO_ANIME,
									entities: [
										{
											name: RELATED_COMPANY_NAME,
											providerSlug: companyProviderSlug,
											externalId: RELATED_COMPANY_EXTERNAL_ID,
											relationshipProperties: { roles: ["E2E Animation Studio"] },
										},
									],
								},
							],
						}),
					},
				},
			}));
		}),
	),
);

afterAll(() => runPromise(uninstallTestProvider(companyProvider)));

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

describe("POST /entity-providers/imports", () => {
	it.live("returns 401 when unauthenticated", () =>
		Effect.gen(function* () {
			const client = getApiClient();
			const error = yield* Effect.flip(
				client.call((c) =>
					c.entityProviders.import({
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

describe("GET /entity-providers/imports/{jobId}", () => {
	it.live("returns 401 when unauthenticated", () =>
		Effect.gen(function* () {
			const client = getApiClient();
			const error = yield* Effect.flip(
				client.call((c) =>
					c.entityProviders.getImportResult({ params: { jobId: crypto.randomUUID() } }),
				),
			);

			assertTaggedError(error, "AuthUnauthorized");
		}),
	);

	it.live("returns 404 for a non-existent job id", () =>
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

	it.live("returns 404 when another user polls the import job", () =>
		Effect.gen(function* () {
			const { client: clientB } = yield* createAuthenticatedClient();

			const { jobId } = yield* enqueueProviderEntityImport(providerClient, {
				externalId: "e2e-book-crossuser",
				providerId: bookProvider.providerId,
			});

			const error = yield* Effect.flip(
				clientB.call((c) => c.entityProviders.getImportResult({ params: { jobId } })),
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
		}),
	);

	it.live(
		"returns entity with populated properties and related entities in the completed result",
		() =>
			Effect.gen(function* () {
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
					entitySchemaSlug: "company",
					providerId: companyProvider.providerId,
					externalId: RELATED_COMPANY_EXTERNAL_ID,
				});
				expect(relatedEntity.name).toBe(RELATED_COMPANY_NAME);
				expect(relatedEntity.populatedAt).toBeNull();

				const relationship = yield* findRelationshipBySchema(providerClient, {
					targetEntityId: result.data.id,
					sourceEntityId: relatedEntity.id,
					relationshipSchemaSlug: COMPANY_TO_ANIME,
					owner: testProviderEntitySchema(animeProvider).owner,
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
