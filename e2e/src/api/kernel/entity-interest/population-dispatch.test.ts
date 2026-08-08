import { EntityId } from "@ryot/contract/schema/brands";
import { Duration, Effect, Result } from "effect";

import {
	adminHeaders,
	uninstallTestProvider,
	createAuthenticatedClient,
	fakeProviderDetailsResult,
	findBuiltinSchemaBySlug,
	getApiClient,
	getEntity,
	openInterestWebSocketScoped,
	pollUntil,
	installTestProvider,
} from "~/fixtures/kernel";
import type { InstalledTestProvider } from "~/fixtures/kernel/sandbox-provider";
import {
	getGlobalEntityByProvenance,
	seedMediaEntity,
	seedPopulatedProviderEntity,
	waitForEntityPopulated,
} from "~/fixtures/plugins/media";
import { afterAll, beforeAll, describe, expect, it } from "~/support/effect-test";

const GRACE_WINDOW_MS = 3000;
const POPULATED_NAME = "E2E Populated Studio";

let provider: InstalledTestProvider;

describe("entity population via client-declared interest", () => {
	beforeAll(async () => {
		provider = await Effect.runPromise(
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const { schema } = yield* findBuiltinSchemaBySlug(client, "company");
				return yield* installTestProvider({
					client,
					scope: "system",
					rootEntitySchemaSlug: schema.id,
					information: { source: "e2e", canonicalLanguage: "en" },
					details: fakeProviderDetailsResult({
						name: POPULATED_NAME,
						properties: { description: "Populated by the e2e fake provider." },
					}),
				});
			}),
		);
	});

	afterAll(async () => {
		await Effect.runPromise(uninstallTestProvider(provider));
	});

	it.live("keeps a bare read side-effect-free and populates once client interest is declared", () =>
		Effect.gen(function* () {
			const auth = yield* createAuthenticatedClient();
			const { client } = auth;

			const { schema } = yield* findBuiltinSchemaBySlug(client, "company");
			const provenance = {
				entitySchemaSlug: schema.slug,
				providerId: provider.providerId,
				externalId: `e2e-populate-${crypto.randomUUID()}`,
			};

			const seeded = yield* seedMediaEntity({
				userId: null,
				properties: {},
				name: "Partial Studio",
				entitySchemaSlug: schema.id,
				externalId: provenance.externalId,
				providerId: provider.providerId,
			});

			const fetched = yield* getEntity(client, seeded.id);
			expect(fetched.id).toBe(seeded.id);
			expect(fetched.populatedAt).toBeNull();

			yield* Effect.sleep(Duration.millis(GRACE_WINDOW_MS));
			const afterGrace = yield* getGlobalEntityByProvenance(client, provenance);
			expect(afterGrace.populatedAt).toBeNull();

			const socket = yield* openInterestWebSocketScoped(auth);
			expect(yield* Effect.promise(() => socket.replaceInterest([]))).toEqual({
				revision: 1,
				type: "applied",
			});
			expect(
				yield* Effect.promise(() => socket.updateInterest({ add: [seeded.id], remove: [] })),
			).toEqual({ type: "applied", revision: 2 });

			const populated = yield* waitForEntityPopulated(client, provenance);
			expect(populated.populatedAt).not.toBeNull();
			expect(populated.name).toBe(POPULATED_NAME);

			const event = yield* Effect.promise(() =>
				socket.waitForEntityUpdated(seeded.id, "populated", { timeoutMs: 30_000 }),
			);
			expect(event.reason).toBe("populated");
		}),
	);

	it.live("removes interest on disconnect and returns terminal catch-up after reconnect", () =>
		Effect.gen(function* () {
			const auth = yield* createAuthenticatedClient();
			const { client } = auth;

			const { schema } = yield* findBuiltinSchemaBySlug(client, "company");

			const entity = yield* seedPopulatedProviderEntity({
				properties: {},
				entitySchemaSlug: schema.id,
				providerId: provider.providerId,
				name: "Already Populated Studio",
				externalId: `e2e-catchup-${crypto.randomUUID()}`,
			});

			const socket = yield* openInterestWebSocketScoped(auth);
			expect(yield* Effect.promise(() => socket.replaceInterest([entity.id]))).toEqual({
				type: "applied",
				revision: 1,
			});
			const event = yield* Effect.promise(() =>
				socket.waitForEntityUpdated(entity.id, "populated"),
			);
			expect(event.reason).toBe("populated");

			yield* Effect.promise(() => socket.close());
			yield* pollUntil(
				`interest session '${socket.ready.sessionId}' closed`,
				Effect.gen(function* () {
					const result = yield* getApiClient()
						.call(
							(c) =>
								c.testSupport.setEntityInterestMembership({
									payload: {
										sessionId: socket.ready.sessionId,
										entityIds: [EntityId.make(entity.id)],
									},
								}),
							adminHeaders,
						)
						.pipe(Effect.result);
					return Result.isFailure(result) ? true : null;
				}),
			);

			const reconnected = yield* openInterestWebSocketScoped(auth);
			expect(yield* Effect.promise(() => reconnected.replaceInterest([entity.id]))).toEqual({
				revision: 1,
				type: "applied",
			});
			expect(
				yield* Effect.promise(() => reconnected.waitForEntityUpdated(entity.id, "populated")),
			).toEqual({ type: "entity-updated", entityId: entity.id, reason: "populated" });
		}),
	);

	it.live("stops delivery after an incremental remove", () =>
		Effect.gen(function* () {
			const auth = yield* createAuthenticatedClient();
			const { client } = auth;
			const { schema } = yield* findBuiltinSchemaBySlug(client, "company");
			const provenance = {
				entitySchemaSlug: schema.slug,
				providerId: provider.providerId,
				externalId: `e2e-replacement-${crypto.randomUUID()}`,
			};
			const entity = yield* seedMediaEntity({
				userId: null,
				properties: {},
				name: "Replaced Studio",
				entitySchemaSlug: schema.id,
				providerId: provider.providerId,
				externalId: provenance.externalId,
			});

			const replaced = yield* openInterestWebSocketScoped(auth);
			expect(yield* Effect.promise(() => replaced.replaceInterest([entity.id]))).toEqual({
				revision: 1,
				type: "applied",
			});
			expect(
				yield* Effect.promise(() => replaced.updateInterest({ add: [], remove: [entity.id] })),
			).toEqual({ type: "applied", revision: 2 });

			const active = yield* openInterestWebSocketScoped(auth);
			yield* Effect.promise(() => active.replaceInterest([entity.id]));
			yield* Effect.promise(() =>
				active.waitForEntityUpdated(entity.id, "populated", { timeoutMs: 30_000 }),
			);
			yield* Effect.promise(() =>
				replaced.expectNoEntityUpdated(entity.id, { windowMs: GRACE_WINDOW_MS }),
			);

			const populated = yield* waitForEntityPopulated(client, provenance);
			expect(populated.populatedAt).not.toBeNull();
		}),
	);
});
