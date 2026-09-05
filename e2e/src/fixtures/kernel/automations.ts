import type { ContractPayload, ContractSuccess } from "@ryot-app/contract/client";
import {
	NotificationSubscriptionId,
	SignalSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import {
	notificationSubscriptionRecipe,
	notificationSubscriptionsRecipe,
} from "@ryot-app/ryotql-recipes/notification-subscriptions";
import { Effect } from "effect";

import { adminHeaders } from "./admin";
import type { Client } from "./auth";
import { getApiClient } from "./contract-client";
import { pollUntil } from "./polling";
import { executeRyotQLRecipe } from "./ryotql";

export const listAutomationCatalog = (client: Client) =>
	client.call((c) => c.automations.listCatalog());

export const getAutomationCatalogSchema = (client: Client, signalSchemaSlug: string) =>
	client.call((c) =>
		c.automations.getCatalog({
			params: { signalSchemaSlug: SignalSchemaSlug.make(signalSchemaSlug) },
		}),
	);

export const listNotificationSubscriptions = (
	client: Client,
	input: Parameters<typeof notificationSubscriptionsRecipe>[0],
) =>
	executeRyotQLRecipe(client, notificationSubscriptionsRecipe(input)).pipe(
		Effect.map((result) => result.items),
	);

export const getNotificationSubscription = (client: Client, ruleId: string) =>
	executeRyotQLRecipe(client, notificationSubscriptionRecipe({ id: ruleId }));

export const installNotificationRule = (client: Client, signalSchemaSlug: string) =>
	client.call((c) =>
		c.automations.installRule({
			payload: { signalSchemaSlug: SignalSchemaSlug.make(signalSchemaSlug) },
		}),
	);

export const setNotificationRuleActive = (client: Client, ruleId: string, isActive: boolean) => {
	const params = { ruleId: NotificationSubscriptionId.make(ruleId) };
	return client.call((c) =>
		isActive ? c.automations.activateRule({ params }) : c.automations.deactivateRule({ params }),
	);
};

export const deleteNotificationRule = (client: Client, ruleId: string) =>
	client.call((c) =>
		c.automations.deleteRule({ params: { ruleId: NotificationSubscriptionId.make(ruleId) } }),
	);

export type AutomationTriggerFilter = ContractPayload<"testSupport", "listAutomationTriggers">;
export type AutomationTrigger = ContractSuccess<"testSupport", "listAutomationTriggers">[number];
export type AutomationTriggerRecipientFilter = ContractPayload<
	"testSupport",
	"listAutomationTriggerRecipients"
>;
export type AutomationRunFilter = ContractPayload<"testSupport", "listAutomationRuns">;
export type AutomationRun = ContractSuccess<"testSupport", "listAutomationRuns">[number];
export type AutomationRunAttemptFilter = ContractPayload<
	"testSupport",
	"listAutomationRunAttempts"
>;
export type AutomationRunAttempt = ContractSuccess<
	"testSupport",
	"listAutomationRunAttempts"
>[number];

const automationFilterLabel = (filter: AutomationTriggerFilter | AutomationRunFilter): string =>
	filter.triggerId ??
	filter.rootExecutionId ??
	("hookSlug" in filter ? filter.hookSlug : undefined) ??
	(filter.sourceRecord
		? `${filter.sourceRecord.resource}:${filter.sourceRecord.id}`
		: "matching filters");

export const listAutomationTriggers = (payload: AutomationTriggerFilter) =>
	getApiClient().call((c) => c.testSupport.listAutomationTriggers({ payload }), adminHeaders());

export const pollAutomationTriggers = (payload: AutomationTriggerFilter, minimumCount = 1) =>
	pollUntil(
		`at least ${minimumCount} automation trigger(s) for '${automationFilterLabel(payload)}'`,
		listAutomationTriggers(payload).pipe(
			Effect.map((triggers) => (triggers.length >= minimumCount ? triggers : null)),
		),
	);

export const pollAutomationTrigger = (payload: AutomationTriggerFilter) =>
	pollAutomationTriggers(payload).pipe(
		Effect.map(([trigger]) => {
			if (!trigger) {
				throw new Error("Automation trigger polling completed without a trigger");
			}
			return trigger;
		}),
	);

type SignalPayload = Extract<
	NonNullable<AutomationTrigger["payload"]>,
	{ readonly category: "signal" }
>;
type SignalTrigger = AutomationTrigger & { readonly payload: SignalPayload };

export type SignalTriggerFilter = Pick<SignalPayload, "signalSchemaSlug"> &
	Partial<Pick<SignalPayload, "actorUserId" | "subjectEntityId">>;

const isSignalTrigger = (trigger: AutomationTrigger): trigger is SignalTrigger =>
	trigger.payload?.category === "signal";

export const listSignalTriggers = (filter: SignalTriggerFilter) =>
	listAutomationTriggers({}).pipe(
		Effect.map((triggers) =>
			triggers.filter(
				(trigger): trigger is SignalTrigger =>
					isSignalTrigger(trigger) &&
					trigger.payload.signalSchemaSlug === filter.signalSchemaSlug &&
					(filter.actorUserId === undefined ||
						trigger.payload.actorUserId === filter.actorUserId) &&
					(filter.subjectEntityId === undefined ||
						trigger.payload.subjectEntityId === filter.subjectEntityId),
			),
		),
	);

export const listAutomationTriggerRecipients = (payload: AutomationTriggerRecipientFilter) =>
	getApiClient().call(
		(c) => c.testSupport.listAutomationTriggerRecipients({ payload }),
		adminHeaders(),
	);

export const pollAutomationTriggerRecipients = (
	payload: AutomationTriggerRecipientFilter,
	minimumCount = 1,
) =>
	pollUntil(
		`at least ${minimumCount} recipient(s) for automation trigger '${payload.triggerId}'`,
		listAutomationTriggerRecipients(payload).pipe(
			Effect.map((recipients) => (recipients.length >= minimumCount ? recipients : null)),
		),
	);

export const pollSignalTrigger = (filter: SignalTriggerFilter) =>
	pollUntil(
		`signal trigger for '${filter.signalSchemaSlug}'`,
		Effect.gen(function* () {
			const [trigger] = yield* listSignalTriggers(filter);
			return trigger ?? null;
		}),
	);

export const pollSignalTriggerWithRecipientCount = (filter: SignalTriggerFilter, count: number) =>
	pollUntil(
		`${count} recipient(s) for signal trigger '${filter.signalSchemaSlug}'`,
		Effect.gen(function* () {
			const triggers = yield* listSignalTriggers(filter);
			for (const trigger of triggers) {
				const recipients = yield* listAutomationTriggerRecipients({ triggerId: trigger.id });
				if (recipients.length === count) {
					return { ...trigger, recipientUserIds: recipients.map(({ userId }) => userId) };
				}
			}
			return null;
		}),
	);

export const listAutomationRuns = (payload: AutomationRunFilter) =>
	getApiClient().call((c) => c.testSupport.listAutomationRuns({ payload }), adminHeaders());

export const reconcileAutomations = Effect.suspend(() =>
	getApiClient().call((c) => c.testSupport.reconcileAutomations({ payload: {} }), adminHeaders()),
);

export const pollAutomationRuns = (payload: AutomationRunFilter, minimumCount = 1) =>
	pollUntil(
		`at least ${minimumCount} automation run(s) for '${automationFilterLabel(payload)}'`,
		listAutomationRuns(payload).pipe(
			Effect.map((runs) => (runs.length >= minimumCount ? runs : null)),
		),
	);

const terminalRunStatuses = new Set(["succeeded", "failed", "rejected", "skipped"]);

export const pollTerminalAutomationRuns = (payload: AutomationRunFilter) =>
	pollUntil(
		`terminal automation run(s) for '${automationFilterLabel(payload)}'`,
		Effect.gen(function* () {
			const runs = yield* listAutomationRuns(payload);
			return runs.length > 0 && runs.every((run) => terminalRunStatuses.has(run.status))
				? runs
				: null;
		}),
	);

export const listAutomationRunAttempts = (payload: AutomationRunAttemptFilter) =>
	getApiClient().call((c) => c.testSupport.listAutomationRunAttempts({ payload }), adminHeaders());

export const pollAutomationRunAttempts = (payload: AutomationRunAttemptFilter, minimumCount = 1) =>
	pollUntil(
		`at least ${minimumCount} attempt(s) for automation run '${payload.runId}'`,
		listAutomationRunAttempts(payload).pipe(
			Effect.map((attempts) => (attempts.length >= minimumCount ? attempts : null)),
		),
	);

export const pollTerminalAutomationRunAttempts = (
	payload: Omit<AutomationRunAttemptFilter, "status">,
	minimumCount = 1,
) =>
	pollUntil(
		`at least ${minimumCount} terminal attempt(s) for automation run '${payload.runId}'`,
		listAutomationRunAttempts(payload).pipe(
			Effect.map((attempts) =>
				attempts.length >= minimumCount && attempts.every(({ status }) => status !== "running")
					? attempts
					: null,
			),
		),
	);

export const getAutomationRuleCount = (userId: string) =>
	Effect.gen(function* () {
		const { count } = yield* getApiClient().call(
			(c) => c.testSupport.countAutomationRules({ params: { userId: UserId.make(userId) } }),
			adminHeaders(),
		);
		return count;
	});
