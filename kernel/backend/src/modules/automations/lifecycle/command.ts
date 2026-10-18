import {
	type AutomationCausation,
	type AutomationInitiator,
	type AutomationPopulationContext,
	type AutomationSource,
	type AutomationTrigger,
	AutomationTriggerKind,
	type AutomationTriggerPayload,
	type ExecutionLane,
	type LifecycleCommand,
} from "@ryot-app/contract/modules/automations/lifecycle";
import type { SandboxExecutionSubject } from "@ryot-app/contract/modules/scripts/schemas";
import type { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import type {
	AutomationExecutionId,
	ImportRunId,
	IntegrationId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Schema } from "effect";

import { lifecycleTriggerId } from "./planning";

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
	user: null | {
		userId: UserId;
		accountGeneration: AccountGeneration;
		integrationId?: AutomationCausation["integrationId"];
	},
): { initiator: AutomationInitiator } & Pick<LifecycleCommand, "accountGeneration"> => {
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

type AutomationRunSubject = Extract<SandboxExecutionSubject, { type: "automation-run" }>;

export const automationRunLane = (run: {
	readonly delivery: AutomationRunSubject["delivery"];
	readonly causation: Pick<AutomationRunSubject["causation"], "lane">;
}): ExecutionLane => (run.delivery === "async" ? "background" : run.causation.lane);

export const automationLifecycleCausation = (
	parent: Pick<AutomationRunSubject, "runId" | "delivery" | "causation" | "triggerId">,
	executionId: AutomationExecutionId,
): AutomationCausation => ({
	...parent.causation,
	executionId,
	source: "automation",
	parentRunId: parent.runId,
	lane: automationRunLane(parent),
	parentTriggerId: parent.triggerId,
	depth: parent.causation.depth + 1,
});

export const rootLifecycleCausation = (input: {
	lane: ExecutionLane;
	importRunId?: ImportRunId;
	integrationId?: IntegrationId;
	initiator: AutomationInitiator;
	executionId: AutomationExecutionId;
	providerExecutionId?: AutomationExecutionId;
	source: Exclude<AutomationSource, "automation">;
}): AutomationCausation => ({
	depth: 0,
	lane: input.lane,
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
		Pick<LifecycleCommand, "occurredAt" | "itemIdentity" | "accountGeneration">,
): LifecycleCommand => ({
	occurredAt: input.occurredAt,
	itemIdentity: input.itemIdentity,
	causation: rootLifecycleCausation(input),
	accountGeneration: input.accountGeneration,
});

export const lifecycleTrigger = (
	command: LifecycleCommand,
	scopeUserId: null | UserId,
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
