import { Effect } from "effect";

import {
	uninstallTestProvider,
	countEntityTranslations,
	createAuthenticatedClient,
	fakeProviderDetailsResult,
	fakeProviderTranslations,
	findBuiltinSchemaBySlug,
	getEntity,
	getEntityTranslationRow,
	enqueueSandboxScript,
	openInterestWebSocketScoped,
	pollSandboxResult,
	pollEntityUntilTranslationStatus,
	requireCompletedSandboxValue,
	installTestProvider,
	seedMediaEntity,
	seedPopulatedProviderEntity,
	setUserLanguage,
	type Client,
} from "~/fixtures";
import type { InstalledTestProvider } from "~/fixtures/sandbox-provider";
import { assertPresent, requireObjectRecord } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it } from "~/support/effect-test";

const CANONICAL_LANGUAGE = "en";
const TRANSLATED_ES_NAME = "Título Traducido E2E";
const TRANSLATED_ES_DESCRIPTION = "Descripción traducida E2E.";
const POPULATED_NAME = "E2E Populated Movie";

let provider: InstalledTestProvider;
let providerClient: Client;
let providerUserId: string;

const seedPopulatedMovie = (client: Client, name: string) =>
	Effect.gen(function* () {
		const { schema } = yield* findBuiltinSchemaBySlug(client, "movie");
		return yield* seedPopulatedProviderEntity({
			name,
			entitySchemaSlug: schema.id,
			providerId: provider.providerId,
			externalId: `e2e-translate-${crypto.randomUUID()}`,
			properties: { description: `Canonical overview of ${name}.` },
		});
	});

const openInterestSocket = (auth: { client: Client }, entityIds: string[]) =>
	Effect.gen(function* () {
		const socket = yield* openInterestWebSocketScoped(auth);
		const applied = yield* Effect.promise(() => socket.replaceInterest(entityIds));
		return { applied, socket };
	});

