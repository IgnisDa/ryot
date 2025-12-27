import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import {
	cleanupBuiltinProviderScript,
	createAuthenticatedClient,
	fakeProviderDetailsResult,
	findBuiltinSchemaBySlug,
	getEntity,
	getGlobalEntityByProvenance,
	openInterestStream,
	seedBuiltinProviderScript,
	seedMediaEntity,
	seedPopulatedProviderEntity,
	waitForEntityPopulated,
	type SeededProviderScript,
} from "~/fixtures";
import { assertPresent } from "~/support/assertions";

const GRACE_WINDOW_MS = 3000;
const POPULATED_NAME = "E2E Populated Studio";
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let providerScript: SeededProviderScript;

describe("entity population via client-declared interest", () => {
	beforeAll(async () => {
		const { client } = await createAuthenticatedClient();
		providerScript = await seedBuiltinProviderScript({
			client,
			providerInformation: { source: "e2e", canonicalLanguage: "en" },
			drivers: {
				details: fakeProviderDetailsResult({
					name: POPULATED_NAME,
					properties: { description: "Populated by the e2e fake provider." },
				}),
			},
		});
	});

	afterAll(async () => {
		await cleanupBuiltinProviderScript(providerScript);
	});

	it("keeps a bare read side-effect-free and populates once client interest is declared", async () => {
		const auth = await createAuthenticatedClient();
		const { client } = auth;

		const { schema } = await findBuiltinSchemaBySlug(client, "company");
		const provenance = {
			entitySchemaSlug: schema.slug,
			sandboxScriptId: providerScript.scriptId,
			externalId: `e2e-populate-${crypto.randomUUID()}`,
		};

		const seeded = await seedMediaEntity({
			userId: null,
			properties: {},
			name: "Partial Studio",
			entitySchemaId: schema.id,
			externalId: provenance.externalId,
			sandboxScriptId: providerScript.scriptId,
		});

		const fetched = await getEntity(client, seeded.id);
		expect(fetched.id).toBe(seeded.id);
		expect(fetched.populatedAt).toBeNull();

		await delay(GRACE_WINDOW_MS);
		const afterGrace = await getGlobalEntityByProvenance(client, provenance);
		expect(afterGrace.populatedAt).toBeNull();

		const stream = await openInterestStream(auth);
		try {
			await stream.declareInterest([seeded.id]);

			const populated = await waitForEntityPopulated(client, provenance);
			expect(populated.populatedAt).not.toBeNull();
			expect(populated.name).toBe(POPULATED_NAME);

			const event = await stream.waitForEntityUpdated(seeded.id, "populated", {
				timeoutMs: 30_000,
			});
			expect(event.reason).toBe("populated");
		} finally {
			stream.close();
		}
	});

	it("emits an immediate catch-up event for an already-terminal entity", async () => {
		const auth = await createAuthenticatedClient();
		const { client } = auth;

		const { schema } = await findBuiltinSchemaBySlug(client, "company");

		const entity = await seedPopulatedProviderEntity({
			properties: {},
			entitySchemaId: schema.id,
			name: "Already Populated Studio",
			sandboxScriptId: providerScript.scriptId,
			externalId: `e2e-catchup-${crypto.randomUUID()}`,
		});

		const stream = await openInterestStream(auth);
		try {
			const terminal = await stream.declareInterest([entity.id]);
			const event = terminal.find((frame) => frame.entityId === entity.id);
			assertPresent(event, `Expected an immediate catch-up frame for '${entity.id}'`);
			expect(event.reason).toBe("populated");
		} finally {
			stream.close();
		}
	});
});
