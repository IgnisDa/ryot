import type {
	AutomationPopulationContext,
	ExecutionLane,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { sandboxSubjectUserId } from "@ryot-app/contract/modules/scripts/schemas";
import type { AutomationExecutionId } from "@ryot-app/contract/schema/brands";
import { Clock, DateTime, Effect } from "effect";

import { principalLifecycleCommand } from "#modules/automations/lifecycle/command";
import type {
	ScriptRunInput,
	UserSandboxRunInput,
} from "#modules/scripts/authorization/capabilities";
import {
	isUserBootstrapPrincipal,
	type ScriptExecutionPrincipal,
} from "#modules/scripts/authorization/principal";

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

const changesSource = (principal: ScriptExecutionPrincipal) => {
	if (principal.subject.type !== "user") {
		return "provider-refresh" as const;
	}
	return isUserBootstrapPrincipal(principal) ? ("bootstrap" as const) : ("api" as const);
};

/** The command a script's returned changes commit under, from the durable identity of its execution. */
export const scriptChangesCommand = (input: {
	readonly occurredAt: string;
	readonly lane: ExecutionLane;
	readonly executionId: AutomationExecutionId;
	readonly principal: ScriptExecutionPrincipal;
	readonly population?: AutomationPopulationContext;
}) =>
	principalLifecycleCommand({
		...input,
		itemIdentity: "script-changes",
		source: changesSource(input.principal),
	});
