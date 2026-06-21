import {
	AutomationRuleId,
	EntityId,
	SignalId,
	SignalSchemaId,
	UserId,
} from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import { adminHeaders } from "./admin";
import type { Client } from "./auth";
import { getBackendClient } from "./contract-client";
import { pollUntil, type PollOptions } from "./polling";

export const listAutomationCatalog = (client: Client) =>
	client.call((c) => c.automations.listCatalog());

export const getAutomationCatalogSchema = (client: Client, signalSchemaId: string) =>
	client.call((c) =>
		c.automations.getCatalog({ path: { signalSchemaId: SignalSchemaId.make(signalSchemaId) } }),
	);

export const listNotificationRules = (client: Client) =>
	client.call((c) => c.automations.listRules());

export const getNotificationRule = (client: Client, ruleId: string) =>
	client.call((c) => c.automations.getRule({ path: { ruleId: AutomationRuleId.make(ruleId) } }));

export const installNotificationRule = (client: Client, signalSchemaId: string) =>
	client.call((c) =>
		c.automations.installRule({ payload: { signalSchemaId: SignalSchemaId.make(signalSchemaId) } }),
	);

export const setNotificationRuleActive = (client: Client, ruleId: string, isActive: boolean) => {
	const path = { ruleId: AutomationRuleId.make(ruleId) };
	return client.call((c) =>
		isActive ? c.automations.activateRule({ path }) : c.automations.deactivateRule({ path }),
	);
};

export const deleteNotificationRule = (client: Client, ruleId: string) =>
	client.call((c) => c.automations.deleteRule({ path: { ruleId: AutomationRuleId.make(ruleId) } }));

export interface SignalFilter {
	schemaSlug: string;
	actorUserId?: string;
	subjectEntityId?: string;
}

/**
 * Inspects signals and their recipients through the admin `testSupport.listSignals` endpoint.
 * Rows come back newest-first, so `[0]` is the most recently created matching signal.
 */
export const listSignals = (filter: SignalFilter) =>
	getBackendClient().call(
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

export const pollSignal = (filter: SignalFilter, options: PollOptions = {}) =>
	pollUntil(
		`signal for '${filter.schemaSlug}'`,
		Effect.gen(function* () {
			const [signal] = yield* listSignals(filter);
			return signal ?? null;
		}),
		options,
	);

export const pollSignalWithRecipientCount = (
	filter: SignalFilter,
	count: number,
	options: PollOptions = {},
) =>
	pollUntil(
		`${count} recipient(s) for signal '${filter.schemaSlug}'`,
		Effect.gen(function* () {
			const [signal] = yield* listSignals(filter);
			return signal?.recipientUserIds.length === count ? signal : null;
		}),
		options,
	);

export const listSubscriptionRuns = (input: { executionUserId: string; signalId?: string }) =>
	getBackendClient().call(
		(c) =>
			c.testSupport.listSubscriptionRuns({
				payload: {
					executionUserId: UserId.make(input.executionUserId),
					signalId: input.signalId ? SignalId.make(input.signalId) : undefined,
				},
			}),
		adminHeaders,
	);

const terminalRunStatuses = new Set(["succeeded", "failed", "skipped"]);

export const pollTerminalSubscriptionRuns = (
	input: { executionUserId: string; signalId?: string },
	options: PollOptions = {},
) =>
	pollUntil(
		`terminal subscription run(s) for user '${input.executionUserId}'`,
		Effect.gen(function* () {
			const runs = yield* listSubscriptionRuns(input);
			return runs.length > 0 && runs.every((run) => terminalRunStatuses.has(run.status))
				? runs
				: null;
		}),
		options,
	);

export const getAutomationRuleCount = (userId: string) =>
	Effect.gen(function* () {
		const { count } = yield* getBackendClient().call(
			(c) =>
				c.testSupport.countAutomationRules({
					path: { userId: UserId.make(userId) },
				}),
			adminHeaders,
		);
		return count;
	});
