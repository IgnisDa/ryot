import type { SandboxProviderId, SandboxScriptId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import {
	countEntityTranslations,
	createAuthenticatedClient,
	enqueueEntityImport,
	enqueueEntitySearch,
	findBuiltinSchemaBySlug,
	getEntity,
	openInterestStreamScoped,
	pollEntityImportResult,
	pollEntitySearchResult,
	pollEntityUntilTranslationStatus,
	queryInLibraryRelationship,
	seedPopulatedProviderEntity,
	setUserLanguage,
} from "~/fixtures";
import {
	assertCompleted,
	assertCondition,
	assertPresent,
	requireArray,
	requireObjectRecord,
	requireString,
} from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const RUN_LIVE =
	process.env.RUN_LIVE_PROVIDER_TESTS === "1" || process.env.RUN_LIVE_PROVIDER_TESTS === "true";

function schemaProvider(
	schema: {
		providers: ReadonlyArray<{
			name: string;
			providerId: SandboxProviderId;
			searchScriptId?: SandboxScriptId;
		}>;
	},
	providerName: string,
) {
	const provider = schema.providers.find((candidate) => candidate.name === providerName);
	assertPresent(provider, `Expected a '${providerName}' provider on the builtin schema`);
	return provider;
}

describe.skipIf(!RUN_LIVE)("live provider smoke (real external APIs)", () => {
	it.live("searches OpenLibrary and imports a real result into the library", () =>
		Effect.gen(function* () {
			const { client, userId } = yield* createAuthenticatedClient();
			const { schema } = yield* findBuiltinSchemaBySlug(client, "book");
			const provider = schemaProvider(schema, "OpenLibrary");
			assertPresent(provider.searchScriptId, "Expected OpenLibrary to support search");

			const { jobId } = yield* enqueueEntitySearch(userId, {
				scriptId: provider.searchScriptId,
				context: { query: "The Hobbit", page: 1, pageSize: 5 },
			});
			const search = yield* pollEntitySearchResult(userId, jobId, { timeoutMs: 60_000 });
			assertCompleted(search, "OpenLibrary search");

			const value = requireObjectRecord(search.value, "Expected search result to be an object");
			const items = requireArray(value.items, "Expected search result items to be an array");
			assertCondition(items.length > 0, "OpenLibrary returned no results for 'The Hobbit'");
			const firstItem = requireObjectRecord(
				items[0],
				"Expected the first search item to be an object",
			);
			const externalId = requireString(
				firstItem.externalId,
				"Expected the search item to carry a string externalId",
			);

			const { jobId: importJobId } = yield* enqueueEntityImport(client, {
				externalId,
				providerId: provider.providerId,
				entitySchemaSlug: schema.id,
			});
			const imported = yield* pollEntityImportResult(client, importJobId, { timeoutMs: 60_000 });
			assertCompleted(imported, "OpenLibrary import");
			expect(imported.data.name.length).toBeGreaterThan(0);
			expect(imported.data.entitySchemaSlug).toBe(schema.id);

			const inLibrary = yield* queryInLibraryRelationship(client, imported.data.id, schema.slug);
			expect(inLibrary.data.items.length).toBeGreaterThan(0);
		}),
	);

	it.scopedLive(
		"translates a real TMDB movie on interest (requires tmdbAccessToken)",
		() =>
			Effect.gen(function* () {
				const auth = yield* createAuthenticatedClient();
				const { client } = auth;
				const { schema } = yield* findBuiltinSchemaBySlug(client, "movie");
				const provider = schemaProvider(schema, "TMDB");

				const movie = yield* seedPopulatedProviderEntity({
					externalId: "550",
					entitySchemaSlug: schema.id,
					providerId: provider.providerId,
					name: "Canonical Fight Club",
					properties: { description: "Canonical overview of Fight Club." },
				});

				yield* setUserLanguage(client, "es");
				const beforeInterest = yield* getEntity(client, movie.id);
				expect(beforeInterest.translationStatus).toBe("pending");

				const stream = yield* openInterestStreamScoped(auth);
				yield* Effect.promise(() => stream.declareInterest([movie.id]));

				const event = yield* Effect.promise(() =>
					stream.waitForEntityUpdated(movie.id, "translated", { timeoutMs: 90_000 }),
				);
				expect(event.reason).toBe("translated");

				const localized = yield* pollEntityUntilTranslationStatus(client, movie.id, "ready", {
					timeoutMs: 90_000,
				});
				expect(localized.name).not.toBe("Canonical Fight Club");
				expect(localized.name.length).toBeGreaterThan(0);
				expect(yield* countEntityTranslations(movie.id)).toBe(1);
			}),
		150_000,
	);
});
