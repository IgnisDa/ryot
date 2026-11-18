import {
	type ExecutionLane,
	LifecycleCommand,
} from "@ryot-app/contract/modules/automations/lifecycle";
import {
	type SandboxExecutionSubject,
	sandboxSubjectUserId,
} from "@ryot-app/contract/modules/scripts/schemas";
import type { AutomationExecutionId } from "@ryot-app/contract/schema/brands";
import { Clock, DateTime, Effect, Schema } from "effect";

import { lifecycleActor, rootLifecycleCausation } from "#modules/automations/lifecycle/command";
import type { DomainLifecycleCommand } from "#modules/entities/write-context";
import type {
	ScriptRunInput,
	UserSandboxRunInput,
} from "#modules/scripts/authorization/capabilities";
import type { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";

export const sandboxStartedAt = Effect.map(Clock.currentTimeMillis, (millis) =>
	DateTime.formatIso(DateTime.makeUnsafe(millis)),
);

export const sandboxRunUserId = (input: ScriptRunInput) =>
	sandboxSubjectUserId(input.principal.subject);

export const sandboxDefinitionReadContext = (input: ScriptRunInput) =>
	input.principal.pluginRevision === null
		? undefined
		: {
				pluginId: input.principal.pluginRevision.id,
				pluginRevisionId: input.principal.pluginRevision.revisionId,
			};

export const sandboxRunIntegrationId = (input: UserSandboxRunInput) => {
	if (input.principal.subject.type === "user") {
		return input.principal.subject.integrationId ?? null;
	}
	if (input.principal.subject.type === "projection") {
		return null;
	}
	return input.principal.subject.causation.integrationId ?? null;
};

export const userSandboxRunUserId = (input: UserSandboxRunInput) =>
	input.principal.subject.type === "automation-run"
		? input.principal.subject.executionUserId
		: input.principal.subject.userId;

/** The command an operation's returned changes commit under. */
export const operationLifecycleCommand = Effect.fn("operationLifecycleCommand")(function* (input: {
	readonly startedAt: string;
	readonly lane: ExecutionLane;
	readonly executionId: AutomationExecutionId;
	readonly principal: ScriptExecutionPrincipal & {
		readonly subject: Extract<SandboxExecutionSubject, { readonly type: "user" }>;
	};
}) {
	const { subject } = input.principal;
	const actor = lifecycleActor(subject);
	const command = yield* Schema.decodeEffect(LifecycleCommand)({
		occurredAt: input.startedAt,
		itemIdentity: "operation-changes",
		accountUserId: actor.accountUserId,
		causation: rootLifecycleCausation({
			lane: input.lane,
			initiator: actor.initiator,
			executionId: input.executionId,
			source: subject.integrationId ? "integration" : "api",
			...(subject.integrationId === undefined ? {} : { integrationId: subject.integrationId }),
		}),
	});
	return { ...command, writeContext: input.principal } satisfies DomainLifecycleCommand;
});