describe("entity translation via client-declared interest", () => {
	beforeAll(async () => {
		provider = await Effect.runPromise(
			Effect.gen(function* () {
				const { client, userId } = yield* createAuthenticatedClient();
				providerClient = client;
				providerUserId = userId;
				const { schema } = yield* findBuiltinSchemaBySlug(client, "movie");
				return yield* installTestProvider({
					client,
					rootEntitySchemaSlug: schema.id,
					information: { source: "e2e", canonicalLanguage: CANONICAL_LANGUAGE },
					details: fakeProviderDetailsResult({
						name: POPULATED_NAME,
						properties: { description: "Populated by the e2e fake provider." },
					}),
					resolve: { externalId: "resolved-e2e-movie" },
					translations: fakeProviderTranslations({
						es: {
							name: TRANSLATED_ES_NAME,
							properties: { description: TRANSLATED_ES_DESCRIPTION },
						},
					}),
				});
			}),
		);
	});

	afterAll(async () => {
		await Effect.runPromise(uninstallTestProvider(provider));
	});

	it.live("executes the installed resolve operation independently", () =>
		Effect.gen(function* () {
			const resolveScriptId = provider.resolveScriptId;
			assertPresent(resolveScriptId, "Installed provider resolve script not found");
			const { jobId } = yield* enqueueSandboxScript(providerUserId, {
				scriptId: resolveScriptId,
				context: { value: "tt-e2e", identifierType: "imdb" },
			});
			const value = requireObjectRecord(
				requireCompletedSandboxValue(
					yield* pollSandboxResult(providerUserId, jobId),
					"resolve job",
				),
				"Expected resolve result to be an object",
			);
			expect(value.externalId).toBe("resolved-e2e-movie");
		}),
	);

	it.live("reports pending, translates on interest, then shares the overlay across users", () =>
		Effect.gen(function* () {
			const auth = { client: providerClient };
			const { client } = auth;
			const movie = yield* seedPopulatedMovie(client, "Canonical Fight Club");

			yield* setUserLanguage(client, "es");

			const beforeInterest = yield* getEntity(client, movie.id);
			expect(beforeInterest.translationStatus).toBe("pending");
			expect(beforeInterest.name).toBe("Canonical Fight Club");

			const { applied, socket } = yield* openInterestSocket(auth, [movie.id]);
			expect(applied).toEqual({ type: "applied", revision: 1 });
			const event = yield* Effect.promise(() =>
				socket.waitForEntityUpdated(movie.id, "translated", { timeoutMs: 30_000 }),
			);
			expect(event.reason).toBe("translated");

			const localizedRead = yield* pollEntityUntilTranslationStatus(client, movie.id, "ready");
			expect(localizedRead.name).toBe(TRANSLATED_ES_NAME);

			const { client: clientB } = yield* createAuthenticatedClient();
			yield* setUserLanguage(clientB, "es");
			const sharedRead = yield* getEntity(clientB, movie.id);
			expect(sharedRead.translationStatus).toBe("ready");
			expect(sharedRead.name).toBe(TRANSLATED_ES_NAME);
			expect(yield* countEntityTranslations(movie.id)).toBe(1);
		}),
	);

	it.live("negative-caches when the provider has no translation and does not refetch", () =>
		Effect.gen(function* () {
			const auth = { client: providerClient };
			const { client } = auth;
			const movie = yield* seedPopulatedMovie(client, "Canonical The Godfather");

			yield* setUserLanguage(client, "xx");

			const firstRead = yield* getEntity(client, movie.id);
			expect(firstRead.translationStatus).toBe("pending");

			const { applied, socket } = yield* openInterestSocket(auth, [movie.id]);
			expect(applied).toEqual({ type: "applied", revision: 1 });
			const event = yield* Effect.promise(() =>
				socket.waitForEntityUpdated(movie.id, "translated", { timeoutMs: 30_000 }),
			);
			expect(event.reason).toBe("translated");

			const settledRead = yield* pollEntityUntilTranslationStatus(client, movie.id, "none");
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
				const canonical = yield* createAuthenticatedClient();
				const { client } = canonical;
				const movie = yield* seedPopulatedMovie(client, "Canonical The Shawshank Redemption");

				yield* setUserLanguage(client, CANONICAL_LANGUAGE);
				const canonicalPreferenceRead = yield* getEntity(client, movie.id);
				expect(canonicalPreferenceRead.translationStatus).toBe("none");
				expect(canonicalPreferenceRead.name).toBe("Canonical The Shawshank Redemption");
				expect(yield* countEntityTranslations(movie.id)).toBe(0);
				const canonicalInterest = yield* openInterestSocket(canonical, [movie.id]);
				expect(canonicalInterest.applied).toEqual({ type: "applied", revision: 1 });
				expect(
					yield* Effect.promise(() =>
						canonicalInterest.socket.waitForEntityUpdated(movie.id, "populated"),
					),
				).toEqual({ type: "entity-updated", entityId: movie.id, reason: "populated" });

				const noPreference = yield* createAuthenticatedClient();
				const { client: noPreferenceClient } = noPreference;
				const noPreferenceRead = yield* getEntity(noPreferenceClient, movie.id);
				expect(noPreferenceRead.translationStatus).toBe("none");
				expect(noPreferenceRead.name).toBe("Canonical The Shawshank Redemption");
				expect(yield* countEntityTranslations(movie.id)).toBe(0);
				const noPreferenceInterest = yield* openInterestSocket(noPreference, [movie.id]);
				expect(noPreferenceInterest.applied).toEqual({ type: "applied", revision: 1 });
				expect(
					yield* Effect.promise(() =>
						noPreferenceInterest.socket.waitForEntityUpdated(movie.id, "populated"),
					),
				).toEqual({ type: "entity-updated", entityId: movie.id, reason: "populated" });
			}),
	);

	it.live("populates then translates an unpopulated entity from one interest declaration", () =>
		Effect.gen(function* () {
			const auth = { client: providerClient };
			const { client } = auth;
			const { schema } = yield* findBuiltinSchemaBySlug(client, "movie");
			const provenance = {
				entitySchemaSlug: schema.slug,
				providerId: provider.providerId,
				externalId: `e2e-translate-unpopulated-${crypto.randomUUID()}`,
			};

			const seeded = yield* seedMediaEntity({
				client,
				userId: providerUserId,
				properties: {},
				entitySchemaSlug: schema.id,
				name: "Partial Pulp Fiction",
				providerId: provider.providerId,
				externalId: provenance.externalId,
			});

			yield* setUserLanguage(client, "es");

			const { applied, socket } = yield* openInterestSocket(auth, [seeded.id]);
			expect(applied).toEqual({ type: "applied", revision: 1 });
			const populatedEvent = yield* Effect.promise(() =>
				socket.waitForEntityUpdated(seeded.id, "populated", { timeoutMs: 30_000 }),
			);
			expect(populatedEvent.reason).toBe("populated");
			const translatedEvent = yield* Effect.promise(() =>
				socket.waitForEntityUpdated(seeded.id, "translated", { timeoutMs: 30_000 }),
			);
			expect(translatedEvent.reason).toBe("translated");

			const reasons = socket
				.getEntityUpdatedMessages()
				.filter((frame) => frame.entityId === seeded.id)
				.map((frame) => frame.reason);
			expect(reasons).toEqual(["populated", "translated"]);

			const populated = yield* getEntity(client, seeded.id);
			expect(populated.populatedAt).not.toBeNull();
			const localized = yield* pollEntityUntilTranslationStatus(client, seeded.id, "ready");
			expect(localized.name).toBe(TRANSLATED_ES_NAME);
			expect(yield* countEntityTranslations(seeded.id)).toBe(1);
		}),
	);
});
