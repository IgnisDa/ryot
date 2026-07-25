import { unknownToMessage } from "@ryot/contract/errors";
import type {
	ExecutionAuthority,
	SandboxExecutionGrants,
} from "@ryot/contract/modules/sandbox/schemas";
import type { SandboxProviderId } from "@ryot/contract/schema/brands";
import {
	SANDBOX_CAPABILITY_REQUIREMENTS,
	type SandboxCapabilityRequirement,
	type SandboxHostCapability,
	type SandboxHostImplementationMap as SdkSandboxHostImplementationMap,
} from "@ryot/sandbox-sdk/core";
import type { JsonValue, SandboxHostError } from "@ryot/sandbox-sdk/wire";
import { isObjectRecord } from "@ryot/ts-utils/predicates";
import { Effect } from "effect";

export type SandboxRunInput = {
	readonly context: unknown;
	readonly scriptId: string;
	readonly metadata: unknown;
	readonly startedAt?: string;
	readonly executionId: string;
	readonly contentHash: string;
	readonly compiledCode: string;
	readonly compiledFormat: number;
	readonly workflowExecutionId?: string;
	readonly authority: ExecutionAuthority;
	readonly grants?: SandboxExecutionGrants;
	readonly providerId: SandboxProviderId | null;
	readonly allowedHostFunctions: readonly string[];
};

export type BoundHostFunction = (args: ReadonlyArray<unknown>) => Effect.Effect<unknown, unknown>;

export type UserSandboxRunInput<Input extends SandboxRunInput = SandboxRunInput> = Input & {
	readonly authority: Extract<ExecutionAuthority, { readonly userId: string }>;
};

export type DirectUserSandboxRunInput<Input extends SandboxRunInput = SandboxRunInput> = Input & {
	readonly authority: Extract<ExecutionAuthority, { readonly type: "user" }>;
};

export type SystemSandboxRunInput<Input extends SandboxRunInput = SandboxRunInput> = Input & {
	readonly authority: Extract<ExecutionAuthority, { readonly type: "system" }>;
};

export type SystemProviderSandboxRunInput<Input extends SandboxRunInput = SandboxRunInput> =
	SystemSandboxRunInput<Input> & { readonly providerId: SandboxProviderId };

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

export const toSandboxHostError = (error: unknown): SandboxHostError =>
	isObjectRecord(error) && typeof error["message"] === "string"
		? { ...error, message: error["message"] }
		: { message: unknownToMessage(error) };

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
	"userId" in input.authority ? input.authority.userId : null;

// A subscription execution already carries its integration in the trusted automation origin, so it
// is read from there rather than duplicated onto the authority and risking the two disagreeing.
export const sandboxRunIntegrationId = (input: UserSandboxRunInput) => {
	if (input.authority.type !== "subscription") {
		return input.authority.integrationId ?? null;
	}
	const origin = input.authority.subscriptionRun.origin;
	return origin.kind === "integration" ? origin.integrationId : null;
};

export type SubscriptionSandboxRunInput<Input extends SandboxRunInput = SandboxRunInput> = Input & {
	readonly authority: Extract<ExecutionAuthority, { readonly type: "subscription" }>;
};

type CapabilityAuthority<Capability extends SandboxHostCapability> =
	(typeof SANDBOX_CAPABILITY_REQUIREMENTS)[Capability]["authorities"][number];

type SandboxRunInputForAuthority<
	Input extends SandboxRunInput,
	Authority,
> = Authority extends "user"
	? DirectUserSandboxRunInput<Input>
	: Authority extends "subscription"
		? SubscriptionSandboxRunInput<Input>
		: Authority extends "system"
			? SystemSandboxRunInput<Input>
			: never;

const sandboxCapabilityRequirement = (
	capability: SandboxHostCapability,
): SandboxCapabilityRequirement => SANDBOX_CAPABILITY_REQUIREMENTS[capability];

export type SandboxRunInputForCapability<
	Capability extends SandboxHostCapability,
	Input extends SandboxRunInput = SandboxRunInput,
> = (typeof SANDBOX_CAPABILITY_REQUIREMENTS)[Capability] extends {
	readonly requiresProvider: true;
}
	? SystemProviderSandboxRunInput<Input>
	: SandboxRunInputForAuthority<Input, CapabilityAuthority<Capability>>;

export const sandboxMetadataKind = (metadata: unknown) =>
	typeof metadata === "object" &&
	metadata !== null &&
	"kind" in metadata &&
	typeof metadata.kind === "string"
		? metadata.kind
		: undefined;

const sandboxCapabilityError = (input: SandboxRunInput, capability: SandboxHostCapability) => {
	const requirement = sandboxCapabilityRequirement(capability);
	if (input.authority.type === "system") {
		if (!requirement.authorities.includes("system")) {
			if (requirement.authorities.length === 1 && requirement.authorities[0] === "subscription") {
				return `${capability} is available only to subscription executions`;
			}
			return `${capability} is not available for system executions`;
		}
		if (
			requirement.systemKinds &&
			!requirement.systemKinds.some((kind) => kind === sandboxMetadataKind(input.metadata))
		) {
			return `${capability} is not available to this system execution`;
		}
	} else if (!requirement.authorities.includes(input.authority.type)) {
		if (requirement.authorities.length === 1 && requirement.authorities[0] === "subscription") {
			return `${capability} is available only to subscription executions`;
		}
		if (requirement.authorities.length === 1 && requirement.authorities[0] === "user") {
			return `${capability} is available only to user executions`;
		}
		return `${capability} is not available to this execution`;
	}
	if (requirement.requiresProvider && input.providerId === null) {
		return `${capability} is available only to provider-associated scripts`;
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
