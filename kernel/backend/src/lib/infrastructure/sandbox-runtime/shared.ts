import { unknownToMessage, type SandboxFailureKind } from "@ryot-app/contract/errors";
import type {
	AutomationSource,
	AutomationWarning,
} from "@ryot-app/contract/modules/automations/lifecycle";
import type { SandboxExecutionGrants } from "@ryot-app/contract/modules/sandbox/schemas";
import type { SandboxHostCapability } from "@ryot-app/contract/modules/sandbox/wire";
import { POLICY_SAFE_SANDBOX_CAPABILITIES } from "@ryot-app/contract/modules/sandbox/wire";
import { AutomationExecutionId, type UserId } from "@ryot-app/contract/schema/brands";
import { isJsonValue, type JsonValue } from "@ryot-app/contract/schema/json";
import { automationInputSchema } from "@ryot-app/sandbox-sdk/automation";
import type { SandboxHostImplementationMap as SdkSandboxHostImplementationMap } from "@ryot-app/sandbox-sdk/core";
import type { SandboxHostError } from "@ryot-app/sandbox-sdk/wire";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { Effect, PlatformError, Schema } from "effect";

import { LifecycleCommand } from "#lib/domain/lifecycle-command";

import type { SANDBOX_CAPABILITY_REQUIREMENTS } from "./capability-policy";
import { sandboxCapabilityRequirement } from "./capability-policy";
import type { SandboxExecutionPrincipal } from "./execution-principal";

export { isJsonValue } from "@ryot-app/contract/schema/json";

export type SandboxRunInput = {
	readonly context: unknown;
	readonly startedAt?: string;
	readonly executionId: string;
	readonly compiledCode: string;
	readonly compiledFormat: number;
	readonly workflowExecutionId?: string;
	readonly hostCallDiscriminator?: number;
	readonly grants?: SandboxExecutionGrants;
	readonly principal: SandboxExecutionPrincipal;
};

export type BoundHostFunction = (args: ReadonlyArray<unknown>) => Effect.Effect<unknown, unknown>;

export type UserSandboxRunInput<Input extends SandboxRunInput = SandboxRunInput> = Input & {
	readonly principal: Input["principal"] & {
		readonly subject:
			| Extract<SandboxExecutionPrincipal["subject"], { readonly type: "user" }>
			| (Extract<SandboxExecutionPrincipal["subject"], { readonly type: "automation-run" }> & {
					readonly executionUserId: UserId;
			  });
	};
};

export type DirectUserSandboxRunInput<Input extends SandboxRunInput = SandboxRunInput> = Input & {
	readonly principal: Input["principal"] & {
		readonly subject: Extract<SandboxExecutionPrincipal["subject"], { readonly type: "user" }>;
	};
};

export type SystemSandboxRunInput<Input extends SandboxRunInput = SandboxRunInput> = Input & {
	readonly principal: Input["principal"] & {
		readonly subject:
			| Extract<SandboxExecutionPrincipal["subject"], { readonly type: "system" }>
			| (Extract<SandboxExecutionPrincipal["subject"], { readonly type: "automation-run" }> & {
					readonly executionUserId: null;
			  });
	};
};

export type SystemProviderSandboxRunInput<Input extends SandboxRunInput = SandboxRunInput> =
	SystemSandboxRunInput<Input> & {
		readonly principal: Input["principal"] & {
			readonly providerId: NonNullable<SandboxExecutionPrincipal["providerId"]>;
		};
	};

export type SandboxHostImplementationMap = SdkSandboxHostImplementationMap<SandboxRunInput>;

export type AdditionalSandboxHostImplementationMap = Omit<
	SandboxHostImplementationMap,
	| "log"
	| "span"
	| "httpCall"
	| "emitSignal"
	| "setCachedValue"
	| "getCachedValue"
	| "sendNotification"
	| "claimPersistentValue"
>;

export const toSandboxHostError = (error: unknown): SandboxHostError => {
	if (
		isObjectRecord(error) &&
		isObjectRecord(error["reason"]) &&
		typeof error["reason"]["code"] === "string" &&
		isJsonValue(error["reason"])
	) {
		return { data: error["reason"], message: error["reason"]["code"] };
	}
	if (isObjectRecord(error) && typeof error["message"] === "string") {
		return { ...error, message: error["message"] };
	}
	return { message: unknownToMessage(error) };
};

export const sandboxHostFailure = (message: string) => Effect.fail(toSandboxHostError(message));

