import { Effect, Exit } from "effect";

import type { Client } from "~/fixtures/kernel";
import {
	createAuthenticatedClient,
	enqueueProviderEntityImport,
	fakeProviderDetailsResult,
	findRelationshipBySchema,
	getApiClient,
	getVisibleEntityByProvenance,
	installTestProviders,
	namespaceInstallation,
	openInterestWebSocketScoped,
	pollProviderEntityImportResult,
	pollUntil,
	populateRelatedThroughForegroundInterest,
	providerSandboxSource,
	relatedPageKey,
	replaceSandboxScriptCompiledRepresentation,
	sampleOperationalPressure,
	setEntityPopulatedAt,
	testProviderEntitySchema,
	uninstallTestProvider,
} from "~/fixtures/kernel";
import type { InstalledTestProvider } from "~/fixtures/kernel/sandbox-provider";
import { assertCompleted, requirePresent } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it, runPromise } from "~/support/effect-test";

const COMPANY_TO_MOVIE = "company-to-movie";
const MOVIE_PROVIDER_SLUG = `movie-${crypto.randomUUID()}`;
const MOVIE_IDS = ["movie-1", "movie-2", "movie-3", "movie-4"];

let client: Client;
let auth: { client: Client };
let studioProvider: InstalledTestProvider;
let movieProvider: InstalledTestProvider;

const movie = (externalId: string) => ({
	externalId,
	name: `E2E ${externalId}`,
	providerSlug: MOVIE_PROVIDER_SLUG,
});

const studioDetails = (
	entities: ReadonlyArray<ReturnType<typeof movie>>,
	continuation: { page: number },
) =>
	fakeProviderDetailsResult({
		name: "E2E Paged Studio",
		relatedEntityGroups: [
			{
				entities,
				continuation,
				direction: "outgoing",
				synchronization: "authoritative",
				relationshipSchemaSlug: COMPANY_TO_MOVIE,
			},
		],
	});

const pages = (
	...entries: ReadonlyArray<readonly [{ page: number }, string, { page: number } | null]>
) =>
	Object.fromEntries(
		entries.map(([continuation, externalId, next]) => [
			relatedPageKey(continuation),
			{ continuation: next, entities: [movie(externalId)] },
		]),
	);

beforeAll(() =>
	runPromise(
		Effect.gen(function* () {
			auth = yield* createAuthenticatedClient();
			({ client } = auth);
			({ movie: movieProvider, studio: studioProvider } = yield* installTestProviders({
				client,
				scope: "system",
				relationshipSchemas: [
					{
						slug: COMPANY_TO_MOVIE,
						name: "Company to movie",
						targetEntitySchemaSlug: "movie",
						propertiesSchema: { fields: {} },
						sourceEntitySchemaSlug: "company",
					},
				],
				providers: {
					movie: {
						slug: MOVIE_PROVIDER_SLUG,
						rootEntitySchemaSlug: "movie",
						details: fakeProviderDetailsResult({ name: "E2E Movie" }),
					},
					studio: {
						rootEntitySchemaSlug: "company",
						slug: `studio-${crypto.randomUUID()}`,
						details: studioDetails([movie("movie-1")], { page: 2 }),
						relatedPages: pages(
							[{ page: 2 }, "movie-2", { page: 3 }],
							[{ page: 3 }, "movie-3", { page: 4 }],
							[{ page: 4 }, "movie-4", null],
						),
					},
				},
			}));
			yield* getApiClient().adminCall((contract) =>
				contract.testSupport.reconcilePluginInstallations(),
			);
			yield* namespaceInstallation(client, studioProvider.pluginId);
		}),
	),
);

afterAll(() =>
	runPromise(
		Effect.all([uninstallTestProvider(studioProvider), uninstallTestProvider(movieProvider)], {
			discard: true,
		}),
	),
);

const setStudioResults = (
	details: ReturnType<typeof studioDetails>,
	relatedPages: ReturnType<typeof pages>,
) =>
	Effect.gen(function* () {
		yield* replaceSandboxScriptCompiledRepresentation(
			client,
			studioProvider.detailsScriptId,
			providerSandboxSource({
				result: details,
				operation: "details",
				name: "E2E Paged Studio details",
				slug: `${studioProvider.providerSlug}.details`,
			}),
		);
		yield* replaceSandboxScriptCompiledRepresentation(
			client,
			requirePresent(studioProvider.relatedScriptId, "Studio related script was not installed"),
			providerSandboxSource({
				operation: "related",
				result: relatedPages,
				name: "E2E Paged Studio related",
				slug: `${studioProvider.providerSlug}.related`,
			}),
		);
	});

const relatedMovieIds = (companyId: string) =>
	Effect.forEach(MOVIE_IDS, (externalId) =>
		Effect.exit(
			Effect.gen(function* () {
				const target = yield* getVisibleEntityByProvenance(client, {
					externalId,
					entitySchemaSlug: "movie",
					providerId: movieProvider.providerId,
				});
				return yield* findRelationshipBySchema(client, {
					sourceEntityId: companyId,
					targetEntityId: target.id,
					relationshipSchemaSlug: COMPANY_TO_MOVIE,
					owner: testProviderEntitySchema(studioProvider).owner,
				});
			}),
		).pipe(Effect.map((exit) => (Exit.isSuccess(exit) ? [externalId] : []))),
	).pipe(Effect.map((found) => found.flat()));

const importStudio = (externalId: string) =>
	Effect.gen(function* () {
		const { jobId } = yield* enqueueProviderEntityImport(client, {
			externalId,
			providerId: studioProvider.providerId,
		});
		const result = yield* pollProviderEntityImportResult(client, jobId);
		assertCompleted(result, "studio import job");
		return result.data;
	});

describe("paged related-entity groups", () => {
	it.live(
		"populates every page in separate script runs and later removes dropped relationships",
		() =>
			Effect.gen(function* () {
				const externalId = `studio-${crypto.randomUUID()}`;
				const before = (yield* sampleOperationalPressure([crypto.randomUUID()])).sandbox
					.totalExecutions;

				const company = yield* importStudio(externalId);
				expect(yield* relatedMovieIds(company.id)).toEqual([]);
				yield* populateRelatedThroughForegroundInterest(auth, company.id);

				yield* pollUntil(
					"every paged movie related",
					relatedMovieIds(company.id).pipe(
						Effect.map((found) => (found.length === MOVIE_IDS.length ? found : null)),
					),
				);
				const after = (yield* sampleOperationalPressure([crypto.randomUUID()])).sandbox
					.totalExecutions;
				expect(after - before).toBeGreaterThanOrEqual(4);

				yield* setStudioResults(
					studioDetails([movie("movie-1")], { page: 2 }),
					pages([{ page: 2 }, "movie-2", null]),
				);
				yield* setEntityPopulatedAt(company.id, null);
				const refresher = yield* createAuthenticatedClient();
				const socket = yield* openInterestWebSocketScoped(refresher);
				yield* socket.replaceInterest([company.id], [company.id]);

				expect(
					yield* pollUntil(
						"stale paged movies removed",
						relatedMovieIds(company.id).pipe(
							Effect.map((found) => (found.length === 2 ? found : null)),
						),
					),
				).toEqual(["movie-1", "movie-2"]);
			}),
	);
});
