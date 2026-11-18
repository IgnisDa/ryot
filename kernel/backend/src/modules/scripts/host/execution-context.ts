import {
	type AutomationSource,
	type AutomationWarning,
	type ExecutionLane,
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
				accountUserId: subject.accountUserId,
				...("population" in automation.payload && automation.payload.population !== undefined
					? { population: automation.payload.population }
					: {}),
				causation: automationLifecycleCausation(
					subject,
					AutomationExecutionId.make(`${subject.runId}-host-${input.hostCallDiscriminator}`),
				),
			}).pipe(
				Effect.mapBoth({
					onSuccess: (command) => ({ ...command, writeContext: input.principal }),
					onFailure: () => toSandboxHostError("Invalid automation lifecycle command"),
				}),
			);
		}

		return yield* rootLifecycleCommand({
			source,
			subject,
			itemIdentity,
			lane: input.lane,
			startedAt: input.startedAt,
			principal: input.principal,
			executionId: AutomationExecutionId.make(
				`${input.workflowExecutionId}-host-${input.hostCallDiscriminator}`,
			),
			...(source === "provider-refresh"
				? { providerExecutionId: AutomationExecutionId.make(input.workflowExecutionId) }
				: {}),
		}).pipe(Effect.mapError(() => toSandboxHostError("Invalid root lifecycle command")));
	});

const rootLifecycleCommand = (input: {
	readonly startedAt: string;
	readonly lane: ExecutionLane;
	readonly itemIdentity: string;
	readonly executionId: AutomationExecutionId;
	readonly principal: ScriptRunInput["principal"];
	readonly providerExecutionId?: AutomationExecutionId;
	readonly source: Exclude<AutomationSource, "automation">;
	readonly subject: Exclude<SandboxExecutionSubject, { readonly type: "automation-run" }>;
}) => {
	const integrationId = input.subject.type === "user" ? input.subject.integrationId : undefined;
	const actor = lifecycleActor(input.subject.type === "user" ? input.subject : null);
	return Schema.decodeEffect(LifecycleCommand)({
		occurredAt: input.startedAt,
		itemIdentity: input.itemIdentity,
		accountUserId: actor.accountUserId,
		causation: rootLifecycleCausation({
			lane: input.lane,
			source: input.source,
			initiator: actor.initiator,
			executionId: input.executionId,
			...(integrationId === undefined ? {} : { integrationId }),
			...(input.providerExecutionId === undefined
				? {}
				: { providerExecutionId: input.providerExecutionId }),
		}),
	}).pipe(
		Effect.map((command): DomainLifecycleCommand => ({
			...command,
			writeContext: input.principal,
		})),
	);
};

/** The command an operation's returned changes commit under, attributed as its host writes would be. */
export const operationLifecycleCommand = (input: {
	readonly startedAt: string;
	readonly lane: ExecutionLane;
	readonly executionId: AutomationExecutionId;
	readonly principal: ScriptExecutionPrincipal & {
		readonly subject: Extract<SandboxExecutionSubject, { readonly type: "user" }>;
	};
}) =>
	rootLifecycleCommand({
		...input,
		subject: input.principal.subject,
		itemIdentity: "operation-changes",
		source: input.principal.subject.integrationId ? "integration" : "api",
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
