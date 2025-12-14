import { describe, expect, it } from "bun:test";

import { AutomationRuleId, SignalSchemaId } from "@ryot/contract/schema/brands";

import {
	cleanupHiddenSignalSchema,
	createAuthenticatedClient,
	deleteRule,
	getBackendClient,
	installNotificationRule,
	listRules,
	listSignalSchemas,
	queryAutomationRules,
	seedHiddenSignalSchema,
} from "../fixtures";
import { getPgClient } from "../setup";
import { assertTaggedError } from "../test-support/assertions";

const NOTIFICATION_SCRIPT_SLUG = "automation.send-signal-notification";

const getSharedNotificationScriptId = async () => {
	const result = await getPgClient().query<{ id: string }>(
		`select id from sandbox_script where slug = $1 and is_builtin = true and user_id is null limit 1`,
		[NOTIFICATION_SCRIPT_SLUG],
	);
	return result.rows[0]?.id;
};

const firstNotificationRule = async (client: Parameters<typeof listRules>[0]) => {
	const rules = await listRules(client);
	const rule = rules.find((r) => r.target.kind === "signal");
	if (rule?.target.kind !== "signal") {
		throw new Error("Expected at least one bootstrapped notification rule");
	}
	return { id: rule.id, signalSchemaId: rule.target.id };
};

describe("notification rules", () => {
	it("requires authentication to list", async () => {
		const error = await getBackendClient().runError((c) => c.automations.listRules());
		assertTaggedError(error, "Unauthorized");
	});

	it("bootstraps one active rule per active signal schema for a fresh user", async () => {
		const { client, userId } = await createAuthenticatedClient();
		const schemas = await listSignalSchemas(client);
		const allRules = await listRules(client);
		const rules = allRules.filter((rule) => rule.target.kind === "signal");
		expect(rules).toHaveLength(schemas.length);

		const rows = await queryAutomationRules(userId);
		expect(rows).toHaveLength(schemas.length);
		for (const row of rows) {
			expect(row.kind).toBe("subscription");
			expect(row.operation).toBe("signal");
			expect(row.isActive).toBe(true);
		}
		const distinctSignalSchemaIds = new Set(rows.map((row) => row.signalSchemaId));
		expect(distinctSignalSchemaIds.size).toBe(rows.length);

		const sharedScriptId = await getSharedNotificationScriptId();
		if (!sharedScriptId) {
			throw new Error("Expected shared notification sandbox script");
		}
		for (const row of rows) {
			expect(row.sandboxScriptId).toBe(sharedScriptId);
		}
	});

	it("deletes a rule and allows reinstalling as a fresh row", async () => {
		const { client, userId } = await createAuthenticatedClient();
		const rule = await firstNotificationRule(client);

		await deleteRule(client, rule.id);
		let rows = await queryAutomationRules(userId);
		expect(rows.some((r) => r.id === rule.id)).toBe(false);

		const reinstalled = await installNotificationRule(client, {
			signalSchemaId: rule.signalSchemaId,
		});
		expect(reinstalled.id).not.toBe(rule.id);
		rows = await queryAutomationRules(userId);
		const newRow = rows.find((r) => r.id === reinstalled.id);
		if (!newRow) {
			throw new Error("Expected reinstalled rule row");
		}
		expect(newRow.isActive).toBe(true);
	});

	it("rejects installing against hidden/inactive or non-signal-schema ids", async () => {
		const { client } = await createAuthenticatedClient();

		const nonSignalSchema = await client.runError((c) =>
			c.automations.installNotificationRule({
				payload: { signalSchemaId: SignalSchemaId.make(crypto.randomUUID()) },
			}),
		);
		assertTaggedError(nonSignalSchema, "NotFound");

		const hidden = await seedHiddenSignalSchema();
		try {
			const hiddenError = await client.runError((c) =>
				c.automations.installNotificationRule({
					payload: { signalSchemaId: SignalSchemaId.make(hidden.id) },
				}),
			);
			assertTaggedError(hiddenError, "NotFound");
		} finally {
			await cleanupHiddenSignalSchema(hidden);
		}
	});

	it("rejects a duplicate install of a still-active rule as a conflict", async () => {
		const { client } = await createAuthenticatedClient();
		const rule = await firstNotificationRule(client);

		const error = await client.runError((c) =>
			c.automations.installNotificationRule({
				payload: { signalSchemaId: rule.signalSchemaId },
			}),
		);
		assertTaggedError(error, "Conflict");
	});

	it("scopes get/delete to the owner, matching a random id's NotFound", async () => {
		const a = await createAuthenticatedClient();
		const b = await createAuthenticatedClient();
		const rule = await firstNotificationRule(a.client);

		const getByOther = await b.client.runError((c) =>
			c.automations.getRule({ path: { ruleId: rule.id } }),
		);
		assertTaggedError(getByOther, "NotFound");

		const getRandom = await b.client.runError((c) =>
			c.automations.getRule({ path: { ruleId: AutomationRuleId.make(crypto.randomUUID()) } }),
		);
		assertTaggedError(getRandom, "NotFound");

		const deleteByOther = await b.client.runError((c) =>
			c.automations.deleteRule({ path: { ruleId: rule.id } }),
		);
		assertTaggedError(deleteByOther, "NotFound");
	});
});
