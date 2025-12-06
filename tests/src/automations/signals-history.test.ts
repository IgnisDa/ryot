import { describe, expect, it } from "bun:test";

import { SignalId } from "@ryot/contract/schema/brands";

import {
	bulkSeedActorSignalsForUser,
	createAuthenticatedClient,
	getSignal,
	listSignals,
} from "../fixtures";
import { getPgClient } from "../setup";
import { assertTaggedError } from "../test-support/assertions";

const REVIEW_CREATED_SLUG = "review.created";
const MEDIA_STATUS_CHANGED_SLUG = "media.status.changed";

describe("signals history", () => {
	it("scopes signals to their recipient", async () => {
		const a = await createAuthenticatedClient();
		const b = await createAuthenticatedClient();
		const { signalIds } = await bulkSeedActorSignalsForUser({
			count: 3,
			userId: a.userId,
			slug: MEDIA_STATUS_CHANGED_SLUG,
		});

		const aSignals = await listSignals(a.client);
		expect(aSignals.items.map((item) => item.id as string).sort()).toEqual([...signalIds].sort());

		const bSignals = await listSignals(b.client);
		expect(bSignals.items).toEqual([]);
	});

	it("returns identical NotFound for another user's signal and a random id", async () => {
		const a = await createAuthenticatedClient();
		const b = await createAuthenticatedClient();
		const { signalIds } = await bulkSeedActorSignalsForUser({
			count: 1,
			userId: a.userId,
			slug: MEDIA_STATUS_CHANGED_SLUG,
		});
		const signalId = signalIds[0];
		if (!signalId) {
			throw new Error("Expected a seeded signal id");
		}

		const notReceived = await b.client.runError((c) =>
			c.automations.getSignal({ path: { signalId: SignalId.make(signalId) } }),
		);
		assertTaggedError(notReceived, "NotFound");

		const random = await b.client.runError((c) =>
			c.automations.getSignal({ path: { signalId: SignalId.make(crypto.randomUUID()) } }),
		);
		assertTaggedError(random, "NotFound");

		const found = await getSignal(a.client, signalId);
		expect(found.id as string).toBe(signalId);
	});

	it("filters by signalSchemaId", async () => {
		const { client, userId } = await createAuthenticatedClient();
		const first = await bulkSeedActorSignalsForUser({
			userId,
			count: 2,
			slug: MEDIA_STATUS_CHANGED_SLUG,
		});
		const second = await bulkSeedActorSignalsForUser({
			userId,
			count: 2,
			slug: REVIEW_CREATED_SLUG,
		});

		const filtered = await listSignals(client, { signalSchemaId: first.signalSchemaId });
		expect(filtered.items.map((item) => item.id as string).sort()).toEqual(
			[...first.signalIds].sort(),
		);
		expect(filtered.items.every((item) => item.schema.id === first.signalSchemaId)).toBe(true);

		const filteredSecond = await listSignals(client, { signalSchemaId: second.signalSchemaId });
		expect(filteredSecond.items.map((item) => item.id as string).sort()).toEqual(
			[...second.signalIds].sort(),
		);
	});

	it("paginates with keyset (created_at desc, id desc), no total, and is append-only stable", async () => {
		const { client, userId } = await createAuthenticatedClient();
		const { signalIds } = await bulkSeedActorSignalsForUser({
			userId,
			count: 60,
			slug: MEDIA_STATUS_CHANGED_SLUG,
		});

		const page1 = await listSignals(client);
		expect(Object.keys(page1).sort()).toEqual(["items", "nextCursor"]);
		expect(page1.items).toHaveLength(50);
		expect(page1.nextCursor).not.toBeNull();

		const newer = await bulkSeedActorSignalsForUser({
			userId,
			count: 1,
			slug: MEDIA_STATUS_CHANGED_SLUG,
		});

		const page2 = await listSignals(client, { cursor: page1.nextCursor ?? undefined });
		expect(page2.items).toHaveLength(10);
		expect(page2.nextCursor).toBeNull();
		const page2Ids = page2.items.map((item) => item.id as string);
		expect(page2Ids).not.toContain(newer.signalIds[0]);

		const allSeededIds = new Set(signalIds);
		const page1Ids = new Set(page1.items.map((item) => item.id as string));
		for (const id of page2Ids) {
			expect(allSeededIds.has(id)).toBe(true);
			expect(page1Ids.has(id)).toBe(false);
		}
	});

	it("caps pageSize at 100", async () => {
		const { client, userId } = await createAuthenticatedClient();
		await bulkSeedActorSignalsForUser({ userId, slug: MEDIA_STATUS_CHANGED_SLUG, count: 60 });

		const page = await listSignals(client, { pageSize: 150 });
		expect(page.items.length).toBeLessThanOrEqual(100);
	});

	it("excludes actor/related_users signals with zero recipient rows", async () => {
		const { client, userId } = await createAuthenticatedClient();
		const { signalSchemaId } = await bulkSeedActorSignalsForUser({
			userId,
			slug: MEDIA_STATUS_CHANGED_SLUG,
			count: 1,
		});
		const orphanId = crypto.randomUUID();
		await getPgClient().query(
			`insert into signal (
			   id, origin, properties, occurred_at, created_at,
			   actor_user_id, signal_schema_id, automation_depth
			 ) values ($1, '{"kind":"api"}'::jsonb, '{}'::jsonb, now(), now(), $2, $3, 0)`,
			[orphanId, userId, signalSchemaId],
		);

		const page = await listSignals(client, { signalSchemaId });
		expect(page.items.map((item) => item.id as string)).not.toContain(orphanId);
	});
});
