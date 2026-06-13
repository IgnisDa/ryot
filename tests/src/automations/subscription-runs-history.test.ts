import { afterEach, describe, expect, it } from "bun:test";

import { SubscriptionRunId } from "@ryot/contract/schema/brands";

import {
	bulkSeedSubscriptionRunsForUser,
	createAuthenticatedClient,
	deleteRule,
	getSubscriptionRun,
	listRules,
	listSubscriptionRuns,
} from "../fixtures";
import { getPgClient } from "../setup";
import { assertTaggedError } from "../test-support/assertions";

const systemRunIds: string[] = [];

const seedSystemRun = async () => {
	const id = crypto.randomUUID();
	await getPgClient().query(
		`insert into subscription_run (
		   id, original_rule_id, rule_id, execution_user_id, automation_depth,
		   operation, status, queued_at, rule_snapshot, trigger_snapshot,
		   lifecycle_occurrence_id, source_kind, record_id
		 ) values (
		   $1, $2, null, null, 0,
		   'update', 'succeeded', now(), '{}'::jsonb, '{}'::jsonb,
		   'sys-occurrence-' || $1, 'entity', 'sys-record-' || $1
		 )`,
		[id, `system-rule-${id}`],
	);
	systemRunIds.push(id);
	return id;
};

afterEach(async () => {
	if (systemRunIds.length > 0) {
		await getPgClient().query(`delete from subscription_run where id = any($1::text[])`, [
			systemRunIds,
		]);
		systemRunIds.length = 0;
	}
});

describe("subscription runs history", () => {
	it("scopes runs to the executing user", async () => {
		const a = await createAuthenticatedClient();
		const b = await createAuthenticatedClient();
		const { runIds } = await bulkSeedSubscriptionRunsForUser({ userId: a.userId, count: 3 });

		const aRuns = await listSubscriptionRuns(a.client);
		expect(aRuns.items.map((run) => run.id).sort()).toEqual([...runIds].sort());

		const bRuns = await listSubscriptionRuns(b.client);
		expect(bRuns.items).toEqual([]);
	});

	it("filters by rule (original rule id) and keeps runs after the rule is deleted", async () => {
		const { client, userId } = await createAuthenticatedClient();
		const [rule] = await listRules(client);
		if (!rule) {
			throw new Error("Expected at least one bootstrapped rule");
		}

		const { runIds } = await bulkSeedSubscriptionRunsForUser({
			userId,
			count: 2,
			ruleId: rule.id,
		});
		await bulkSeedSubscriptionRunsForUser({ userId, count: 2 });

		const byRule = await listSubscriptionRuns(client, { ruleId: rule.id });
		expect(byRule.items.map((run) => run.id).sort()).toEqual([...runIds].sort());
		expect(byRule.items.every((run) => run.originalRuleId === rule.id)).toBe(true);

		await deleteRule(client, rule.id);

		const afterDelete = await listSubscriptionRuns(client, { ruleId: rule.id });
		expect(afterDelete.items.map((run) => run.id).sort()).toEqual([...runIds].sort());
		expect(afterDelete.items.every((run) => run.ruleId === null)).toBe(true);
	});

	it("filters by status", async () => {
		const { client, userId } = await createAuthenticatedClient();
		const succeeded = await bulkSeedSubscriptionRunsForUser({
			userId,
			count: 2,
			status: "succeeded",
		});
		const failed = await bulkSeedSubscriptionRunsForUser({ userId, count: 3, status: "failed" });

		const onlyFailed = await listSubscriptionRuns(client, { status: "failed" });
		expect(onlyFailed.items.map((run) => run.id).sort()).toEqual([...failed.runIds].sort());
		expect(onlyFailed.items.every((run) => run.status === "failed")).toBe(true);

		const onlySucceeded = await listSubscriptionRuns(client, { status: "succeeded" });
		expect(onlySucceeded.items.map((run) => run.id).sort()).toEqual([...succeeded.runIds].sort());
	});

	it("paginates with keyset (queued_at desc, id desc), no total, default 50 and max 100", async () => {
		const { client, userId } = await createAuthenticatedClient();
		const { runIds } = await bulkSeedSubscriptionRunsForUser({ userId, count: 60 });

		const page1 = await listSubscriptionRuns(client);
		expect(Object.keys(page1).sort()).toEqual(["items", "nextCursor"]);
		expect(page1.items).toHaveLength(50);
		expect(page1.nextCursor).not.toBeNull();

		const page2 = await listSubscriptionRuns(client, { cursor: page1.nextCursor ?? undefined });
		expect(page2.items).toHaveLength(10);
		expect(page2.nextCursor).toBeNull();

		const seeded = new Set(runIds);
		const page1Ids = new Set(page1.items.map((run) => run.id));
		for (const run of page2.items) {
			expect(seeded.has(run.id)).toBe(true);
			expect(page1Ids.has(run.id)).toBe(false);
		}

		const capped = await listSubscriptionRuns(client, { pageSize: 150 });
		expect(capped.items.length).toBeLessThanOrEqual(100);
	});

	it("keeps rows whose queued timestamps share a millisecond", async () => {
		const { client, userId } = await createAuthenticatedClient();
		const { runIds } = await bulkSeedSubscriptionRunsForUser({
			userId,
			count: 60,
			sameMillisecond: true,
		});

		const page1 = await listSubscriptionRuns(client);
		const page2 = await listSubscriptionRuns(client, { cursor: page1.nextCursor ?? undefined });

		expect(page1.items).toHaveLength(50);
		expect(page2.items).toHaveLength(10);
		expect(new Set([...page1.items, ...page2.items].map((run) => run.id))).toEqual(new Set(runIds));
	});

	it("never returns system runs and matches NotFound for missing ids", async () => {
		const { client, userId } = await createAuthenticatedClient();
		const { runIds } = await bulkSeedSubscriptionRunsForUser({ userId, count: 1 });
		const systemRunId = await seedSystemRun();

		const runs = await listSubscriptionRuns(client);
		expect(runs.items.map((run) => run.id)).not.toContain(systemRunId);

		const systemLookup = await client.runError((c) =>
			c.automations.getSubscriptionRun({ path: { runId: SubscriptionRunId.make(systemRunId) } }),
		);
		assertTaggedError(systemLookup, "NotFound");

		const random = await client.runError((c) =>
			c.automations.getSubscriptionRun({
				path: { runId: SubscriptionRunId.make(crypto.randomUUID()) },
			}),
		);
		assertTaggedError(random, "NotFound");

		const ownRunId = runIds[0];
		if (!ownRunId) {
			throw new Error("Expected a seeded run id");
		}
		const own = await getSubscriptionRun(client, ownRunId);
		expect(own.id).toBe(ownRunId);
	});
});
