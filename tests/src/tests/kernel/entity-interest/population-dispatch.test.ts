import { Duration, Effect } from "effect";

import {
	uninstallTestProvider,
	createAuthenticatedClient,
	fakeProviderDetailsResult,
	findBuiltinSchemaBySlug,
	getEntity,
	getGlobalEntityByProvenance,
	openInterestStreamScoped,
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

	it.live("emits an immediate catch-up event for an already-terminal entity", () =>
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
		}),
	);
});
