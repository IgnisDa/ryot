import { unknownToMessage, type SandboxFailureKind } from "@ryot-app/contract/errors";
import type { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import type { SandboxBoundaryReason } from "@ryot-app/contract/modules/sandbox/boundary-reason";
import type { SandboxExecutionGrants } from "@ryot-app/contract/modules/sandbox/schemas";
import {
	POLICY_SAFE_SANDBOX_CAPABILITIES,
	type SandboxHostCapability,
} from "@ryot-app/contract/modules/sandbox/wire";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { isJsonValue, type JsonValue } from "@ryot-app/contract/schema/json";
import type { SandboxHostImplementationMap as SdkSandboxHostImplementationMap } from "@ryot-app/sandbox-sdk/core";
import type { SandboxHostError } from "@ryot-app/sandbox-sdk/wire";
import type { WorkflowDurableResult, WorkflowInlineRequest } from "@ryot-app/sandbox-sdk/workflow";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { Effect, PlatformError, type Schema } from "effect";

import type { ScriptExecutionPrincipal } from "../protocol/principal";
import {
	sandboxCapabilityRequirement,
	type SANDBOX_CAPABILITY_REQUIREMENTS,
} from "./capability-policy";
import type { SandboxInlineProgress } from "./inline-progress";
import type { SandboxPinnedJournal } from "./pinned-journal";
import type { SandboxShortWait } from "./short-wait";

export type SandboxInlineDurableHost = {
	readonly capabilities: ReadonlyArray<SandboxHostCapability>;
	readonly settle: (
		requests: ReadonlyArray<WorkflowInlineRequest>,
		wait: SandboxShortWait,
		checkpoint: (progress: SandboxInlineProgress) => Effect.Effect<void>,
	) => Effect.Effect<ReadonlyArray<WorkflowDurableResult | null> | null>;
	readonly cancel: (progress: ReadonlyArray<SandboxInlineProgress>) => Effect.Effect<void>;
};

export type SandboxRunInput = {
	readonly lane: ExecutionLane;
	readonly context: unknown;
	readonly startedAt: string;
	readonly executionId: string;
	readonly compiledCode: string;
	readonly compiledFormat: number;
	readonly workflowExecutionId?: string;
	readonly replayJournal?: SandboxPinnedJournal;
	readonly hostCallDiscriminator?: number;
	readonly grants?: SandboxExecutionGrants;
	readonly principal: ScriptExecutionPrincipal;
	readonly inlineDurableHost?: SandboxInlineDurableHost;
};

export type BoundHostFunction = (
	args: ReadonlyArray<unknown>,
) => Effect.Effect<unknown, Schema.SchemaError | SandboxHostError>;

export type UserSandboxRunInput<Input extends SandboxRunInput = SandboxRunInput> = Input & {
	readonly principal: Input["principal"] & {
		readonly subject:
			| Extract<ScriptExecutionPrincipal["subject"], { readonly type: "user" }>
			| (Extract<ScriptExecutionPrincipal["subject"], { readonly type: "automation-run" }> & {
					readonly executionUserId: UserId;
			  });
	};
};

type DirectUserSandboxRunInput<Input extends SandboxRunInput = SandboxRunInput> = Input & {
	readonly principal: Input["principal"] & {
		readonly subject: Extract<ScriptExecutionPrincipal["subject"], { readonly type: "user" }>;
	};
};

type SystemSandboxRunInput<Input extends SandboxRunInput = SandboxRunInput> = Input & {
	readonly principal: Input["principal"] & {
		readonly subject:
			| Extract<ScriptExecutionPrincipal["subject"], { readonly type: "system" }>
			| (Extract<ScriptExecutionPrincipal["subject"], { readonly type: "automation-run" }> & {
					readonly executionUserId: null;
			  });
	};
};

type SystemProviderSandboxRunInput<Input extends SandboxRunInput = SandboxRunInput> =
	SystemSandboxRunInput<Input> & {
		readonly principal: Input["principal"] & {
			readonly providerId: NonNullable<ScriptExecutionPrincipal["providerId"]>;
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
	| "getPersistentValue"
>;

export const toSandboxHostError = (error: unknown): SandboxHostError => {
	if (
		isObjectRecord(error) &&
		isObjectRecord(error["reason"]) &&
		typeof error["reason"]["code"] === "string" &&
		isJsonValue(error["reason"])
	) {
		return {
			data: error["reason"],
			message:
				typeof error["message"] === "string" && error["message"].length > 0
					? error["message"]
					: error["reason"]["code"],
		};
	}
	if (isObjectRecord(error) && typeof error["message"] === "string") {
		return { ...error, message: error["message"] };
	}
	return { message: unknownToMessage(error) };
};

export const sandboxHostFailure = (
	message: string,
	data?: SandboxBoundaryReason,
): Effect.Effect<never, SandboxHostError> =>
	Effect.fail(
		data === undefined ? toSandboxHostError(message) : { message, data: toSandboxJsonValue(data) },
	);

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

type AutomationRunSandboxRunInput<Input extends SandboxRunInput = SandboxRunInput> = Input & {
	readonly principal: Input["principal"] & {
		readonly subject: Extract<
			ScriptExecutionPrincipal["subject"],
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

type SandboxRunInputForCapability<
	Capability extends SandboxHostCapability,
	Input extends SandboxRunInput = SandboxRunInput,
> = (typeof SANDBOX_CAPABILITY_REQUIREMENTS)[Capability] extends { readonly requiresProvider: true }
	? SystemProviderSandboxRunInput<Input>
	: "system" extends CapabilitySubject<Capability>
		? SandboxRunInputForSubject<Input, CapabilitySubject<Capability>>
		: SandboxRunInputForSubject<Input, CapabilitySubject<Capability>> & UserSandboxRunInput<Input>;

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
			!requirement.systemKinds.some((kind) => kind === input.principal.metadata.kind)
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
		requirement.requiresUserBootstrap &&
		!input.principal.pluginRevision?.userBootstrapScriptSlugs.includes(input.principal.scriptSlug)
	) {
		return `${capability} is available only to pinned user bootstrap scripts`;
	}
	return undefined;
};

const isSandboxCapabilityInput = <
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
			{ operation: capability, code: "unavailable-operation" },
		);
	}
	return Effect.succeed(input);
};
