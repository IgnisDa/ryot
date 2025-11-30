import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import {
	cleanupBuiltinProviderScript,
	createAuthenticatedClient,
	detailsDriverCode,
	findBuiltinSchemaBySlug,
	getEntity,
	getGlobalEntityByProvenance,
	openInterestStream,
	seedBuiltinProviderScript,
	seedMediaEntity,
	seedPopulatedProviderEntity,
	waitForEntityPopulated,
	type SeededProviderScript,
} from "../fixtures";
import { assertPresent } from "../test-support/assertions";

const GRACE_WINDOW_MS = 3000;
const POPULATED_NAME = "E2E Populated Studio";
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A fake builtin provider whose `details` driver returns fixed data with no network access. The
// entity carries this script as its provenance (sandbox_script_id), so on-interest population runs
// this driver instead of a live provider — the dispatch/SSE machinery under test is unchanged.
let providerScript: SeededProviderScript;

describe("entity population via client-declared interest", () => {
	beforeAll(async () => {
		providerScript = await seedBuiltinProviderScript({
			metadata: { providerInformation: { source: "e2e", canonicalLanguage: "en" } },
			code: detailsDriverCode({
				name: POPULATED_NAME,
				properties: { description: "Populated by the e2e fake provider." },
			}),
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
			entitySchemaId: schema.id,
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

		// A bare read is side-effect-free: it dispatches nothing.
		const fetched = await getEntity(client, seeded.id);
		expect(fetched.id).toBe(seeded.id);
		expect(fetched.populatedAt).toBeNull();

		// Bounded grace window: without interest, nothing populates it.
		await delay(GRACE_WINDOW_MS);
		const afterGrace = await getGlobalEntityByProvenance(provenance);
		expect(afterGrace.populatedAt).toBeNull();

		const stream = await openInterestStream(auth);
		try {
			await stream.declareInterest([seeded.id]);

			const populated = await waitForEntityPopulated(provenance);
			expect(populated.populatedAt).not.toBeNull();
			expect(populated.name).toBe(POPULATED_NAME);

			const event = await stream.waitForEntityUpdated(seeded.id, "populated", {
				timeoutMs: 30_000,
			});
			expect(event.reason).toBe("populated");
		} finally {
			stream.close();
		}
	}, 60_000);

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
			// Populated + no localization for a no-language reader ⇒ terminal ⇒ immediate catch-up in
			// the declare-interest response itself (no SSE round-trip needed for already-terminal state).
			const terminal = await stream.declareInterest([entity.id]);
			const event = terminal.find((frame) => frame.entityId === entity.id);
			assertPresent(event, `Expected an immediate catch-up frame for '${entity.id}'`);
			expect(event.reason).toBe("populated");
		} finally {
			stream.close();
		}
	}, 30_000);
});
