import { EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import {
	type Client,
	countEntityTranslations,
	createAuthenticatedClient,
	enqueueSandboxScript,
	fakeProviderDetailsResult,
	fakeProviderTranslations,
	getApiClient,
	getEntity,
	getEntityTranslationRow,
	installTestProvider,
	namespaceInstallation,
	openInterestWebSocketScoped,
	pollEntityUntilTranslationAvailability,
	pollSandboxResult,
	pollUntil,
	requireCompletedSandboxValue,
	seedEntity,
	seedEntityTranslation,
	seedPopulatedEntity,
	setUserLanguage,
	testProviderEntitySchema,
	uninstallTestProvider,
} from "~/fixtures/kernel";
import type { InstalledTestProvider } from "~/fixtures/kernel/sandbox-provider";
import { testPluginEntitySchema } from "~/fixtures/kernel/test-plugin";
import { assertPresent, requireObjectRecord } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it, runPromise } from "~/support/effect-test";

const CANONICAL_LANGUAGE = "en";
const TRANSLATED_ES_NAME = "Título Traducido E2E";
const TRANSLATED_ES_DESCRIPTION = "Descripción traducida E2E.";
const POPULATED_NAME = "E2E Populated Movie";
const ENTITY_SCHEMA_SLUG = "movie";

let provider: InstalledTestProvider;
let providerClient: Client;
let providerUserId: string;

const seedPopulatedMovie = (name: string) =>
	seedPopulatedEntity({
		name,
		providerId: provider.providerId,
		entitySchema: testProviderEntitySchema(provider),
		externalId: `e2e-translate-${crypto.randomUUID()}`,
		properties: { description: `Canonical overview of ${name}.` },
	});

const openInterestSocket = (auth: { client: Client }, entityIds: string[]) =>
	Effect.gen(function* () {
		const socket = yield* openInterestWebSocketScoped(auth);
		const applied = yield* socket.replaceInterest(entityIds);
		return { socket, applied };
	});

