import {
	type AutomationPopulationContext,
	type ExecutionLane,
	LifecycleCommand,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { sandboxSubjectUserId } from "@ryot-app/contract/modules/scripts/schemas";
import type { AutomationExecutionId } from "@ryot-app/contract/schema/brands";
import { Clock, DateTime, Effect, Schema } from "effect";

import {
	automationLifecycleCausation,
	lifecycleActor,
	rootLifecycleCausation,
} from "#modules/automations/lifecycle/command";
import type { DomainLifecycleCommand } from "#modules/entities/write-context";
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

const changesSource = (
	principal: ScriptExecutionPrincipal,
	user: null | { readonly integrationId?: unknown },
) => {
	if (user === null) {
		return "provider-refresh" as const;
	}
	if (isUserBootstrapPrincipal(principal)) {
		return "bootstrap" as const;
	}
	return user.integrationId === undefined ? ("api" as const) : ("integration" as const);
};

/**
 * The command a script's returned changes commit under. An automation run's changes descend from
 * its trigger, keeping its root budget; every other script's changes start a root causation. Every
 * ID the commit derives comes from `executionId`, the durable identity of the script's execution.
 */
export const scriptChangesCommand = Effect.fn("scriptChangesCommand")(function* (input: {
	readonly occurredAt: string;
	readonly lane: ExecutionLane;
	readonly executionId: AutomationExecutionId;
	readonly principal: ScriptExecutionPrincipal;
	readonly population?: AutomationPopulationContext;
}) {
	const { subject } = input.principal;
	const command = {
		occurredAt: input.occurredAt,
		itemIdentity: "script-changes",
		...(input.population === undefined ? {} : { population: input.population }),
	};
	if (subject.type === "automation-run") {
		const decoded = yield* Schema.decodeEffect(LifecycleCommand)({
			...command,
			accountUserId: subject.accountUserId,
			causation: automationLifecycleCausation(subject, input.executionId),
		});
		return { ...decoded, writeContext: input.principal } satisfies DomainLifecycleCommand;
	}
	const user = subject.type === "user" ? subject : null;
	const actor = lifecycleActor(user);
	const source = changesSource(input.principal, user);
	const decoded = yield* Schema.decodeEffect(LifecycleCommand)({
		...command,
		accountUserId: actor.accountUserId,
		causation: rootLifecycleCausation({
			source,
			lane: input.lane,
			initiator: actor.initiator,
			executionId: input.executionId,
			...(user?.integrationId === undefined ? {} : { integrationId: user.integrationId }),
			...(source === "provider-refresh" ? { providerExecutionId: input.executionId } : {}),
		}),
	});
	return { ...decoded, writeContext: input.principal } satisfies DomainLifecycleCommand;
});
