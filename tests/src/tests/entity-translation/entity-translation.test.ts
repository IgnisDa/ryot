import { Duration, Effect } from "effect";

import {
	cleanupBuiltinProviderScript,
	countEntityTranslations,
	createAuthenticatedClient,
	fakeProviderDetailsResult,
	fakeProviderTranslations,
	findBuiltinSchemaBySlug,
	getEntity,
	getEntityTranslationRow,
	openInterestStreamScoped,
	pollEntityUntilTranslationStatus,
	seedBuiltinProviderScript,
	seedMediaEntity,
	seedPopulatedProviderEntity,
	setUserLanguage,
	waitForEntityPopulated,
	type Client,
	type SeededProviderScript,
} from "~/fixtures";
import { afterAll, beforeAll, describe, expect, it } from "~/support/effect-test";

const CANONICAL_LANGUAGE = "en";
const GRACE_WINDOW_MS = 3000;
const TRANSLATED_ES_NAME = "Título Traducido E2E";
const TRANSLATED_ES_DESCRIPTION = "Descripción traducida E2E.";
const POPULATED_NAME = "E2E Populated Movie";

let providerScript: SeededProviderScript;

const seedPopulatedMovie = (client: Client, name: string) =>
	Effect.gen(function* () {
		const { schema } = yield* findBuiltinSchemaBySlug(client, "movie");
		return yield* seedPopulatedProviderEntity({
			name,
			entitySchemaSlug: schema.id,
			sandboxScriptId: providerScript.scriptId,
			externalId: `e2e-translate-${crypto.randomUUID()}`,
			properties: { description: `Canonical overview of ${name}.` },
		});
	});

const declareInterest = (auth: { cookies: string }, entityIds: string[]) =>
	Effect.gen(function* () {
		const stream = yield* openInterestStreamScoped(auth);
		yield* Effect.promise(() => stream.declareInterest(entityIds));
		return stream;
	});

describe("entity translation via client-declared interest", () => {
	beforeAll(async () => {
		providerScript = await Effect.runPromise(
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				return yield* seedBuiltinProviderScript({
					client,
					providerInformation: { source: "e2e", canonicalLanguage: CANONICAL_LANGUAGE },
					drivers: {
						details: fakeProviderDetailsResult({
							name: POPULATED_NAME,
							properties: { description: "Populated by the e2e fake provider." },
						}),
						translations: fakeProviderTranslations({
							es: {
								name: TRANSLATED_ES_NAME,
								properties: { description: TRANSLATED_ES_DESCRIPTION },
							},
						}),
					},
				});
			}),
		);
	});

	afterAll(async () => {
		await Effect.runPromise(cleanupBuiltinProviderScript(providerScript));
	});

	it.scopedLive(
		"reports pending, translates on interest, then shares the overlay across users",
		() =>
			Effect.gen(function* () {
				const auth = yield* createAuthenticatedClient();
				const { client } = auth;
				const movie = yield* seedPopulatedMovie(client, "Canonical Fight Club");

				yield* setUserLanguage(client, "es");

				const beforeInterest = yield* getEntity(client, movie.id);
				expect(beforeInterest.translationStatus).toBe("pending");
				expect(beforeInterest.name).toBe("Canonical Fight Club");

				const stream = yield* declareInterest(auth, [movie.id]);
				const event = yield* Effect.promise(() =>
					stream.waitForEntityUpdated(movie.id, "translated", { timeoutMs: 30_000 }),
				);
				expect(event.reason).toBe("translated");

				const localizedRead = yield* pollEntityUntilTranslationStatus(client, movie.id, "ready", {
					timeoutMs: 30_000,
				});
				expect(localizedRead.name).toBe(TRANSLATED_ES_NAME);

				const { client: clientB } = yield* createAuthenticatedClient();
				yield* setUserLanguage(clientB, "es");
				const sharedRead = yield* getEntity(clientB, movie.id);
				expect(sharedRead.translationStatus).toBe("ready");
				expect(sharedRead.name).toBe(TRANSLATED_ES_NAME);
				expect(yield* countEntityTranslations(movie.id)).toBe(1);
			}),
	);

	it.scopedLive("negative-caches when the provider has no translation and does not refetch", () =>
		Effect.gen(function* () {
			const auth = yield* createAuthenticatedClient();
			const { client } = auth;
			const movie = yield* seedPopulatedMovie(client, "Canonical The Godfather");

			yield* setUserLanguage(client, "xx");

			const firstRead = yield* getEntity(client, movie.id);
			expect(firstRead.translationStatus).toBe("pending");

			const stream = yield* declareInterest(auth, [movie.id]);
			yield* Effect.promise(() =>
				stream.waitForEntityUpdated(movie.id, "translated", { timeoutMs: 30_000 }),
			);

			const settledRead = yield* pollEntityUntilTranslationStatus(client, movie.id, "none", {
				timeoutMs: 30_000,
			});
			expect(settledRead.name).toBe("Canonical The Godfather");

			const overlay = yield* getEntityTranslationRow({ entityId: movie.id, language: "xx" });
			expect(overlay?.name ?? null).toBeNull();
			expect(overlay?.properties?.description ?? null).toBeNull();
			expect(yield* countEntityTranslations(movie.id)).toBe(1);
		}),
	);

	it.live(
		"renders canonical without fetching when the resolved language is canonical or unset",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const movie = yield* seedPopulatedMovie(client, "Canonical The Shawshank Redemption");

				yield* setUserLanguage(client, CANONICAL_LANGUAGE);
				const canonicalPreferenceRead = yield* getEntity(client, movie.id);
				expect(canonicalPreferenceRead.translationStatus).toBe("none");
				expect(canonicalPreferenceRead.name).toBe("Canonical The Shawshank Redemption");
				expect(yield* countEntityTranslations(movie.id)).toBe(0);

				const { client: noPreferenceClient } = yield* createAuthenticatedClient();
				const noPreferenceRead = yield* getEntity(noPreferenceClient, movie.id);
				expect(noPreferenceRead.translationStatus).toBe("none");
				expect(noPreferenceRead.name).toBe("Canonical The Shawshank Redemption");
				expect(yield* countEntityTranslations(movie.id)).toBe(0);
			}),
	);

	it.scopedLive(
		"enqueues only population (never an all-null overlay) when interest hits an unpopulated entity",
		() =>
			Effect.gen(function* () {
				const auth = yield* createAuthenticatedClient();
				const { client } = auth;
				const { schema } = yield* findBuiltinSchemaBySlug(client, "movie");
				const provenance = {
					entitySchemaSlug: schema.slug,
					sandboxScriptId: providerScript.scriptId,
					externalId: `e2e-translate-unpopulated-${crypto.randomUUID()}`,
				};

				const seeded = yield* seedMediaEntity({
					userId: null,
					properties: {},
					entitySchemaSlug: schema.id,
					name: "Partial Pulp Fiction",
					externalId: provenance.externalId,
					sandboxScriptId: providerScript.scriptId,
				});

				yield* setUserLanguage(client, "es");

				const stream = yield* declareInterest(auth, [seeded.id]);
				const event = yield* Effect.promise(() =>
					stream.waitForEntityUpdated(seeded.id, "populated", { timeoutMs: 30_000 }),
				);
				expect(event.reason).toBe("populated");

				const populated = yield* waitForEntityPopulated(client, provenance);
				expect(populated.populatedAt).not.toBeNull();

				// Give any (incorrect) translate enqueue a chance to land, then prove none did.
				yield* Effect.sleep(Duration.millis(GRACE_WINDOW_MS));
				expect(yield* countEntityTranslations(seeded.id)).toBe(0);
			}),
	);
});
