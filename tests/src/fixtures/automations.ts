import { AutomationRuleId, SignalSchemaId } from "@ryot/contract/schema/brands";

import { getPgClient } from "~/setup";

import type { Client } from "./auth";
import { pollUntil, type PollOptions } from "./polling";

export function listAutomationCatalog(client: Client) {
	return client.run((c) => c.automations.listCatalog());
}

export function getAutomationCatalogSchema(client: Client, signalSchemaId: string) {
	return client.run((c) =>
		c.automations.getCatalog({ path: { signalSchemaId: SignalSchemaId.make(signalSchemaId) } }),
	);
}

export function listNotificationRules(client: Client) {
	return client.run((c) => c.automations.listRules());
}

export function getNotificationRule(client: Client, ruleId: string) {
	return client.run((c) =>
		c.automations.getRule({ path: { ruleId: AutomationRuleId.make(ruleId) } }),
	);
}

export function installNotificationRule(client: Client, signalSchemaId: string) {
	return client.run((c) =>
		c.automations.installRule({ payload: { signalSchemaId: SignalSchemaId.make(signalSchemaId) } }),
	);
}

export function setNotificationRuleActive(client: Client, ruleId: string, isActive: boolean) {
	const path = { ruleId: AutomationRuleId.make(ruleId) };
	return client.run((c) =>
		isActive ? c.automations.activateRule({ path }) : c.automations.deactivateRule({ path }),
	);
}

export function deleteNotificationRule(client: Client, ruleId: string) {
	return client.run((c) =>
		c.automations.deleteRule({ path: { ruleId: AutomationRuleId.make(ruleId) } }),
	);
}

/**
 * Signal, recipient, and run history has no listing endpoint (deferred per the automations
 * PRD), so these are the documented SQL exception for asserting account-deletion cleanup and
 * subscription-run completion. See tests/AGENTS.md's SQL allowlist.
 */
export async function querySignalId(input: {
	schemaSlug: string;
	actorUserId?: string;
	subjectEntityId?: string;
}) {
	const params: unknown[] = [input.schemaSlug];
	const conditions = ["ss.slug = $1"];
	if (input.actorUserId) {
		params.push(input.actorUserId);
		conditions.push(`s.actor_user_id = $${params.length}`);
	}
	if (input.subjectEntityId) {
		params.push(input.subjectEntityId);
		conditions.push(`s.subject_entity_id = $${params.length}`);
	}
	const result = await getPgClient().query<{ id: string }>(
		`select s.id from signal s
		 inner join signal_schema ss on ss.id = s.signal_schema_id
		 where ${conditions.join(" and ")}
		 order by s.created_at desc
		 limit 1`,
		params,
	);
	return result.rows[0]?.id ?? null;
}

export function pollSignalId(
	input: { schemaSlug: string; actorUserId?: string; subjectEntityId?: string },
	options: PollOptions = {},
) {
	return pollUntil(`signal for '${input.schemaSlug}'`, () => querySignalId(input), options);
}

export async function querySignalRecipientUserIds(signalId: string) {
	const result = await getPgClient().query<{ user_id: string }>(
		`select user_id from signal_recipient where signal_id = $1`,
		[signalId],
	);
	return result.rows.map((row) => row.user_id);
}

export function pollSignalRecipientCount(
	signalId: string,
	count: number,
	options: PollOptions = {},
) {
	return pollUntil(
		`${count} recipient(s) for signal '${signalId}'`,
		async () => {
			const userIds = await querySignalRecipientUserIds(signalId);
			return userIds.length === count ? userIds : null;
		},
		options,
	);
}

export async function querySubscriptionRunStatuses(input: {
	executionUserId: string;
	signalId?: string;
}) {
	const params: unknown[] = [input.executionUserId];
	const conditions = ["execution_user_id = $1"];
	if (input.signalId) {
		params.push(input.signalId);
		conditions.push(`signal_id = $${params.length}`);
	}
	const result = await getPgClient().query<{ status: string }>(
		`select status from subscription_run where ${conditions.join(" and ")}`,
		params,
	);
	return result.rows.map((row) => row.status);
}

const terminalRunStatuses = new Set(["succeeded", "failed", "skipped"]);

export function pollTerminalSubscriptionRunStatuses(
	input: { executionUserId: string; signalId?: string },
	options: PollOptions = {},
) {
	return pollUntil(
		`terminal subscription run(s) for user '${input.executionUserId}'`,
		async () => {
			const statuses = await querySubscriptionRunStatuses(input);
			return statuses.length > 0 && statuses.every((status) => terminalRunStatuses.has(status))
				? statuses
				: null;
		},
		options,
	);
}

export async function queryAutomationRuleCount(userId: string) {
	const result = await getPgClient().query<{ count: string }>(
		`select count(*)::text as count from automation_rule where user_id = $1`,
		[userId],
	);
	return Number(result.rows[0]?.count ?? 0);
}
