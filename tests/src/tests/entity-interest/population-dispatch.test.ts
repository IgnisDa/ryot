import { Duration, Effect } from "effect";

import {
	cleanupBuiltinProviderScript,
	createAuthenticatedClient,
	fakeProviderDetailsResult,
	findBuiltinSchemaBySlug,
	getEntity,
	getGlobalEntityByProvenance,
	openInterestStreamScoped,
	seedBuiltinProviderScript,
	seedMediaEntity,
	seedPopulatedProviderEntity,
	waitForEntityPopulated,
	type SeededProviderScript,
} from "~/fixtures";
import { assertPresent } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it } from "~/support/effect-test";

const GRACE_WINDOW_MS = 3000;
const POPULATED_NAME = "E2E Populated Studio";

let providerScript: SeededProviderScript;

describe("entity population via client-declared interest", () => {
	beforeAll(async () => {
		providerScript = await Effect.runPromise(
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				return yield* seedBuiltinProviderScript({
					client,
					providerInformation: { source: "e2e", canonicalLanguage: "en" },
					drivers: {
						details: fakeProviderDetailsResult({
							name: POPULATED_NAME,
							properties: { description: "Populated by the e2e fake provider." },
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
		"keeps a bare read side-effect-free and populates once client interest is declared",
		() =>
			Effect.gen(function* () {
				const auth = yield* createAuthenticatedClient();
				const { client } = auth;

				const { schema } = yield* findBuiltinSchemaBySlug(client, "company");
				const provenance = {
					entitySchemaSlug: schema.slug,
					sandboxScriptId: providerScript.scriptId,
					externalId: `e2e-populate-${crypto.randomUUID()}`,
				};

				const seeded = yield* seedMediaEntity({
					userId: null,
					properties: {},
					name: "Partial Studio",
					entitySchemaId: schema.id,
					externalId: provenance.externalId,
					sandboxScriptId: providerScript.scriptId,
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

	it.scopedLive("emits an immediate catch-up event for an already-terminal entity", () =>
		Effect.gen(function* () {
			const auth = yield* createAuthenticatedClient();
			const { client } = auth;

			const { schema } = yield* findBuiltinSchemaBySlug(client, "company");

			const entity = yield* seedPopulatedProviderEntity({
				properties: {},
				entitySchemaId: schema.id,
				name: "Already Populated Studio",
				sandboxScriptId: providerScript.scriptId,
				externalId: `e2e-catchup-${crypto.randomUUID()}`,
			});

			const stream = yield* openInterestStreamScoped(auth);
			const terminal = yield* Effect.promise(() => stream.declareInterest([entity.id]));
			const event = terminal.find((frame) => frame.entityId === entity.id);
			assertPresent(event, `Expected an immediate catch-up frame for '${entity.id}'`);
			expect(event.reason).toBe("populated");
		}),
	);
});
