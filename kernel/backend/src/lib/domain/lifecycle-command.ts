import {
	type LifecycleCommand,
	AutomationTriggerKind,
	type AutomationInitiator,
	type AutomationCausation,
	type AutomationPopulationContext,
	type AutomationSource,
	type AutomationTrigger,
	type AutomationTriggerPayload,
} from "@ryot-app/contract/modules/automations/lifecycle";
import type { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import type {
	AutomationExecutionId,
	ImportRunId,
	IntegrationId,
	AutomationRunId,
	AutomationTriggerId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Schema } from "effect";

import { lifecycleTriggerId } from "./lifecycle";

export const childLifecycleCommand = (
	command: LifecycleCommand,
	itemIdentity: string,
): LifecycleCommand => ({
	...command,
	itemIdentity: stableStringify([command.itemIdentity, itemIdentity]),
});

export const populationLifecycleCommand = (
	command: LifecycleCommand,
	itemIdentity: ReadonlyArray<string>,
	population: AutomationPopulationContext,
): LifecycleCommand => ({
	...command,
	population,
	itemIdentity: stableStringify([command.itemIdentity, ...itemIdentity]),
});

export const lifecycleActor = (
	user: {
		userId: UserId;
		accountGeneration: AccountGeneration;
		integrationId?: AutomationCausation["integrationId"];
	} | null,
): Pick<LifecycleCommand, "accountGeneration"> & { initiator: AutomationInitiator } => {
	if (user === null) {
		return { accountGeneration: null, initiator: { id: null, kind: "system" } };
	}
	return {
		accountGeneration: user.accountGeneration,
		initiator:
			user.integrationId === undefined
				? { kind: "user", id: user.userId }
				: { kind: "integration", id: user.integrationId },
	};
};

export const automationLifecycleCausation = (
	parent: {
		causation: AutomationCausation;
		runId: AutomationRunId;
		triggerId: AutomationTriggerId;
	},
	executionId: AutomationExecutionId,
): AutomationCausation => ({
	...parent.causation,
	executionId,
	source: "automation",
	parentRunId: parent.runId,
	parentTriggerId: parent.triggerId,
	depth: parent.causation.depth + 1,
});

export const rootLifecycleCausation = (input: {
	importRunId?: ImportRunId;
	integrationId?: IntegrationId;
	initiator: AutomationInitiator;
	executionId: AutomationExecutionId;
	source: Exclude<AutomationSource, "automation">;
	providerExecutionId?: AutomationExecutionId;
}): AutomationCausation => ({
	depth: 0,
	parentRunId: null,
	source: input.source,
	parentTriggerId: null,
	initiator: input.initiator,
	executionId: input.executionId,
	rootExecutionId: input.executionId,
	...(input.integrationId === undefined ? {} : { integrationId: input.integrationId }),
	...(input.importRunId === undefined ? {} : { importRunId: input.importRunId }),
	...(input.providerExecutionId === undefined
		? {}
		: { providerExecutionId: input.providerExecutionId }),
});

export const rootLifecycleCommand = (
	input: Parameters<typeof rootLifecycleCausation>[0] &
		Pick<LifecycleCommand, "itemIdentity" | "occurredAt" | "accountGeneration">,
): LifecycleCommand => ({
	occurredAt: input.occurredAt,
	itemIdentity: input.itemIdentity,
	causation: rootLifecycleCausation(input),
	accountGeneration: input.accountGeneration,
});

export const lifecycleTrigger = (
	command: LifecycleCommand,
	scopeUserId: UserId | null,
	payload: AutomationTriggerPayload,
	discriminator = "lifecycle",
): AutomationTrigger => {
	const kind = Schema.decodeUnknownSync(AutomationTriggerKind)({
		category: payload.category,
		resource: payload.resource,
		operation: payload.operation,
	});

	return {
		kind,
		payload,
		scopeUserId,
		blockedReason: null,
		payloadPrunedAt: null,
		causation: command.causation,
		createdAt: command.occurredAt,
		occurredAt: command.occurredAt,
		id: lifecycleTriggerId({
			kind,
			discriminator,
			itemIdentity: command.itemIdentity,
			executionId: command.causation.executionId,
		}),
	};
};
