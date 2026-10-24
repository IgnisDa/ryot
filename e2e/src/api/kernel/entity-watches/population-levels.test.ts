import { Effect, Exit } from "effect";

import {
	createAuthenticatedClient,
	enqueueProviderEntityImport,
	fakeProviderDetailsResult,
	findRelationshipBySchema,
	getEntity,
	getVisibleEntityByProvenance,
	installTestProviders,
	openInterestWebSocketScoped,
	pollProviderEntityImportResult,
	pollUntil,
	testProviderEntitySchema,
	uninstallTestProvider,
	waitOutGraceWindow,
} from "~/fixtures/kernel";
import type { InstalledTestProvider } from "~/fixtures/kernel/sandbox-provider";
import { assertCompleted } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it, runPromise } from "~/support/effect-test";

const COMPANY_TO_ANIME = "company-to-anime";

let auth: Effect.Success<ReturnType<typeof createAuthenticatedClient>>;
let animeProvider: InstalledTestProvider;
let companyProvider: InstalledTestProvider;
const companyExternalId = `e2e-level-company-${crypto.randomUUID()}`;

beforeAll(() =>
	runPromise(
		Effect.gen(function* () {
			auth = yield* createAuthenticatedClient();
			const companyProviderSlug = `level-company-${crypto.randomUUID()}`;
			({ anime: animeProvider, company: companyProvider } = yield* installTestProviders({
				client: auth.client,
				relationshipSchemas: [
					{
						slug: COMPANY_TO_ANIME,
						name: "Company to anime",
						targetEntitySchemaSlug: "anime",
						propertiesSchema: { fields: {} },
						sourceEntitySchemaSlug: "company",
					},
				],
				providers: {
					company: {
						slug: companyProviderSlug,
						rootEntitySchemaSlug: "company",
						details: fakeProviderDetailsResult({ name: "E2E Level Studio" }),
					},
					anime: {
						rootEntitySchemaSlug: "anime",
						details: fakeProviderDetailsResult({
							name: "E2E Level Anime",
							relatedEntityGroups: [
								{
									direction: "incoming",
									synchronization: "additive",
									relationshipSchemaSlug: COMPANY_TO_ANIME,
									entities: [
										{
											name: "E2E Level Studio",
											externalId: companyExternalId,
											providerSlug: companyProviderSlug,
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

const importAnime = Effect.gen(function* () {
	const { jobId } = yield* enqueueProviderEntityImport(auth.client, {
		providerId: animeProvider.providerId,
		externalId: `e2e-level-anime-${crypto.randomUUID()}`,
	});
	const result = yield* pollProviderEntityImportResult(auth.client, jobId);
	assertCompleted(result, "base-level anime import");
	return result.data;
});

const companyRelationship = (animeId: string) =>
	Effect.gen(function* () {
		const company = yield* getVisibleEntityByProvenance(auth.client, {
			entitySchemaSlug: "company",
			externalId: companyExternalId,
			providerId: companyProvider.providerId,
		});
		return yield* findRelationshipBySchema(auth.client, {
			targetEntityId: animeId,
			sourceEntityId: company.id,
			relationshipSchemaSlug: COMPANY_TO_ANIME,
			owner: testProviderEntitySchema(animeProvider).owner,
		});
	}).pipe(Effect.exit);

describe("entity population levels", () => {
	it.live(
		"imports at base and upgrades on a complete foreground replacement without changing its base stamp",
		() =>
			Effect.gen(function* () {
				const anime = yield* importAnime;
				const imported = yield* getEntity(auth.client, anime.id);
				expect(imported.populatedAt).not.toBeNull();
				expect(imported.relatedPopulationStatus).toBe("pending");
				expect(Exit.isFailure(yield* companyRelationship(anime.id))).toBe(true);

				const socket = yield* openInterestWebSocketScoped(auth);
				expect(yield* socket.replaceInterest([anime.id])).toEqual({ revision: 1, type: "applied" });
				yield* socket.waitForEntityUpdated(anime.id, "populated", { timeoutMs: 30_000 });
				expect(yield* socket.replaceInterest([anime.id], [anime.id])).toEqual({
					revision: 2,
					type: "applied",
				});
				const upgraded = yield* pollUntil(
					`anime '${anime.id}' related level ready`,
					getEntity(auth.client, anime.id).pipe(
						Effect.map((entity) => (entity.relatedPopulationStatus === "ready" ? entity : null)),
					),
				);
				expect(upgraded.populatedAt).toBe(imported.populatedAt);
				const relationship = yield* pollUntil(
					"company relationship written by the upgrade",
					companyRelationship(anime.id).pipe(
						Effect.map((exit) => (Exit.isSuccess(exit) ? exit.value : null)),
					),
				);
				expect(relationship.targetEntityId).toBe(anime.id);
			}),
	);

	it.live("never upgrades an entity that is only visible", () =>
		Effect.gen(function* () {
			const anime = yield* importAnime;
			const socket = yield* openInterestWebSocketScoped(auth);
			yield* socket.replaceInterest([anime.id]);
			yield* socket.waitForEntityUpdated(anime.id, "populated", { timeoutMs: 30_000 });
			yield* waitOutGraceWindow;

			expect((yield* getEntity(auth.client, anime.id)).relatedPopulationStatus).toBe("pending");
			expect(Exit.isFailure(yield* companyRelationship(anime.id))).toBe(true);
		}),
	);
});
