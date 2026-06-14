import { describe, expect, it } from "bun:test";

import {
	createAuthenticatedClient,
	deleteGlobalEntityByProvenance,
	findBuiltinSchemaBySlug,
	getEntity,
	getGlobalEntityByProvenance,
	seedMediaEntity,
	waitForEntityPopulated,
} from "../fixtures";
import { assertPresent } from "../test-support/assertions";

describe("GET /entities/:entityId — partial entity population", () => {
	it("populates a partial provider-backed entity when it is surfaced", async () => {
		const { client } = await createAuthenticatedClient();

		const { schema } = await findBuiltinSchemaBySlug(client, "company");
		const sandboxScriptId = schema.providers.find((p) => p.name === "Anilist")?.scriptId;
		assertPresent(sandboxScriptId, "Anilist company provider script not found");

		const provenance = { externalId: "14", entitySchemaId: schema.id, sandboxScriptId };

		// Start from a clean, partial stub: provider provenance set, populatedAt null.
		await deleteGlobalEntityByProvenance(provenance);
		const seeded = await seedMediaEntity({
			userId: null,
			properties: {},
			sandboxScriptId,
			name: "Partial Studio",
			entitySchemaId: schema.id,
			externalId: provenance.externalId,
		});

		const beforeFetch = await getGlobalEntityByProvenance(provenance);
		expect(beforeFetch.populatedAt).toBeNull();

		// The client only fetches — it dispatches nothing. Surfacing the partial
		// entity is what triggers backend-owned population.
		const fetched = await getEntity(client, seeded.id);
		expect(fetched.id).toBe(seeded.id);
		expect(fetched.populatedAt).toBeNull();

		const populated = await waitForEntityPopulated(provenance);
		expect(populated.populatedAt).not.toBeNull();
		expect(populated.name).toBe("Sunrise");
	}, 30_000);
});
