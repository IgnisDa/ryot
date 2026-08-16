import {
	AutomationTriggerKind,
	LifecycleCommand,
	type AutomationInitiator,
	type AutomationSource,
	type AutomationTrigger,
	type AutomationTriggerPayload,
} from "@ryot-app/contract/modules/automations/lifecycle";
import type {
	AutomationExecutionId,
	ImportRunId,
	IntegrationId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import type { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { Schema } from "effect";

import { lifecycleTriggerId } from "./lifecycle";

export { LifecycleCommand };

export const rootLifecycleCommand = (input: {
	itemIdentity: string;
	importRunId?: ImportRunId;
	integrationId?: IntegrationId;
	occurredAt: Schema.Schema.Type<typeof IsoUtcString>;
	initiator: AutomationInitiator;
	executionId: AutomationExecutionId;
	source: Exclude<AutomationSource, "automation">;
	providerExecutionId?: AutomationExecutionId;
}): LifecycleCommand => ({
	occurredAt: input.occurredAt,
	itemIdentity: input.itemIdentity,
	causation: {
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
	},
});

export const lifecycleTrigger = (
	command: LifecycleCommand,
	scopeUserId: UserId | null,
	payload: AutomationTriggerPayload,
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
			discriminator: "lifecycle",
			itemIdentity: command.itemIdentity,
			executionId: command.causation.executionId,
		}),
	};
};
