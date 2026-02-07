import { describe, expect, it } from "bun:test";

import {
	createAuthenticatedClient,
	deleteGlobalEntityByProvenance,
	findBuiltinSchemaBySlug,
	getEntity,
	getGlobalEntityByProvenance,
	openInterestSocket,
	seedMediaEntity,
	seedPopulatedProviderEntity,
	waitForEntityPopulated,
} from "../fixtures";
import { assertPresent } from "../test-support/assertions";

const GRACE_WINDOW_MS = 3000;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("entity population via client-declared interest", () => {
	it("keeps a bare read side-effect-free and populates once client interest is declared", async () => {
		const auth = await createAuthenticatedClient();
		const { client } = auth;

		const { schema } = await findBuiltinSchemaBySlug(client, "company");
		const sandboxScriptId = schema.providers.find(
			(provider) => provider.name === "Anilist",
		)?.scriptId;
		assertPresent(sandboxScriptId, "Anilist company provider script not found");
		const provenance = { externalId: "14", entitySchemaId: schema.id, sandboxScriptId };

		await deleteGlobalEntityByProvenance(provenance);
		const seeded = await seedMediaEntity({
			userId: null,
			properties: {},
			sandboxScriptId,
			name: "Partial Studio",
			entitySchemaId: schema.id,
			externalId: provenance.externalId,
		});

		// A bare read is side-effect-free: it dispatches nothing.
		const fetched = await getEntity(client, seeded.id);
		expect(fetched.id).toBe(seeded.id);
		expect(fetched.populatedAt).toBeNull();

		// Bounded grace window: without interest, nothing populates it.
		await delay(GRACE_WINDOW_MS);
		const afterGrace = await getGlobalEntityByProvenance(provenance);
		expect(afterGrace.populatedAt).toBeNull();

		const socket = await openInterestSocket(auth);
		try {
			socket.sendInterest([seeded.id]);

			const populated = await waitForEntityPopulated(provenance);
			expect(populated.populatedAt).not.toBeNull();
			expect(populated.name).toBe("Sunrise");

			const event = await socket.waitForEntityUpdated(seeded.id, "populated", {
				timeoutMs: 30_000,
			});
			expect(event.reason).toBe("populated");
		} finally {
			socket.close();
		}
	}, 60_000);

	it("emits an immediate catch-up event for an already-terminal entity", async () => {
		const auth = await createAuthenticatedClient();
		const { client } = auth;

		const { schema } = await findBuiltinSchemaBySlug(client, "company");
		const sandboxScriptId = schema.providers.find(
			(provider) => provider.name === "Anilist",
		)?.scriptId;
		assertPresent(sandboxScriptId, "Anilist company provider script not found");

		const entity = await seedPopulatedProviderEntity({
			properties: {},
			sandboxScriptId,
			entitySchemaId: schema.id,
			name: "Already Populated Studio",
			externalId: `catchup-${crypto.randomUUID()}`,
		});

		const socket = await openInterestSocket(auth);
		try {
			socket.sendInterest([entity.id]);
			// Populated + no localization for a no-language reader ⇒ terminal ⇒ direct catch-up frame.
			const event = await socket.waitForEntityUpdated(entity.id, "populated", {
				timeoutMs: 20_000,
			});
			expect(event.entityId).toBe(entity.id);
		} finally {
			socket.close();
		}
	}, 30_000);
});
