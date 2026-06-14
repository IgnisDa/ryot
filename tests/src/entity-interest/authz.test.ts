import { describe, expect, it } from "bun:test";

import {
	createAuthenticatedClient,
	findBuiltinSchemaBySlug,
	openInterestStream,
	postBackendJson,
	seedMediaEntity,
} from "../fixtures";
import { getBackendUrl, getPgClient } from "../setup";
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

		const privateEntity = await seedMediaEntity({
			properties: {},
			sandboxScriptId,
			userId: authA.userId,
			entitySchemaId: schema.id,
			name: "A's Private Studio",
			externalId: `private-${crypto.randomUUID()}`,
		});

		const streamB = await openInterestStream(authB);
		try {
			await streamB.declareInterest([privateEntity.id]);
			await streamB.expectNoEntityUpdated(privateEntity.id, { windowMs: 4000 });
		} finally {
			streamB.close();
		}

		const result = await getPgClient().query<{ populatedAt: string | null }>(
			`select populated_at::text as "populatedAt" from entity where id = $1`,
			[privateEntity.id],
		);
		expect(result.rows[0]?.populatedAt ?? null).toBeNull();
	});

	it("rejects an unauthenticated stream connection", async () => {
		const response = await fetch(
			`${getBackendUrl()}/entity-interest/stream?streamId=${crypto.randomUUID()}`,
		);
		expect(response.status).toBe(401);
	});

	it("rejects an unauthenticated interest declaration", async () => {
		const response = await postBackendJson("/entity-interest", {
			entityIds: [],
			streamId: crypto.randomUUID(),
		});
		expect(response.status).toBe(401);
	});

	it("rejects declaring interest on another user's stream", async () => {
		const authA = await createAuthenticatedClient();
		const authB = await createAuthenticatedClient();

		const streamA = await openInterestStream(authA);
		try {
			const response = await postBackendJson(
				"/entity-interest",
				{ streamId: streamA.streamId, entityIds: [] },
				authB.cookies,
			);
			expect(response.status).toBe(404);
		} finally {
			streamA.close();
		}
	});
});
