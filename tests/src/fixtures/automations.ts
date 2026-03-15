import {
	AutomationRuleId,
	EntityId,
	SignalId,
	SignalSchemaId,
	UserId,
} from "@ryot/contract/schema/brands";

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

export function listSubscriptionRuns(input: { executionUserId: string; signalId?: string }) {
	return getBackendClient().run(
		(c) =>
			c.testSupport.listSubscriptionRuns({
				payload: {
					executionUserId: UserId.make(input.executionUserId),
					signalId: input.signalId ? SignalId.make(input.signalId) : undefined,
				},
			}),
		adminHeaders,
	);
}

const terminalRunStatuses = new Set(["succeeded", "failed", "skipped"]);

export function pollTerminalSubscriptionRuns(
	input: { executionUserId: string; signalId?: string },
	options: PollOptions = {},
) {
	return pollUntil(
		`terminal subscription run(s) for user '${input.executionUserId}'`,
		async () => {
			const runs = await listSubscriptionRuns(input);
			return runs.length > 0 && runs.every((run) => terminalRunStatuses.has(run.status))
				? runs
				: null;
		},
		options,
	);
}

export async function getAutomationRuleCount(userId: string) {
	const { count } = await getBackendClient().run(
		(c) =>
			c.testSupport.countAutomationRules({
				path: { userId: UserId.make(userId) },
			}),
		adminHeaders,
	);
	return count;
}