const EXHAUSTED_RESOURCE_CODES = new Set(["EAGAIN", "EMFILE", "ENFILE", "ENOMEM"]);

export const sandboxPlatformFailureKind = (error: unknown): SandboxFailureKind => {
	if (
		!(error instanceof PlatformError.PlatformError) ||
		!(error.reason instanceof PlatformError.SystemError)
	) {
		return "infrastructure";
	}
	if (error.reason._tag === "Busy" || error.reason._tag === "WouldBlock") {
		return "resource-unavailable";
	}
	const cause = error.reason.cause;
	const code = isObjectRecord(cause) ? cause["code"] : undefined;
	return typeof code === "string" && EXHAUSTED_RESOURCE_CODES.has(code)
		? "resource-unavailable"
		: "infrastructure";
};

export const sandboxHostEffect = <A, E>(effect: Effect.Effect<A, E>) =>
	effect.pipe(Effect.mapError(toSandboxHostError));

export const toSandboxJsonValue = (value: unknown): JsonValue =>
	isJsonValue(value) ? value : null;

export const sandboxRunUserId = (input: SandboxRunInput) => {
	const subject = input.principal.subject;
	if (subject.type === "automation-run") {
		return subject.executionUserId;
	}
	return subject.type === "user" ? subject.userId : null;
};

export const sandboxRunIntegrationId = (input: UserSandboxRunInput) => {
	if (input.principal.subject.type === "user") {
		return input.principal.subject.integrationId ?? null;
	}
	return input.principal.subject.causation.integrationId ?? null;
};

export const userSandboxRunUserId = (input: UserSandboxRunInput) =>
	input.principal.subject.type === "user"
		? input.principal.subject.userId
		: input.principal.subject.executionUserId;

const decodeAutomationInput = Schema.decodeUnknownEffect(automationInputSchema);

export const sandboxLifecycleCommand = (
	input: SandboxRunInput,
	source: Exclude<AutomationSource, "automation">,
	itemIdentity: string,
): Effect.Effect<LifecycleCommand, SandboxHostError> =>
	Effect.gen(function* () {
		if (input.hostCallDiscriminator === undefined || input.workflowExecutionId === undefined) {
			return yield* sandboxHostFailure("Lifecycle writes require a trusted durable host call");
		}
		const subject = input.principal.subject;
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
				...("population" in automation.payload && automation.payload.population !== undefined
					? { population: automation.payload.population }
					: {}),
				causation: {
					...subject.causation,
					source: "automation",
					parentRunId: subject.runId,
					depth: subject.causation.depth + 1,
					parentTriggerId: subject.triggerId,
					executionId: AutomationExecutionId.make(
						`${subject.runId}-host-${input.hostCallDiscriminator}`,
					),
				},
			}).pipe(Effect.mapError(() => toSandboxHostError("Invalid automation lifecycle command")));
		}

		const executionId = AutomationExecutionId.make(
			`${input.workflowExecutionId}-host-${input.hostCallDiscriminator}`,
		);
		const integrationId = subject.type === "user" ? subject.integrationId : undefined;
		let initiator: LifecycleCommand["causation"]["initiator"] = { id: null, kind: "system" };
		if (subject.type === "user") {
			initiator =
				integrationId === undefined
					? { kind: "user", id: subject.userId }
					: { id: integrationId, kind: "integration" };
		}
		return yield* Schema.decodeUnknownEffect(LifecycleCommand)({
			itemIdentity,
			occurredAt: input.startedAt,
			causation: {
				source,
				depth: 0,
				initiator,
				executionId,
				parentRunId: null,
				parentTriggerId: null,
				rootExecutionId: executionId,
				...(integrationId === undefined ? {} : { integrationId }),
				...(source === "provider-refresh"
					? { providerExecutionId: AutomationExecutionId.make(input.workflowExecutionId) }
					: {}),
			},
		}).pipe(Effect.mapError(() => toSandboxHostError("Invalid root lifecycle command")));
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

export type AutomationRunSandboxRunInput<Input extends SandboxRunInput = SandboxRunInput> =
	Input & {
		readonly principal: Input["principal"] & {
			readonly subject: Extract<
				SandboxExecutionPrincipal["subject"],
				{ readonly type: "automation-run" }
			>;
		};
	};

type CapabilitySubject<Capability extends SandboxHostCapability> =
	(typeof SANDBOX_CAPABILITY_REQUIREMENTS)[Capability]["subjects"][number];

