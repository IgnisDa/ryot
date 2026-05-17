import { unknownToMessage } from "@ryot/contract/errors";
import type { JsonValue } from "@ryot/contract/modules/ryotql/language";
import type { SandboxExecutionGrants } from "@ryot/contract/modules/sandbox/schemas";
import type { SandboxHostCapability } from "@ryot/contract/modules/sandbox/wire";
import type { SandboxHostImplementationMap as SdkSandboxHostImplementationMap } from "@ryot/sandbox-sdk/core";
import type { SandboxHostError } from "@ryot/sandbox-sdk/wire";
import { isObjectRecord } from "@ryot/ts-utils/predicates";
import { Effect } from "effect";

import type { SANDBOX_CAPABILITY_REQUIREMENTS } from "./capability-policy";
import { sandboxCapabilityRequirement } from "./capability-policy";
import type { SandboxExecutionPrincipal } from "./execution-principal";

export type SandboxRunInput = {
	readonly context: unknown;
	readonly startedAt?: string;
	readonly executionId: string;
	readonly compiledCode: string;
	readonly compiledFormat: number;
	readonly workflowExecutionId?: string;
	readonly grants?: SandboxExecutionGrants;
	readonly principal: SandboxExecutionPrincipal;
};

export type BoundHostFunction = (args: ReadonlyArray<unknown>) => Effect.Effect<unknown, unknown>;

export type UserSandboxRunInput<Input extends SandboxRunInput = SandboxRunInput> = Input & {
	readonly principal: Input["principal"] & {
		readonly subject: Extract<SandboxExecutionPrincipal["subject"], { readonly userId: string }>;
	};
};

export type DirectUserSandboxRunInput<Input extends SandboxRunInput = SandboxRunInput> = Input & {
	readonly principal: Input["principal"] & {
		readonly subject: Extract<SandboxExecutionPrincipal["subject"], { readonly type: "user" }>;
	};
};

export type SystemSandboxRunInput<Input extends SandboxRunInput = SandboxRunInput> = Input & {
	readonly principal: Input["principal"] & {
		readonly subject: Extract<SandboxExecutionPrincipal["subject"], { readonly type: "system" }>;
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
		return { message: error["reason"]["code"], data: error["reason"] };
	}
	if (isObjectRecord(error) && typeof error["message"] === "string") {
		return { ...error, message: error["message"] };
	}
	return { message: unknownToMessage(error) };
};

export const sandboxHostFailure = (message: string) => Effect.fail(toSandboxHostError(message));

export const sandboxHostEffect = <A, E>(effect: Effect.Effect<A, E>) =>
	effect.pipe(Effect.mapError(toSandboxHostError));

export const isJsonValue = (value: unknown): value is JsonValue => {
	if (
		value === null ||
		typeof value === "boolean" ||
		typeof value === "string" ||
		(typeof value === "number" && Number.isFinite(value))
	) {
		return true;
	}

	if (Array.isArray(value)) {
		return value.every(isJsonValue);
	}

	if (!isObjectRecord(value)) {
		return false;
	}
	const prototype = Object.getPrototypeOf(value);
	return (
		(prototype === Object.prototype || prototype === null) &&
		Object.values(value).every(isJsonValue)
	);
};

export const toSandboxJsonValue = (value: unknown): JsonValue =>
	isJsonValue(value) ? value : null;

export const sandboxRunUserId = (input: SandboxRunInput) =>
	"userId" in input.principal.subject ? input.principal.subject.userId : null;

// A subscription execution already carries its integration in the trusted automation origin, so it
// is read from there rather than duplicated onto the subject and risking the two disagreeing.
export const sandboxRunIntegrationId = (input: UserSandboxRunInput) => {
	if (input.principal.subject.type !== "subscription") {
		return input.principal.subject.integrationId ?? null;
	}
	const origin = input.principal.subject.subscriptionRun.origin;
	return origin.kind === "integration" ? origin.integrationId : null;
};

export type SubscriptionSandboxRunInput<Input extends SandboxRunInput = SandboxRunInput> = Input & {
	readonly principal: Input["principal"] & {
		readonly subject: Extract<
			SandboxExecutionPrincipal["subject"],
			{ readonly type: "subscription" }
		>;
	};
};

type CapabilitySubject<Capability extends SandboxHostCapability> =
	(typeof SANDBOX_CAPABILITY_REQUIREMENTS)[Capability]["subjects"][number];

type SandboxRunInputForSubject<Input extends SandboxRunInput, Subject> = Subject extends "user"
	? DirectUserSandboxRunInput<Input>
	: Subject extends "subscription"
		? SubscriptionSandboxRunInput<Input>
		: Subject extends "system"
			? SystemSandboxRunInput<Input>
			: never;

export type SandboxRunInputForCapability<
	Capability extends SandboxHostCapability,
	Input extends SandboxRunInput = SandboxRunInput,
> = (typeof SANDBOX_CAPABILITY_REQUIREMENTS)[Capability] extends {
	readonly requiresProvider: true;
}
	? SystemProviderSandboxRunInput<Input>
	: SandboxRunInputForSubject<Input, CapabilitySubject<Capability>>;

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
	if (input.principal.subject.type === "system") {
		if (!requirement.subjects.includes("system")) {
			if (requirement.subjects.length === 1 && requirement.subjects[0] === "subscription") {
				return `${capability} is available only to subscription executions`;
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
		if (requirement.subjects.length === 1 && requirement.subjects[0] === "subscription") {
			return `${capability} is available only to subscription executions`;
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
		input.principal.subject.type === "system" &&
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
