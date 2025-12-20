import { describe, expect, it } from "bun:test";

import {
	createAuthenticatedClient,
	findBuiltinSchemaBySlug,
	openInterestSocket,
	seedMediaEntity,
} from "../fixtures";
import { getPgClient } from "../setup";
import { assertPresent } from "../test-support/assertions";

describe("interest authorization", () => {
	it("ignores interest declared in another user's private entity", async () => {
		const authA = await createAuthenticatedClient();
		const authB = await createAuthenticatedClient();

		const { schema } = await findBuiltinSchemaBySlug(authA.client, "company");
		const sandboxScriptId = schema.providers.find(
			(provider) => provider.name === "Anilist",
		)?.scriptId;
		assertPresent(sandboxScriptId, "Anilist company provider script not found");

		// A private, partial entity owned by user A. If it were visible to B, interest would populate it.
		const privateEntity = await seedMediaEntity({
			properties: {},
			sandboxScriptId,
			userId: authA.userId,
			entitySchemaId: schema.id,
			name: "A's Private Studio",
			externalId: `private-${crypto.randomUUID()}`,
		});

		const socketB = await openInterestSocket(authB);
		try {
			socketB.sendInterest([privateEntity.id]);
			// B is not authorized to see the entity, so the reconciler never surfaces it: no catch-up, no
			// completion event.
			await socketB.expectNoEntityUpdated(privateEntity.id, { windowMs: 4000 });
		} finally {
			socketB.close();
		}

		// And nothing was enqueued on B's behalf: the entity is still unpopulated.
		const result = await getPgClient().query<{ populatedAt: string | null }>(
			`select populated_at::text as "populatedAt" from entity where id = $1`,
			[privateEntity.id],
		);
		expect(result.rows[0]?.populatedAt ?? null).toBeNull();
	}, 20_000);
});
