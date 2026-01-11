import { unknownToMessage } from "@ryot/contract/errors";
import type { ExecutionAuthority } from "@ryot/contract/modules/sandbox/schemas";
import type { SandboxProviderId } from "@ryot/contract/schema/brands";
import type { SandboxHostImplementationMap as SdkSandboxHostImplementationMap } from "@ryot/sandbox-sdk/core";
import type { JsonValue, SandboxHostError } from "@ryot/sandbox-sdk/wire";
import { isObjectRecord } from "@ryot/ts-utils/predicates";
import { Effect } from "effect";

export type SandboxRunInput = {
	readonly context: unknown;
	readonly scriptId: string;
	readonly metadata: unknown;
	readonly executionId: string;
	readonly compiledCode: string;
	readonly cacheNamespace: string;
	readonly compiledFormat: number;
	readonly scriptIsBuiltin: boolean;
	readonly workflowExecutionId?: string;
	readonly authority: ExecutionAuthority;
	readonly providerId: SandboxProviderId | null;
	readonly allowedHostFunctions: readonly string[];
};

export type BoundHostFunction = (args: ReadonlyArray<unknown>) => Effect.Effect<unknown, unknown>;

export type UserSandboxRunInput<Input extends SandboxRunInput = SandboxRunInput> = Input & {
	readonly authority: Extract<ExecutionAuthority, { readonly userId: string }>;
};

export type SystemSandboxRunInput<Input extends SandboxRunInput = SandboxRunInput> = Input & {
	readonly authority: Extract<ExecutionAuthority, { readonly type: "system" }>;
};

export type SystemProviderSandboxRunInput<Input extends SandboxRunInput = SandboxRunInput> =
	SystemSandboxRunInput<Input> & { readonly providerId: SandboxProviderId };

const hasSystemContext = <Input extends SandboxRunInput>(
	input: Input,
): input is SystemSandboxRunInput<Input> => input.authority.type === "system";

const hasProviderContext = <Input extends SandboxRunInput>(
	input: SystemSandboxRunInput<Input>,
): input is SystemProviderSandboxRunInput<Input> => input.providerId !== null;

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
>;

export const apiSuccess = <T>(data: T) => ({ data, success: true as const });
export const apiFailure = (error: string) => ({ error, success: false as const });

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

const hasUserContext = <Input extends SandboxRunInput>(
	input: Input,
): input is UserSandboxRunInput<Input> => "userId" in input.authority;

export type SubscriptionSandboxRunInput = SandboxRunInput & {
	readonly authority: Extract<ExecutionAuthority, { readonly type: "subscription" }>;
};

const hasSubscriptionRun = (input: SandboxRunInput): input is SubscriptionSandboxRunInput =>
	input.authority.type === "subscription";

export const requireSubscriptionSandboxRunInput = (
	input: SandboxRunInput,
	fnName: string,
): Effect.Effect<SubscriptionSandboxRunInput, SandboxHostError> => {
	if (!hasSubscriptionRun(input)) {
		return sandboxHostFailure(`${fnName} is available only to subscription executions`);
	}

	return Effect.succeed(input);
};

export const requireUserSandboxRunInput = <Input extends SandboxRunInput>(
	input: Input,
	fnName: string,
): Effect.Effect<UserSandboxRunInput<Input>, SandboxHostError> => {
	if (!hasUserContext(input)) {
		return sandboxHostFailure(`${fnName} is not available for system executions`);
	}

	return Effect.succeed(input);
};

export const requireSystemSandboxRunInput = <Input extends SandboxRunInput>(
	input: Input,
	fnName: string,
): Effect.Effect<SystemSandboxRunInput<Input>, SandboxHostError> => {
	if (!hasSystemContext(input)) {
		return sandboxHostFailure(`${fnName} is available only to system executions`);
	}

	return Effect.succeed(input);
};

export const requireSystemProviderSandboxRunInput = <Input extends SandboxRunInput>(
	input: Input,
	fnName: string,
): Effect.Effect<SystemProviderSandboxRunInput<Input>, SandboxHostError> =>
	requireSystemSandboxRunInput(input, fnName).pipe(
		Effect.flatMap((systemInput) =>
			hasProviderContext(systemInput)
				? Effect.succeed(systemInput)
				: sandboxHostFailure(`${fnName} is available only to provider-associated scripts`),
		),
	);
