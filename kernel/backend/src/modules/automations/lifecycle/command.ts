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
import type {
	AutomationExecutionId,
	ImportRunId,
	IntegrationId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Effect, Schema } from "effect";

import type { DomainLifecycleCommand } from "#modules/entities/write-context";
import type { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";

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
	user: null | { userId: UserId; integrationId?: AutomationCausation["integrationId"] },
): { initiator: AutomationInitiator } & Pick<LifecycleCommand, "accountUserId"> => {
	if (user === null) {
		return { accountUserId: null, initiator: { id: null, kind: "system" } };
	}
	return {
		accountUserId: user.userId,
		initiator:
			user.integrationId === undefined
				? { kind: "user", id: user.userId }
				: { kind: "integration", id: user.integrationId },
	};
};

type AutomationRunSubject = Extract<SandboxExecutionSubject, { type: "automation-run" }>;

/** The sandbox subject of one automation run triggered by `trigger`, for its principal to decode. */
export const automationRunSubject = <
	Plugin extends Pick<
		AutomationRunSubject,
		"pluginId" | "pluginRevisionId" | "pluginConfigRevisionId"
	>,
>(
	run: {
		readonly runId: AutomationRunSubject["runId"];
		readonly stage: AutomationRunSubject["stage"];
		readonly accountUserId: AutomationRunSubject["accountUserId"];
		readonly trigger: Pick<AutomationTrigger, "id" | "causation">;
		readonly executionUserId: AutomationRunSubject["executionUserId"];
	},
	plugin: Plugin,
) => ({
	...plugin,
	runId: run.runId,
	stage: run.stage,
	triggerId: run.trigger.id,
	type: "automation-run" as const,
	accountUserId: run.accountUserId,
	causation: run.trigger.causation,
	executionUserId: run.executionUserId,
});

export const automationRunLane = (run: {
	readonly stage: AutomationRunSubject["stage"];
	readonly causation: Pick<AutomationRunSubject["causation"], "lane">;
}): ExecutionLane => (run.stage === "after" ? "background" : run.causation.lane);

export const automationLifecycleCausation = (
	parent: Pick<AutomationRunSubject, "runId" | "stage" | "causation" | "triggerId">,
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
		Pick<LifecycleCommand, "occurredAt" | "itemIdentity" | "accountUserId">,
): LifecycleCommand => ({
	occurredAt: input.occurredAt,
	itemIdentity: input.itemIdentity,
	accountUserId: input.accountUserId,
	causation: rootLifecycleCausation(input),
});

/**
 * The command a principal's writes commit under. An automation run's writes descend from its
 * trigger, keeping its root budget; any other principal starts a root causation from `source`, or
 * from its integration when it runs for one. Every ID the commit derives comes from `executionId`.
 */
export const principalLifecycleCommand = (input: {
	readonly lane: ExecutionLane;
	readonly itemIdentity: string;
	readonly importRunId?: ImportRunId;
	readonly integrationId?: IntegrationId;
	readonly executionId: AutomationExecutionId;
	readonly principal: ScriptExecutionPrincipal;
	readonly population?: AutomationPopulationContext;
	readonly occurredAt: LifecycleCommand["occurredAt"];
	readonly source: Exclude<AutomationSource, "automation">;
}): DomainLifecycleCommand & { readonly writeContext: ScriptExecutionPrincipal } => {
	const { subject } = input.principal;
	const population = input.population === undefined ? {} : { population: input.population };
	if (subject.type === "automation-run") {
		return {
			...population,
			occurredAt: input.occurredAt,
			writeContext: input.principal,
			itemIdentity: input.itemIdentity,
			accountUserId: subject.accountUserId,
			causation: automationLifecycleCausation(subject, input.executionId),
		};
	}
	const user = subject.type === "user" ? subject : null;
	const integrationId = user?.integrationId ?? input.integrationId;
	const source = user?.integrationId === undefined ? input.source : "integration";
	return {
		...population,
		...rootLifecycleCommand({
			...lifecycleActor(user),
			source,
			lane: input.lane,
			occurredAt: input.occurredAt,
			executionId: input.executionId,
			itemIdentity: input.itemIdentity,
			...(integrationId === undefined ? {} : { integrationId }),
			...(input.importRunId === undefined ? {} : { importRunId: input.importRunId }),
			...(source === "provider-refresh" ? { providerExecutionId: input.executionId } : {}),
		}),
		writeContext: input.principal,
	};
};

const decodeTriggerKind = Schema.decodeUnknownEffect(AutomationTriggerKind);

export const lifecycleTrigger = Effect.fnUntraced(function* (
	command: LifecycleCommand,
	scopeUserId: null | UserId,
	payload: AutomationTriggerPayload,
	discriminator?: string,
): Effect.fn.Return<AutomationTrigger> {
	const kind = yield* decodeTriggerKind({
		category: payload.category,
		resource: payload.resource,
		operation: payload.operation,
	}).pipe(Effect.orDie);

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
			itemIdentity: command.itemIdentity,
			executionId: command.causation.executionId,
			discriminator: discriminator ?? "lifecycle",
		}),
	};
});
