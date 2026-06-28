import { AutomationRuleId, EntityId, SignalSchemaId, UserId } from "@ryot/contract/schema/brands";

import { getPgClient } from "~/setup";

import { adminHeaders } from "./admin";
import type { Client } from "./auth";
import { getBackendClient } from "./contract-client";
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

export interface SignalFilter {
	schemaSlug: string;
	actorUserId?: string;
	subjectEntityId?: string;
}

/**
 * Inspects signals and their recipients through the admin `testSupport.listSignals` endpoint.
 * Rows come back newest-first, so `[0]` is the most recently created matching signal.
 */
export function listSignals(filter: SignalFilter) {
	return getBackendClient().run(
		(c) =>
			c.testSupport.listSignals({
				payload: {
					schemaSlug: filter.schemaSlug,
					actorUserId: filter.actorUserId ? UserId.make(filter.actorUserId) : undefined,
					subjectEntityId: filter.subjectEntityId
						? EntityId.make(filter.subjectEntityId)
						: undefined,
				},
			}),
		adminHeaders,
	);
}

export function pollSignal(filter: SignalFilter, options: PollOptions = {}) {
	return pollUntil(
		`signal for '${filter.schemaSlug}'`,
		async () => {
			const [signal] = await listSignals(filter);
			return signal ?? null;
		},
		options,
	);
}

export function pollSignalWithRecipientCount(
	filter: SignalFilter,
	count: number,
	options: PollOptions = {},
) {
	return pollUntil(
		`${count} recipient(s) for signal '${filter.schemaSlug}'`,
		async () => {
			const [signal] = await listSignals(filter);
			return signal?.recipientUserIds.length === count ? signal : null;
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