describe("entity translation via client-declared interest", () => {
	beforeAll(() =>
		runPromise(
			Effect.gen(function* () {
				provider = yield* installTestProvider({
					scope: "system",
					rootEntitySchemaSlug: ENTITY_SCHEMA_SLUG,
					resolve: { externalId: "resolved-e2e-movie" },
					client: (yield* createAuthenticatedClient()).client,
					information: { source: "e2e", canonicalLanguage: CANONICAL_LANGUAGE },
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
				});
				({ client: providerClient, userId: providerUserId } = yield* createAuthenticatedClient());
			}),
		),
	);

	afterAll(() => runPromise(uninstallTestProvider(provider)));

	it.live("executes the installed resolve operation independently", () =>
		Effect.gen(function* () {
			const resolveScriptId = provider.resolveScriptId;
			assertPresent(resolveScriptId, "Installed provider resolve script not found");
			const { jobId } = yield* enqueueSandboxScript(providerUserId, {
				lane: "interactive",
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
			const movie = yield* seedPopulatedMovie("Canonical Fight Club");

			yield* setUserLanguage(client, "es");

			const beforeInterest = yield* getEntity(client, movie.id);
			expect(beforeInterest.translationStatus.availability).toBe("missing");
			expect(beforeInterest.name).toBe("Canonical Fight Club");

			const { socket, applied } = yield* openInterestSocket(auth, [movie.id]);
			expect(applied).toEqual({ revision: 1, type: "applied" });
			const event = yield* socket.waitForEntityUpdated(movie.id, "translated", {
				timeoutMs: 30_000,
			});
			expect(event.reason).toBe("translated");

			const localizedRead = yield* pollEntityUntilTranslationAvailability(
				client,
				movie.id,
				"complete",
			);
			expect(localizedRead.name).toBe(TRANSLATED_ES_NAME);

			const { client: clientB } = yield* createAuthenticatedClient();
			yield* setUserLanguage(clientB, "es");
			const sharedRead = yield* getEntity(clientB, movie.id);
			expect(sharedRead.translationStatus.availability).toBe("complete");
			expect(sharedRead.name).toBe(TRANSLATED_ES_NAME);
			expect(yield* countEntityTranslations(movie.id)).toBe(1);
		}),
	);

	it.live("negative-caches when the provider has no translation and does not refetch", () =>
		Effect.gen(function* () {
			const auth = { client: providerClient };
			const { client } = auth;
			const movie = yield* seedPopulatedMovie("Canonical The Godfather");

			yield* setUserLanguage(client, "xx");

			const firstRead = yield* getEntity(client, movie.id);
			expect(firstRead.translationStatus.availability).toBe("missing");

			const { socket, applied } = yield* openInterestSocket(auth, [movie.id]);
			expect(applied).toEqual({ revision: 1, type: "applied" });
			const event = yield* socket.waitForEntityUpdated(movie.id, "translated", {
				timeoutMs: 30_000,
			});
			expect(event.reason).toBe("translated");

			const settledRead = yield* pollUntil(
				"negative-cache translation request succeeded",
				getEntity(client, movie.id).pipe(
					Effect.map((entity) =>
						entity.translationStatus.availability === "none" &&
						entity.translationStatus.state === "succeeded"
							? entity
							: null,
					),
				),
			);
			expect(settledRead.translationStatus.state).toBe("succeeded");
			expect(settledRead.name).toBe("Canonical The Godfather");

			const overlay = yield* getEntityTranslationRow({ language: "xx", entityId: movie.id });
			expect(overlay?.name ?? null).toBeNull();
			expect(overlay?.properties?.description ?? null).toBeNull();
			expect(yield* countEntityTranslations(movie.id)).toBe(1);
		}),
	);

	it.live(
		"translates an explicitly supported child schema with large unselected canonical content",
		() =>
			Effect.gen(function* () {
				const auth = yield* createAuthenticatedClient();
				const childProvider = yield* Effect.acquireRelease(
					installTestProvider({
						scope: "system",
						client: auth.client,
						rootEntitySchemaSlug: "record",
						translations: { es: { name: "Parte traducida" } },
						information: { source: "e2e", canonicalLanguage: "en" },
						details: fakeProviderDetailsResult({ name: "Canonical parent" }),
						translationInputs: { record: [], "record-part": ["parentExternalId", "position"] },
						entitySchemas: [
							testPluginEntitySchema({ slug: "record" }),
							testPluginEntitySchema({
								slug: "record-part",
								propertiesSchema: {
									fields: {
										position: { type: "integer", label: "Position", description: "Position" },
										parentExternalId: { type: "string", label: "Parent", description: "Parent ID" },
										description: {
											type: "string",
											translatable: true,
											label: "Description",
											description: "Description",
										},
									},
								},
							}),
						],
					}),
					uninstallTestProvider,
				);
				yield* getApiClient().adminCall((contract) =>
					contract.testSupport.reconcilePluginInstallations(),
				);
				yield* namespaceInstallation(auth.client, childProvider.pluginId);
				const child = yield* seedPopulatedEntity({
					name: "Canonical child",
					providerId: childProvider.providerId,
					externalId: `child-${crypto.randomUUID()}`,
					properties: {
						position: 1,
						parentExternalId: "parent-1",
						description: "x".repeat(100_000),
					},
					entitySchema: {
						...testProviderEntitySchema(childProvider),
						slug: EntitySchemaSlug.make("record-part"),
					},
				});
				yield* setUserLanguage(auth.client, "es");
				const { socket } = yield* openInterestSocket(auth, [child.id]);
				yield* socket.waitForEntityUpdated(child.id, "translated", { timeoutMs: 30_000 });
				const localized = yield* pollEntityUntilTranslationAvailability(
					auth.client,
					child.id,
					"complete",
				);
				expect(localized.name).toBe("Parte traducida");
				expect(yield* countEntityTranslations(child.id)).toBe(1);
			}),
	);

	it.live(
		"renders canonical without fetching when the resolved language is canonical or unset",
		() =>
			Effect.gen(function* () {
				const canonical = yield* createAuthenticatedClient();
				const { client } = canonical;
				const movie = yield* seedPopulatedMovie("Canonical The Shawshank Redemption");

				yield* setUserLanguage(client, CANONICAL_LANGUAGE);
				const canonicalPreferenceRead = yield* getEntity(client, movie.id);
				expect(canonicalPreferenceRead.translationStatus.availability).toBe("none");
				expect(canonicalPreferenceRead.name).toBe("Canonical The Shawshank Redemption");
				expect(yield* countEntityTranslations(movie.id)).toBe(0);
				const canonicalInterest = yield* openInterestSocket(canonical, [movie.id]);
				expect(canonicalInterest.applied).toEqual({ revision: 1, type: "applied" });
				expect(
					yield* canonicalInterest.socket.waitForEntityUpdated(movie.id, "enrichment-updated"),
				).toEqual({ entityId: movie.id, type: "entity-updated", reason: "enrichment-updated" });

				const noPreference = yield* createAuthenticatedClient();
				const { client: noPreferenceClient } = noPreference;
				const noPreferenceRead = yield* getEntity(noPreferenceClient, movie.id);
				expect(noPreferenceRead.translationStatus.availability).toBe("none");
				expect(noPreferenceRead.name).toBe("Canonical The Shawshank Redemption");
				expect(yield* countEntityTranslations(movie.id)).toBe(0);
				const noPreferenceInterest = yield* openInterestSocket(noPreference, [movie.id]);
				expect(noPreferenceInterest.applied).toEqual({ revision: 1, type: "applied" });
				expect(
					yield* noPreferenceInterest.socket.waitForEntityUpdated(movie.id, "enrichment-updated"),
				).toEqual({ entityId: movie.id, type: "entity-updated", reason: "enrichment-updated" });
			}),
	);

	it.live("keeps one overlay row across concurrent and repeated upserts", () =>
		Effect.gen(function* () {
			const movie = yield* seedPopulatedMovie("Canonical Heat");
			const first = {
				name: "Hitze",
				language: "de",
				entityId: movie.id,
				properties: { description: "Erste Beschreibung." },
			};

			const [firstWrite, concurrentWrite] = yield* Effect.all(
				[seedEntityTranslation(first), seedEntityTranslation(first)],
				{ concurrency: "unbounded" },
			);
			expect(concurrentWrite).toEqual(firstWrite);
			expect(yield* countEntityTranslations(movie.id)).toBe(1);

			const updated = yield* seedEntityTranslation({
				...first,
				name: "Hitze Neu",
				properties: { description: "Zweite Beschreibung." },
			});

			const overlay = yield* getEntityTranslationRow({ language: "de", entityId: movie.id });
			expect(overlay).toMatchObject(updated);
			expect(updated).toEqual(firstWrite);
			expect(overlay?.name).toBe("Hitze Neu");
			expect(overlay?.properties?.description).toBe("Zweite Beschreibung.");
			expect(yield* countEntityTranslations(movie.id)).toBe(1);
		}),
	);

	it.live("populates then translates an unpopulated entity from one interest declaration", () =>
		Effect.gen(function* () {
			const auth = { client: providerClient };
			const { client } = auth;
			const seeded = yield* seedEntity({
				userId: null,
				properties: {},
				name: "Partial Pulp Fiction",
				providerId: provider.providerId,
				entitySchema: testProviderEntitySchema(provider),
				externalId: `e2e-translate-unpopulated-${crypto.randomUUID()}`,
			});

			yield* setUserLanguage(client, "es");

			const { socket, applied } = yield* openInterestSocket(auth, [seeded.id]);
			expect(applied).toEqual({ revision: 1, type: "applied" });
			const populatedEvent = yield* socket.waitForEntityUpdated(seeded.id, "populated", {
				timeoutMs: 30_000,
			});
			expect(populatedEvent.reason).toBe("populated");
			const translatedEvent = yield* socket.waitForEntityUpdated(seeded.id, "translated", {
				timeoutMs: 30_000,
			});
			expect(translatedEvent.reason).toBe("translated");

			const reasons = socket
				.getEntityUpdatedMessages()
				.filter((frame) => frame.entityId === seeded.id)
				.map((frame) => frame.reason);
			expect(reasons).toContain("enrichment-updated");
			expect(reasons.filter((reason) => reason !== "enrichment-updated")).toEqual([
				"populated",
				"translated",
			]);

			const populated = yield* getEntity(client, seeded.id);
			expect(populated.populatedAt).not.toBeNull();
			const localized = yield* pollEntityUntilTranslationAvailability(
				client,
				seeded.id,
				"complete",
			);
			expect(localized.name).toBe(TRANSLATED_ES_NAME);
			expect(yield* countEntityTranslations(seeded.id)).toBe(1);
		}),
	);
});
