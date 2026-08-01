import type { SandboxProviderId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import {
	countEntityTranslations,
	createAuthenticatedClient,
	enqueueProviderEntityImport,
	findBuiltinSchemaBySlug,
	getEntity,
	openInterestWebSocketScoped,
	pollProviderEntityImportResult,
	pollEntityUntilTranslationStatus,
	searchProviderEntities,
	setUserLanguage,
} from "~/fixtures/kernel";
import { seedPopulatedProviderEntity } from "~/fixtures/plugins/media";
import { assertCompleted, assertCondition, assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const RUN_LIVE =
	process.env.RUN_LIVE_PROVIDER_TESTS === "1" || process.env.RUN_LIVE_PROVIDER_TESTS === "true";

function schemaProvider(
	schema: {
		providers: ReadonlyArray<{
			name: string;
			providerId: SandboxProviderId;
		}>;
	},
	providerName: string,
) {
	const provider = schema.providers.find((candidate) => candidate.name === providerName);
	assertPresent(provider, `Expected a '${providerName}' provider on the builtin schema`);
	return provider;
}

describe.skipIf(!RUN_LIVE)("live provider smoke (real external APIs)", () => {
	it.live("searches OpenLibrary and imports a real result", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema } = yield* findBuiltinSchemaBySlug(client, "book");
			const provider = schemaProvider(schema, "OpenLibrary");
			const search = yield* searchProviderEntities(client, {
				page: 1,
				pageSize: 5,
				query: "The Hobbit",
				providerId: provider.providerId,
			});
			expect(search.providerId).toBe(provider.providerId);
			assertCondition(search.items.length > 0, "OpenLibrary returned no results for 'The Hobbit'");
			const firstItem = search.items[0];
			assertPresent(firstItem, "Expected the first OpenLibrary search item");
			const externalId = firstItem.externalId;

			const { jobId: importJobId } = yield* enqueueProviderEntityImport(client, {
				externalId,
				providerId: search.providerId,
			});
			const imported = yield* pollProviderEntityImportResult(client, importJobId);
			assertCompleted(imported, "OpenLibrary import");
			expect(imported.data.name.length).toBeGreaterThan(0);
			expect(imported.data.entitySchemaSlug).toBe(schema.id);
		}),
	);

	it.live(
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

				const socket = yield* openInterestWebSocketScoped(auth);
				yield* Effect.promise(() => socket.replaceInterest([movie.id]));

				const event = yield* Effect.promise(() =>
					socket.waitForEntityUpdated(movie.id, "translated", { timeoutMs: 90_000 }),
				);
				expect(event.reason).toBe("translated");

				const localized = yield* pollEntityUntilTranslationStatus(client, movie.id, "ready");
				expect(localized.name).not.toBe("Canonical Fight Club");
				expect(localized.name.length).toBeGreaterThan(0);
				expect(yield* countEntityTranslations(movie.id)).toBe(1);
			}),
		150_000,
	);
});
