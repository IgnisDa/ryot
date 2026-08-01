import { EntityId, UserId } from "@ryot/contract/schema/brands";
import { Duration, Effect } from "effect";

import {
	adminHeaders,
	uninstallTestProvider,
	createAuthenticatedClient,
	fakeProviderDetailsResult,
	findBuiltinSchemaBySlug,
	getBackendClient,
	getEntity,
	getGlobalEntityByProvenance,
	openInterestStreamScoped,
	pollUntil,
	postBackendJson,
	installTestProvider,
	seedMediaEntity,
	seedPopulatedProviderEntity,
	waitForEntityPopulated,
} from "~/fixtures";
import type { InstalledTestProvider } from "~/fixtures/sandbox-provider";
import { assertPresent } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it } from "~/support/effect-test";

const GRACE_WINDOW_MS = 3000;
const POPULATED_NAME = "E2E Populated Studio";

let provider: InstalledTestProvider;

describe("entity population via client-declared interest", () => {
	beforeAll(async () => {
		provider = await Effect.runPromise(
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				return yield* installTestProvider({
					client,
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

			const stream = yield* openInterestStreamScoped(auth);
			yield* Effect.promise(() => stream.declareInterest([seeded.id]));

			const populated = yield* waitForEntityPopulated(client, provenance);
			expect(populated.populatedAt).not.toBeNull();
			expect(populated.name).toBe(POPULATED_NAME);

			const event = yield* Effect.promise(() =>
				stream.waitForEntityUpdated(seeded.id, "populated", { timeoutMs: 30_000 }),
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
				name: "Already Populated Studio",
				providerId: provider.providerId,
				externalId: `e2e-catchup-${crypto.randomUUID()}`,
			});

			const stream = yield* openInterestStreamScoped(auth);
			const terminal = yield* Effect.promise(() => stream.declareInterest([entity.id]));
			const event = terminal.find((frame) => frame.entityId === entity.id);
			assertPresent(event, `Expected an immediate catch-up frame for '${entity.id}'`);
			expect(event.reason).toBe("populated");

			stream.close();
			yield* pollUntil(
				`interest stream '${stream.streamId}' closed`,
				Effect.gen(function* () {
					const response = yield* Effect.promise(() =>
						postBackendJson(
							"/entity-interest",
							{ streamId: stream.streamId, entityIds: [entity.id] },
							auth.cookies,
						),
					);
					return response.status === 404 ? response : null;
				}),
			);

			const reconnected = yield* openInterestStreamScoped(auth);
			const reconnectedTerminal = yield* Effect.promise(() =>
				reconnected.declareInterest([entity.id]),
			);
			expect(reconnectedTerminal).toEqual([{ entityId: entity.id, reason: "populated" }]);
		}),
	);

	it.live("stops delivery after interest is replaced", () =>
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

			const replaced = yield* openInterestStreamScoped(auth);
			yield* getBackendClient().call(
				(c) =>
					c.testSupport.setEntityInterest({
						payload: {
							streamId: replaced.streamId,
							userId: UserId.make(auth.userId),
							entityIds: [EntityId.make(entity.id)],
						},
					}),
				adminHeaders,
			);
			expect(yield* Effect.promise(() => replaced.declareInterest([]))).toEqual([]);

			const active = yield* openInterestStreamScoped(auth);
			yield* Effect.promise(() => active.declareInterest([entity.id]));
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
