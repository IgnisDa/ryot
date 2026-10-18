import {
	type AutomationSource,
	type AutomationWarning,
	LifecycleCommand,
} from "@ryot-app/contract/modules/automations/lifecycle";
import {
	SandboxExecutionSubject,
	sandboxSubjectUserId,
} from "@ryot-app/contract/modules/scripts/schemas";
import type { SandboxHostCapability } from "@ryot-app/contract/modules/scripts/wire";
import { AutomationExecutionId } from "@ryot-app/contract/schema/brands";
import { automationInputSchema } from "@ryot-app/plugin-backend-sdk/automation";
import type { SandboxHostError } from "@ryot-app/plugin-backend-sdk/wire";
import { sandboxHostFailure, toSandboxHostError } from "@ryot-app/sandbox/host/invocation";
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
	if (input.principal.subject.type === "event-projection") {
		return null;
	}
	return input.principal.subject.causation.integrationId ?? null;
};

export const userSandboxRunUserId = (input: UserSandboxRunInput) =>
	input.principal.subject.type === "automation-run"
		? input.principal.subject.executionUserId
		: input.principal.subject.userId;

const decodeAutomationInput = Schema.decodeUnknownEffect(automationInputSchema);

export const sandboxLifecycleCommand = (
	input: ScriptRunInput,
	source: Exclude<AutomationSource, "automation">,
	itemIdentity: string,
): Effect.Effect<DomainLifecycleCommand, SandboxHostError> =>
	Effect.gen(function* () {
		if (input.hostCallDiscriminator === undefined || input.workflowExecutionId === undefined) {
			return yield* sandboxHostFailure("Lifecycle writes require a trusted durable host call");
		}
		const subject = yield* Schema.decodeEffect(SandboxExecutionSubject)(
			input.principal.subject,
		).pipe(Effect.mapError(() => toSandboxHostError("Invalid lifecycle execution subject")));
		if (subject.type === "automation-run") {
			const { automation } = yield* decodeAutomationInput(input.context).pipe(
				Effect.mapError(() =>
					toSandboxHostError("Lifecycle writes require a trusted automation context"),
				),
			);
			if (
				automation.runId !== subject.runId ||
				automation.triggerId !== subject.triggerId ||
				automation.executionUserId !== subject.executionUserId
			) {
				return yield* sandboxHostFailure("Lifecycle automation context does not match its subject");
			}
			return yield* Schema.decodeEffect(LifecycleCommand)({
				itemIdentity,
				occurredAt: automation.occurredAt,
				accountGeneration: subject.accountGeneration,
				...("population" in automation.payload && automation.payload.population !== undefined
					? { population: automation.payload.population }
					: {}),
				causation: automationLifecycleCausation(
					subject,
					AutomationExecutionId.make(`${subject.runId}-host-${input.hostCallDiscriminator}`),
				),
			}).pipe(
				Effect.mapError(() => toSandboxHostError("Invalid automation lifecycle command")),
				Effect.map((command) => ({ ...command, writeContext: input.principal })),
			);
		}

		const executionId = AutomationExecutionId.make(
			`${input.workflowExecutionId}-host-${input.hostCallDiscriminator}`,
		);
		const integrationId = subject.type === "user" ? subject.integrationId : undefined;
		const actor = lifecycleActor(subject.type === "user" ? subject : null);
		return yield* Schema.decodeEffect(LifecycleCommand)({
			itemIdentity,
			occurredAt: input.startedAt,
			accountGeneration: actor.accountGeneration,
			causation: rootLifecycleCausation({
				source,
				executionId,
				lane: input.lane,
				initiator: actor.initiator,
				...(integrationId === undefined ? {} : { integrationId }),
				...(source === "provider-refresh"
					? { providerExecutionId: AutomationExecutionId.make(input.workflowExecutionId) }
					: {}),
			}),
		}).pipe(
			Effect.mapError(() => toSandboxHostError("Invalid root lifecycle command")),
			Effect.map((command) => ({ ...command, writeContext: input.principal })),
		);
	});

export const reportSandboxLifecycleWarnings = (
	capability: SandboxHostCapability,
	warnings: ReadonlyArray<AutomationWarning>,
) =>
	warnings.length === 0
		? Effect.void
		: Effect.logWarning("Sandbox lifecycle write completed with automation warnings").pipe(
				Effect.annotateLogs({ capability, warnings: JSON.stringify(warnings) }),
			);
