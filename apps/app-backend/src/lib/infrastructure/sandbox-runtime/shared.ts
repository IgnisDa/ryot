import { unknownToMessage } from "@ryot/contract/errors";
import type { SandboxExecutionPayload } from "@ryot/contract/modules/sandbox/schemas";
import type { SandboxHostImplementationMap as SdkSandboxHostImplementationMap } from "@ryot/sandbox-sdk/core";
import type { JsonValue, SandboxHostError } from "@ryot/sandbox-sdk/wire";
import { isObjectRecord } from "@ryot/ts-utils/predicates";
import { Effect } from "effect";

export type SandboxRunInput = {
	readonly context: unknown;
	readonly scriptId: string;
	readonly metadata: unknown;
	readonly driverName: string;
	readonly executionId: string;
	readonly compiledCode: string;
	readonly userId: string | null;
	readonly compiledFormat: number;
	readonly scriptIsBuiltin: boolean;
	readonly allowedHostFunctions: readonly string[];
	readonly subscriptionRun?: NonNullable<SandboxExecutionPayload["subscriptionRun"]>;
};

export type BoundHostFunction = (args: ReadonlyArray<unknown>) => Effect.Effect<unknown, unknown>;

export type UserSandboxRunInput<Input extends SandboxRunInput = SandboxRunInput> = Input & {
	readonly userId: string;
};

export type SystemSandboxRunInput<Input extends SandboxRunInput = SandboxRunInput> = Input & {
	readonly userId: null;
	readonly subscriptionRun?: never;
	readonly driverName: "cron" | "boot";
};

const hasSystemContext = <Input extends SandboxRunInput>(
	input: Input,
): input is SystemSandboxRunInput<Input> =>
	input.userId === null &&
	(input.driverName === "cron" || input.driverName === "boot") &&
	input.subscriptionRun === undefined;

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

const hasUserContext = (input: SandboxRunInput): input is UserSandboxRunInput =>
	input.userId !== null;

export type SubscriptionSandboxRunInput = SandboxRunInput & {
	readonly subscriptionRun: NonNullable<SandboxRunInput["subscriptionRun"]>;
};

const hasSubscriptionRun = (input: SandboxRunInput): input is SubscriptionSandboxRunInput =>
	input.subscriptionRun !== undefined;

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

	return Effect.succeed(input as UserSandboxRunInput<Input>);
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
