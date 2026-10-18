import { EntityId } from "@ryot-app/contract/schema/brands";
import { Effect, Result } from "effect";

import {
	createAuthenticatedClient,
	fakeProviderDetailsResult,
	getApiClient,
	getEntity,
	getGlobalEntityByProvenance,
	installTestProvider,
	openInterestWebSocketScoped,
	pollUntil,
	seedEntity,
	seedPopulatedEntity,
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

describe("entity population via client-declared interest", () => {
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

	it.live("keeps a bare read side-effect-free and populates once client interest is declared", () =>
		Effect.gen(function* () {
			const auth = yield* createAuthenticatedClient();
			const { client } = auth;

			const provenance = {
				providerId: provider.providerId,
				entitySchemaSlug: ENTITY_SCHEMA_SLUG,
				externalId: `e2e-populate-${crypto.randomUUID()}`,
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

			const socket = yield* openInterestWebSocketScoped(auth);
			expect(yield* socket.replaceInterest([])).toEqual({ revision: 1, type: "applied" });
			expect(yield* socket.replaceInterest([seeded.id])).toEqual({ revision: 2, type: "applied" });

			const populated = yield* waitForEntityPopulated(client, provenance);
			expect(populated.populatedAt).not.toBeNull();
			expect(populated.name).toBe(POPULATED_NAME);

			const event = yield* socket.waitForEntityUpdated(seeded.id, "populated", {
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
				externalId: `large-root-${crypto.randomUUID()}`,
				entitySchema: testProviderEntitySchema(provider),
			});
			const stored = yield* getEntity(auth.client, seeded.id);
			expect(stored.properties.description).toBe(description);
			expect(stored.populationStatus).toEqual({ state: "idle", availability: "partial" });
			const socket = yield* openInterestWebSocketScoped(auth);
			yield* socket.replaceInterest([seeded.id], [seeded.id]);
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
			yield* socket.waitForEntityUpdated(seeded.id, "populated");
			yield* socket.waitForEntityUpdated(seeded.id, "enrichment-updated");
		}),
	);

	it.live("removes interest on disconnect and returns terminal catch-up after reconnect", () =>
		Effect.gen(function* () {
			const auth = yield* createAuthenticatedClient();

			const entity = yield* seedPopulatedEntity({
				properties: {},
				providerId: provider.providerId,
				name: "Already Populated Studio",
				entitySchema: testProviderEntitySchema(provider),
				externalId: `e2e-catchup-${crypto.randomUUID()}`,
			});

			const socket = yield* openInterestWebSocketScoped(auth);
			expect(yield* socket.replaceInterest([entity.id])).toEqual({ revision: 1, type: "applied" });
			const event = yield* socket.waitForEntityUpdated(entity.id, "enrichment-updated");
			expect(event.reason).toBe("enrichment-updated");

			yield* socket.close();
			yield* pollUntil(
				`interest session '${socket.ready.sessionId}' closed`,
				Effect.gen(function* () {
					const result = yield* getApiClient()
						.adminCall((c) =>
							c.testSupport.setEntityWatchMembership({
								payload: {
									sessionId: socket.ready.sessionId,
									entityIds: [EntityId.make(entity.id)],
								},
							}),
						)
						.pipe(Effect.result);
					return Result.isFailure(result) ? true : null;
				}),
			);

			const reconnected = yield* openInterestWebSocketScoped(auth);
			expect(yield* reconnected.replaceInterest([entity.id])).toEqual({
				revision: 1,
				type: "applied",
			});
			expect(yield* reconnected.waitForEntityUpdated(entity.id, "enrichment-updated")).toEqual({
				entityId: entity.id,
				type: "entity-updated",
				reason: "enrichment-updated",
			});
		}),
	);

	it.live("stops delivery after an empty replacement", () =>
		Effect.gen(function* () {
			const auth = yield* createAuthenticatedClient();
			const { client } = auth;
			const provenance = {
				providerId: provider.providerId,
				entitySchemaSlug: ENTITY_SCHEMA_SLUG,
				externalId: `e2e-replacement-${crypto.randomUUID()}`,
			};
			const entity = yield* seedEntity({
				userId: null,
				properties: {},
				name: "Replaced Studio",
				providerId: provider.providerId,
				externalId: provenance.externalId,
				entitySchema: testProviderEntitySchema(provider),
			});

			const replaced = yield* openInterestWebSocketScoped(auth);
			expect(yield* replaced.replaceInterest([entity.id])).toEqual({
				revision: 1,
				type: "applied",
			});
			expect(yield* replaced.replaceInterest([])).toEqual({ revision: 2, type: "applied" });
			const beforePopulation = replaced.getEntityUpdatedMessages();

			const active = yield* openInterestWebSocketScoped(auth);
			yield* active.replaceInterest([entity.id]);
			yield* active.waitForEntityUpdated(entity.id, "populated", { timeoutMs: 30_000 });
			yield* waitOutGraceWindow;
			expect(replaced.getEntityUpdatedMessages()).toEqual(beforePopulation);

			const populated = yield* waitForEntityPopulated(client, provenance);
			expect(populated.populatedAt).not.toBeNull();
		}),
	);
});