type SandboxRunInputForSubject<Input extends SandboxRunInput, Subject> = Subject extends "user"
	? DirectUserSandboxRunInput<Input>
	: Subject extends "automation-run"
		? AutomationRunSandboxRunInput<Input>
		: Subject extends "system"
			? SystemSandboxRunInput<Input>
			: never;

export type SandboxRunInputForCapability<
	Capability extends SandboxHostCapability,
	Input extends SandboxRunInput = SandboxRunInput,
> = (typeof SANDBOX_CAPABILITY_REQUIREMENTS)[Capability] extends { readonly requiresProvider: true }
	? SystemProviderSandboxRunInput<Input>
	: "system" extends CapabilitySubject<Capability>
		? SandboxRunInputForSubject<Input, CapabilitySubject<Capability>>
		: SandboxRunInputForSubject<Input, CapabilitySubject<Capability>> & UserSandboxRunInput<Input>;

export const sandboxMetadataKind = (metadata: unknown) =>
	typeof metadata === "object" &&
	metadata !== null &&
	"kind" in metadata &&
	typeof metadata.kind === "string"
		? metadata.kind
		: undefined;

const sandboxCapabilityError = (
	input: Pick<SandboxRunInput, "principal">,
	capability: SandboxHostCapability,
) => {
	const requirement = sandboxCapabilityRequirement(capability);
	const subject = input.principal.subject;
	if (!input.principal.metadata.capabilities?.includes(capability)) {
		return `${capability} is not declared by this script`;
	}
	if (
		subject.type === "automation-run" &&
		subject.stage === "before" &&
		!POLICY_SAFE_SANDBOX_CAPABILITIES.some((safe) => safe === capability)
	) {
		return `${capability} is not available to before-stage automation runs`;
	}
	const system =
		subject.type === "system" ||
		(subject.type === "automation-run" && subject.executionUserId === null);
	if (system) {
		if (!requirement.subjects.includes("system")) {
			if (capability === "sendNotification") {
				return `${capability} is available only to user automation runs`;
			}
			return `${capability} is not available for system executions`;
		}
		if (
			requirement.systemKinds &&
			!requirement.systemKinds.some(
				(kind) => kind === sandboxMetadataKind(input.principal.metadata),
			)
		) {
			return `${capability} is not available to this system execution`;
		}
	} else if (!requirement.subjects.includes(input.principal.subject.type)) {
		if (requirement.subjects.length === 1 && requirement.subjects[0] === "automation-run") {
			return `${capability} is available only to user automation runs`;
		}
		if (requirement.subjects.length === 1 && requirement.subjects[0] === "user") {
			return `${capability} is available only to user executions`;
		}
		return `${capability} is not available to this execution`;
	}
	if (requirement.requiresProvider && input.principal.providerId === null) {
		return `${capability} is available only to provider-associated scripts`;
	}
	if (
		system &&
		requirement.requiresSystemPlugin &&
		input.principal.pluginRevision?.scope !== "system"
	) {
		return `${capability} system access requires a pinned system plugin script`;
	}
	if (
		requirement.requiresSystemUserBootstrap &&
		!input.principal.pluginRevision?.userBootstrapScriptSlugs.includes(input.principal.scriptSlug)
	) {
		return `${capability} is available only to pinned system user bootstrap scripts`;
	}
	return undefined;
};

export const isSandboxCapabilityInput = <
	Capability extends SandboxHostCapability,
	Input extends SandboxRunInput,
>(
	input: Input,
	capability: Capability,
): input is SandboxRunInputForCapability<Capability, Input> =>
	sandboxCapabilityError(input, capability) === undefined;

export const isSandboxCapabilityAllowed = (
	input: Pick<SandboxRunInput, "principal">,
	capability: SandboxHostCapability,
) => sandboxCapabilityError(input, capability) === undefined;

export const requireSandboxCapabilityInput = <
	Capability extends SandboxHostCapability,
	Input extends SandboxRunInput,
>(
	input: Input,
	capability: Capability,
): Effect.Effect<SandboxRunInputForCapability<Capability, Input>, SandboxHostError> => {
	if (!isSandboxCapabilityInput(input, capability)) {
		return sandboxHostFailure(
			sandboxCapabilityError(input, capability) ??
				`${capability} is not available to this execution`,
		);
	}
	return Effect.succeed(input);
};
