import { randomUuid } from "@ryot-app/testing/random";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	fakeProviderDetailsResult,
	getEntity,
	getGlobalEntityByProvenance,
	GRACE_WINDOW_MS,
	installTestProvider,
	openLiveUpdatesScoped,
	pollUntil,
	seedEntity,
	seedPopulatedEntity,
	setEntityPopulatedAt,
	testProviderEntitySchema,
	uninstallTestProvider,
	waitForEntityPopulated,
	waitOutGraceWindow,
} from "~/fixtures/kernel";
import type { InstalledTestProvider } from "~/fixtures/kernel/sandbox-provider";
import { afterAll, beforeAll, describe, expect, it, runPromise } from "~/support/effect-test";

const POPULATED_NAME = "E2E Populated Studio";
const ENTITY_SCHEMA_SLUG = "studio";

let provider: InstalledTestProvider;

describe("entity population on request", () => {
	beforeAll(() =>
		runPromise(
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				provider = yield* installTestProvider({
					client,
					scope: "system",
					rootEntitySchemaSlug: ENTITY_SCHEMA_SLUG,
					information: { source: "e2e", canonicalLanguage: "en" },
					details: fakeProviderDetailsResult({
						name: POPULATED_NAME,
						properties: { description: "Populated by the e2e fake provider." },
					}),
				});
			}),
		),
	);

	afterAll(() => runPromise(uninstallTestProvider(provider)));

	it.live("keeps a bare read side-effect-free and populates once a page asks", () =>
		Effect.gen(function* () {
			const auth = yield* createAuthenticatedClient();
			const { client } = auth;

			const provenance = {
				providerId: provider.providerId,
				entitySchemaSlug: ENTITY_SCHEMA_SLUG,
				externalId: `e2e-populate-${yield* randomUuid}`,
			};

			const seeded = yield* seedEntity({
				userId: null,
				properties: {},
				name: "Partial Studio",
				providerId: provider.providerId,
				externalId: provenance.externalId,
				entitySchema: testProviderEntitySchema(provider),
			});

			const fetched = yield* getEntity(client, seeded.id);
			expect(fetched.id).toBe(seeded.id);
			expect(fetched.populatedAt).toBeNull();

			yield* waitOutGraceWindow;
			const afterGrace = yield* getGlobalEntityByProvenance(client, provenance);
			expect(afterGrace.populatedAt).toBeNull();

			const stream = yield* openLiveUpdatesScoped(auth);
			yield* stream.populate([seeded.id]);

			const populated = yield* waitForEntityPopulated(client, provenance);
			expect(populated.populatedAt).not.toBeNull();
			expect(populated.name).toBe(POPULATED_NAME);

			const event = yield* stream.waitForEntityUpdated(seeded.id, "populated", {
				timeoutMs: 30_000,
			});
			expect(event.reason).toBe("populated");
		}),
	);

	it.live("fully populates a root whose stored properties exceed 64 KiB", () =>
		Effect.gen(function* () {
			const auth = yield* createAuthenticatedClient();
			const description = "x".repeat(96 * 1024);
			const seeded = yield* seedEntity({
				userId: null,
				name: "Large partial root",
				properties: { description },
				providerId: provider.providerId,
				externalId: `large-root-${yield* randomUuid}`,
				entitySchema: testProviderEntitySchema(provider),
			});
			const stored = yield* getEntity(auth.client, seeded.id);
			expect(stored.properties.description).toBe(description);
			expect(stored.populationStatus).toEqual({ state: "idle", availability: "partial" });
			const stream = yield* openLiveUpdatesScoped(auth);
			yield* stream.populate([seeded.id], "interactive");
			const populated = yield* pollUntil(
				"large stored root fully populated",
				getEntity(auth.client, seeded.id).pipe(
					Effect.map((entity) =>
						entity.populationStatus.state === "succeeded" &&
						entity.relatedPopulationStatus.availability === "complete"
							? entity
							: null,
					),
				),
			);
			expect(populated.populationStatus).toEqual({ state: "succeeded", availability: "complete" });
			expect(populated.relatedPopulationStatus).toEqual({
				state: "succeeded",
				availability: "complete",
			});
			expect(populated.name).toBe(POPULATED_NAME);
			expect(populated.properties).toEqual({ description: "Populated by the e2e fake provider." });
			yield* stream.waitForEntityUpdated(seeded.id, "populated");
			yield* stream.waitForEntityUpdated(seeded.id, "enrichment-updated");
		}),
	);

	it.live("costs nothing for an entity that needs no work", () =>
		Effect.gen(function* () {
			const auth = yield* createAuthenticatedClient();
			const entity = yield* seedPopulatedEntity({
				properties: {},
				providerId: provider.providerId,
				name: "Already Populated Studio",
				externalId: `e2e-fresh-${yield* randomUuid}`,
				entitySchema: testProviderEntitySchema(provider),
			});

			const stream = yield* openLiveUpdatesScoped(auth);
			yield* stream.populate([entity.id]);
			yield* stream.expectNoEntityUpdated(entity.id, { windowMs: GRACE_WINDOW_MS });
			const fresh = yield* getEntity(auth.client, entity.id);
			expect(fresh.name).toBe("Already Populated Studio");
			expect(fresh.populationStatus.state).toBe("idle");
		}),
	);

	it.live("refreshes an entity older than its schema's interval", () =>
		Effect.gen(function* () {
			const auth = yield* createAuthenticatedClient();
			const schema = testProviderEntitySchema(provider);
			yield* auth.client.adminCall((contract) =>
				contract.instanceAdmin.setEntitySchemaRefreshInterval({
					payload: { slug: schema.slug, refreshIntervalDays: 30, pluginId: provider.pluginId },
				}),
			);
			const entity = yield* seedEntity({
				userId: null,
				properties: {},
				entitySchema: schema,
				name: "Stale Studio",
				providerId: provider.providerId,
				externalId: `e2e-stale-${yield* randomUuid}`,
			});
			yield* setEntityPopulatedAt(entity.id, "2026-01-01T00:00:00.000Z");

			const stream = yield* openLiveUpdatesScoped(auth);
			yield* stream.populate([entity.id]);
			yield* stream.waitForEntityUpdated(entity.id, "populated", { timeoutMs: 30_000 });
			expect((yield* getEntity(auth.client, entity.id)).name).toBe(POPULATED_NAME);
		}),
	);

	it.live("pushes completions only to the users who asked", () =>
		Effect.gen(function* () {
			const asker = yield* createAuthenticatedClient();
			const bystander = yield* createAuthenticatedClient();
			const provenance = {
				providerId: provider.providerId,
				entitySchemaSlug: ENTITY_SCHEMA_SLUG,
				externalId: `e2e-requesters-${yield* randomUuid}`,
			};
			const entity = yield* seedEntity({
				userId: null,
				properties: {},
				name: "Requested Studio",
				providerId: provider.providerId,
				externalId: provenance.externalId,
				entitySchema: testProviderEntitySchema(provider),
			});

			const bystanderStream = yield* openLiveUpdatesScoped(bystander);
			const askerStream = yield* openLiveUpdatesScoped(asker);
			yield* askerStream.populate([entity.id]);
			yield* askerStream.waitForEntityUpdated(entity.id, "populated", { timeoutMs: 30_000 });
			yield* bystanderStream.expectNoEntityUpdated(entity.id, { windowMs: GRACE_WINDOW_MS });

			const populated = yield* waitForEntityPopulated(asker.client, provenance);
			expect(populated.populatedAt).not.toBeNull();
		}),
	);
});
